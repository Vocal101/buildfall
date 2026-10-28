'use strict';
// Visual effects: particles, tracers, muzzle flashes, explosions, debris, projectiles.

const FX = (() => {
  let scene, group;
  const MATCOL = [0xb57a42, 0xb5543e, 0x9aa6b1];

  class Particles {
    constructor(cap, additive) {
      this.cap = cap;
      this.n = 0;
      this.p = [];
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { scale: { value: 600 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
          void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float a = smoothstep(0.5, ${additive ? '0.0' : '0.25'}, d) * vA; gl_FragColor = vec4(vC, a); }`,
      });
      this.mesh = new THREE.Points(g, m);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = additive ? 8 : 7;
    }
    add(o) {
      if (this.p.length >= this.cap) this.p.shift();
      this.p.push({ x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life, max: o.life, size: o.size, grow: o.grow || 0, g: o.g !== undefined ? o.g : 0, drag: o.drag || 0, c: new THREE.Color(o.c), a: o.a !== undefined ? o.a : 1, fade: o.fade || 'out' });
    }
    update(dt) {
      const P = this.p;
      let w = 0;
      for (let i = 0; i < P.length; i++) {
        const q = P[i];
        q.life -= dt;
        if (q.life <= 0) continue;
        q.vy -= q.g * dt;
        if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; q.vz *= k; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        q.size += q.grow * dt;
        P[w++] = q;
      }
      P.length = w;
      const n = Math.min(w, this.cap);
      for (let i = 0; i < n; i++) {
        const q = P[i];
        this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
        this.col[i * 3] = q.c.r; this.col[i * 3 + 1] = q.c.g; this.col[i * 3 + 2] = q.c.b;
        this.size[i] = q.size;
        const f = q.life / q.max;
        this.alpha[i] = q.a * (q.fade === 'in-out' ? Math.min(1, (1 - f) * 6) * f : f);
      }
      const g = this.mesh.geometry;
      g.setDrawRange(0, n);
      for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
    }
  }

  let add, norm;
  const tracers = [], flashes = [], falling = [], projMeshes = new Map();
  let tracerGeo, tracerMat, light, lightT = 0, flashMat, flameMat, flameGeo;
  const fallMats = [];
  let streaks = null, casings = null;

  // ---------- bullet streaks ----------
  // Every visible bullet is a camera-facing ribbon textured with a painted tracer (hot white core, warm
  // glow, bright tip). All of them are rebuilt into one dynamic mesh each frame: one draw call.
  function tracerTexture() {
    const W = 256, H = 64;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = (y - (H - 1) / 2) / ((H - 1) / 2);
      const along = Math.pow(u, 1.7) * (u > 0.96 ? 1 - (u - 0.96) / 0.04 * 0.6 : 1);
      const core = Math.exp(-v * v / 0.02), glow = Math.exp(-v * v / 0.22) * 0.55;
      const tip = Math.exp(-((u - 0.93) * (u - 0.93) * 900 + v * v * 6)) * 1.2;
      const a = Math.min(1, (core + glow) * along + tip);
      const white = Math.min(1, core * 1.3 + tip);
      const i = (y * W + x) * 4;
      d[i] = 255; d[i + 1] = 200 + 55 * white; d[i + 2] = 130 + 125 * white; d[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  class Streaks {
    constructor(cap) {
      this.cap = cap;
      this.list = []; this.frame = [];
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(cap * 4 * 3); this.col = new Float32Array(cap * 4 * 4);
      const uv = new Float32Array(cap * 4 * 2), idx = new Uint32Array(cap * 6);
      for (let i = 0; i < cap; i++) {
        uv.set([0, 0, 0, 1, 1, 1, 1, 0], i * 8);
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { map: { value: tracerTexture() } },
        vertexShader: 'attribute vec4 color; varying vec4 vC; varying vec2 vUv; void main(){ vC = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D map; varying vec4 vC; varying vec2 vUv; void main(){ vec4 t = texture2D(map, vUv); gl_FragColor = vec4(t.rgb * vC.rgb * 1.6, t.a * vC.a); }',
      });
      this.mesh = new THREE.Mesh(g, m);
      this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
      this.c = new THREE.Color();
    }
    // a bullet flying from o to e at `speed`, drawn as a streak `len` metres long
    shoot(o, e, col, width, speed, len) {
      const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z;
      const L = Math.hypot(dx, dy, dz);
      if (L < 0.4) return;
      if (this.list.length > this.cap - 16) this.list.shift();
      this.list.push({ o: { x: o.x, y: o.y, z: o.z }, d: { x: dx / L, y: dy / L, z: dz / L }, L, t: 0, col, width, speed, len });
    }
    // a streak for this frame only (projectile bullets)
    once(tail, head, col, width, alpha = 1) { this.frame.push({ tail, head, col, width, alpha }); }
    update(dt, cam) {
      let n = 0;
      const P = this.pos, C = this.col, cp = cam.position, c = this.c;
      const quad = (tx, ty, tz, hx, hy, hz, w, col, a) => {
        if (n >= this.cap) return;
        let ax = hx - tx, ay = hy - ty, az = hz - tz;
        const mx = (tx + hx) / 2 - cp.x, my = (ty + hy) / 2 - cp.y, mz = (tz + hz) / 2 - cp.z;
        let sx = ay * mz - az * my, sy = az * mx - ax * mz, sz = ax * my - ay * mx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        // widen slightly with distance so far tracers stay readable
        const dist = Math.hypot(mx, my, mz);
        const ww = w * (1 + Math.min(1.2, dist / 80)) / 2 / sl;
        a *= U.clamp(1 - (dist - 140) / 260, 0.15, 1);
        sx *= ww; sy *= ww; sz *= ww;
        P.set([tx - sx, ty - sy, tz - sz, tx + sx, ty + sy, tz + sz, hx + sx, hy + sy, hz + sz, hx - sx, hy - sy, hz - sz], n * 12);
        c.set(col);
        for (let k = 0; k < 4; k++) C.set([c.r, c.g, c.b, a], n * 16 + k * 4);
        n++;
      };
      let w = 0;
      for (const s of this.list) {
        s.t += dt;
        const head = Math.min(s.L, s.t * s.speed), tail = Math.max(0, s.t * s.speed - s.len);
        if (tail >= s.L) continue;
        this.list[w++] = s;
        const a = Math.min(1, s.t * 40) * (head >= s.L ? Math.max(0, 1 - (tail / s.L)) : 1);
        quad(s.o.x + s.d.x * tail, s.o.y + s.d.y * tail, s.o.z + s.d.z * tail, s.o.x + s.d.x * head, s.o.y + s.d.y * head, s.o.z + s.d.z * head, s.width, s.col, a);
      }
      this.list.length = w;
      for (const f of this.frame) quad(f.tail.x, f.tail.y, f.tail.z, f.head.x, f.head.y, f.head.z, f.width, f.col, f.alpha);
      this.frame.length = 0;
      const g = this.mesh.geometry;
      g.setDrawRange(0, n * 6);
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    }
    clear() { this.list.length = 0; this.frame.length = 0; }
  }

  // ---------- spent casings ----------
  class Casings {
    constructor() {
      const brass = new THREE.MeshStandardMaterial({ color: 0xd9a640, metalness: 0.85, roughness: 0.3 });
      const red = new THREE.MeshStandardMaterial({ color: 0xc8302c, roughness: 0.45 });
      const cg = new THREE.CylinderGeometry(0.0075, 0.0075, 0.034, 8);
      const sg = new THREE.CylinderGeometry(0.013, 0.013, 0.05, 10);
      this.kinds = { brass: this.mk(cg, brass), shell: this.mk(sg, red), big: this.mk(new THREE.CylinderGeometry(0.011, 0.011, 0.06, 8), brass) };
      this.list = [];
      this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.ax = new THREE.Vector3();
    }
    mk(geo, mat) {
      const im = new THREE.InstancedMesh(geo, mat, 64);
      im.count = 0; im.frustumCulled = false; im.castShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(im);
      return im;
    }
    spawn(p, r, kind, floorY) {
      if (this.list.length > 150) this.list.shift();
      const sp = 1.4 + Math.random() * 0.8;
      this.list.push({ kind, x: p.x, y: p.y, z: p.z, vx: r.x * sp + (Math.random() - 0.5) * 0.6, vy: r.y * sp + 1.2 + Math.random(), vz: r.z * sp + (Math.random() - 0.5) * 0.6, ax: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), ang: 0, spin: 18 + Math.random() * 20, life: 2.2, floor: floorY, rest: false });
    }
    update(dt) {
      const cnt = { brass: 0, shell: 0, big: 0 };
      let w = 0;
      for (const c of this.list) {
        c.life -= dt;
        if (c.life <= 0) continue;
        this.list[w++] = c;
        if (!c.rest) {
          c.vy -= 14 * dt;
          c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
          c.ang += c.spin * dt;
          if (c.y < c.floor + 0.01) {
            c.y = c.floor + 0.01;
            if (Math.abs(c.vy) < 1.2) { c.rest = true; c.ax.set(0, 0, 1); c.ang = Math.PI / 2; }
            else { c.vy = -c.vy * 0.35; c.vx *= 0.5; c.vz *= 0.5; c.spin *= 0.5; if (Math.random() < 0.5) Sfx.play('casing', c); }
          }
        }
        const im = this.kinds[c.kind], i = cnt[c.kind]++;
        if (i >= 64) continue;
        const sc = Math.min(1, c.life / 0.4);
        this.m.compose(this.v.set(c.x, c.y, c.z), this.q.setFromAxisAngle(c.ax, c.ang), this.s.set(sc, sc, sc));
        im.setMatrixAt(i, this.m);
      }
      this.list.length = w;
      for (const k in this.kinds) { const im = this.kinds[k]; im.count = Math.min(64, cnt[k]); im.instanceMatrix.needsUpdate = true; }
    }
    clear() { this.list.length = 0; }
  }

  function init(sc) {
    scene = sc;
    group = new THREE.Group();
    scene.add(group);
    add = new Particles(3000, true);
    norm = new Particles(2500, false);
    group.add(add.mesh); group.add(norm.mesh);
    tracerGeo = new THREE.BoxGeometry(1, 1, 1); tracerGeo.translate(0, 0, -0.5);
    tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    flashMat = new THREE.SpriteMaterial({ map: Tex.get('flash'), color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    flameMat = new THREE.MeshBasicMaterial({ map: Tex.get('flame'), color: 0xffd090, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    // two crossed quads along -Z: the flame that leaves the barrel
    flameGeo = Models.merge([{ g: new THREE.PlaneGeometry(0.5, 1), m: Models.TRS(0, 0, -0.5, -Math.PI / 2, 0, 0) }, { g: new THREE.PlaneGeometry(0.5, 1), m: Models.TRS(0, 0, -0.5, -Math.PI / 2, 0, Math.PI / 2) }]);
    streaks = new Streaks(400);
    group.add(streaks.mesh);
    casings = new Casings();
    light = new THREE.PointLight(0xffa040, 0, 30, 2);
    group.add(light);
  }
  function clear() {
    add.p.length = 0; norm.p.length = 0;
    if (streaks) streaks.clear();
    if (casings) casings.clear();
    for (const t of tracers) group.remove(t.m);
    for (const f of flashes) group.remove(f.m);
    for (const f of falling) group.remove(f.m);
    for (const m of projMeshes.values()) group.remove(m);
    tracers.length = 0; flashes.length = 0; falling.length = 0; projMeshes.clear();
  }

  // a bullet: a streak that flies from the muzzle to where the shot landed
  function tracer(o, e, col = 0xffe9a8, width = 0.05, pellet = false) {
    streaks.shoot(o, e, col, pellet ? width * 0.8 : width, pellet ? 330 : 430, pellet ? 3.5 : 9);
  }
  function muzzle(p, size = 0.7, dir) {
    const s = new THREE.Sprite(flashMat.clone());
    s.position.set(p.x, p.y, p.z);
    s.scale.set(size, size, 1);
    s.material.rotation = Math.random() * 6.28;
    group.add(s);
    flashes.push({ m: s, life: 0.05, max: 0.05 });
    if (dir) {
      const f = new THREE.Mesh(flameGeo, flameMat.clone());
      f.position.set(p.x, p.y, p.z);
      f.lookAt(p.x - dir.x, p.y - dir.y, p.z - dir.z);
      f.rotateZ(Math.random() * 6.28);
      const l = size * (0.8 + Math.random() * 0.4);
      f.scale.set(l, l, l * 1.2);
      group.add(f);
      flashes.push({ m: f, life: 0.045, max: 0.045 });
    }
    for (let i = 0; i < 3; i++) add.add({ x: p.x, y: p.y, z: p.z, vx: (dir ? dir.x * 6 : 0) + (Math.random() - 0.5) * 3, vy: (dir ? dir.y * 6 : 0) + Math.random() * 2, vz: (dir ? dir.z * 6 : 0) + (Math.random() - 0.5) * 3, life: 0.14, size: 0.05, g: 6, c: 0xffd080 });
    norm.add({ x: p.x, y: p.y, z: p.z, vx: dir ? dir.x * 1.5 : 0, vy: 0.6, vz: dir ? dir.z * 1.5 : 0, life: 0.7, size: 0.18, grow: 0.9, drag: 2, c: 0xd0d0d0, a: 0.25, fade: 'in-out' });
    flashLight(p, 6, 0.06);
  }
  // rushing-air streaks around the camera while skydiving
  function wind(cam, speed, dt) {
    const n = Math.min(6, Math.floor(speed * dt * 4 + Math.random()));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = 2.5 + Math.random() * 7;
      const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r, y = cam.y - 4 - Math.random() * 10;
      streaks.shoot({ x, y, z }, { x, y: y + 2.5 + speed * 0.06, z }, 0xcfe4ff, 0.035, speed * 2.2, 3.5);
    }
  }
  function casing(p, r, kind, floorY) { if (casings) casings.spawn(p, r, kind, floorY); }
  function flashLight(p, intensity, t) {
    light.position.set(p.x, p.y, p.z);
    light.intensity = Math.max(light.intensity, intensity);
    lightT = Math.max(lightT, t);
  }
  function impact(p, n, kind, mat) {
    const col = kind === 'player' ? 0xff5050 : kind === 'terrain' ? 0xb7a47a : (mat !== undefined && mat >= 0 ? MATCOL[mat] : 0xdddddd);
    for (let i = 0; i < 5; i++) {
      add.add({ x: p.x, y: p.y, z: p.z, vx: (n.x + (Math.random() - 0.5)) * 6, vy: (n.y + Math.random()) * 5, vz: (n.z + (Math.random() - 0.5)) * 6, life: 0.25, size: 0.07, g: 18, c: 0xffd890 });
    }
    for (let i = 0; i < 4; i++) {
      norm.add({ x: p.x, y: p.y, z: p.z, vx: (n.x + (Math.random() - 0.5)) * 3, vy: (n.y + Math.random()) * 3, vz: (n.z + (Math.random() - 0.5)) * 3, life: 0.6, size: 0.12, g: 12, c: col });
    }
    norm.add({ x: p.x, y: p.y, z: p.z, vy: 0.5, life: 0.6, size: 0.35, grow: 1.5, c: kind === 'terrain' ? 0xc9b98e : 0xcccccc, a: 0.5 });
  }
  function harvest(p, n, mat, crit) {
    const col = mat >= 0 ? MATCOL[mat] : 0xcccccc;
    for (let i = 0; i < (crit ? 16 : 9); i++) {
      norm.add({ x: p.x, y: p.y, z: p.z, vx: (n.x * 2 + (Math.random() - 0.5) * 3) * 1.5, vy: Math.random() * 5 + 1, vz: (n.z * 2 + (Math.random() - 0.5) * 3) * 1.5, life: 0.8, size: 0.14, g: 16, c: col });
    }
    if (crit) for (let i = 0; i < 12; i++) add.add({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 7, vz: (Math.random() - 0.5) * 7, life: 0.35, size: 0.1, c: 0x7fdcff });
  }
  function weakPoint(p) {
    add.add({ x: p.x, y: p.y, z: p.z, life: 0.12, size: 0.5, c: 0x7fdcff });
  }
  function keyCenter(k) {
    const t = k[0];
    const [gx, gy, gz] = k.slice(1).split(',').map(Number);
    const x0 = gx * S, y0 = gy * S, z0 = gz * S;
    if (t === 'Z') return { x: x0 + S / 2, y: y0 + S / 2, z: z0, t: 'wall', axis: 'z', gx, gy, gz };
    if (t === 'X') return { x: x0, y: y0 + S / 2, z: z0 + S / 2, t: 'wall', axis: 'x', gx, gy, gz };
    if (t === 'F') return { x: x0 + S / 2, y: y0, z: z0 + S / 2, t: 'floor', gx, gy, gz };
    return { x: x0 + S / 2, y: y0 + S / 2, z: z0 + S / 2, t: 'vol', gx, gy, gz };
  }
  function debris(k, mat, type, collapse) {
    const c = keyCenter(k);
    const col = MATCOL[mat || 0];
    const ext = c.t === 'wall' ? (c.axis === 'z' ? [S, S, 0.3] : [0.3, S, S]) : c.t === 'floor' ? [S, 0.3, S] : [S, S, S];
    const n = collapse ? 10 : 22;
    for (let i = 0; i < n; i++) {
      norm.add({ x: c.x + (Math.random() - 0.5) * ext[0], y: c.y + (Math.random() - 0.5) * ext[1], z: c.z + (Math.random() - 0.5) * ext[2], vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 1.1, size: 0.18 + Math.random() * 0.2, g: 16, c: col });
    }
    for (let i = 0; i < (collapse ? 3 : 6); i++) {
      norm.add({ x: c.x + (Math.random() - 0.5) * ext[0], y: c.y + (Math.random() - 0.5) * ext[1], z: c.z + (Math.random() - 0.5) * ext[2], vy: 0.4, life: 1.4, size: 1.0, grow: 2.2, c: 0xd8d2c8, a: 0.4, fade: 'in-out' });
    }
    if (collapse) {
      // the piece itself falls and fades
      if (!fallMats[mat]) {
        const base = Render.pieces() && Render.pieces().mats[mat];
        if (base) { fallMats[mat] = base.clone(); fallMats[mat].transparent = true; }
      }
      const fm = fallMats[mat];
      if (fm) {
        const p = { type: type || (c.t === 'vol' ? 'ramp' : c.t), axis: c.axis, gx: c.gx, gy: c.gy, gz: c.gz, dir: 0 };
        const m = new THREE.Mesh(Render.pieceGeo(p.type, 0), fm.clone());
        Render.pieceMatrix(p, m.matrix);
        m.matrix.decompose(m.position, m.quaternion, m.scale);
        group.add(m);
        falling.push({ m, vy: 0, life: 0.9, rx: (Math.random() - 0.5) * 2, rz: (Math.random() - 0.5) * 2 });
      }
    }
    Sfx.play('break', c, { m: mat });
  }
  function propBreak(pr) {
    const col = MATCOL[PROP_DEFS[pr.t].mat];
    const h = pr.t === 'pine' || pr.t === 'oak' ? 6 : 1.5;
    for (let i = 0; i < 26; i++) {
      norm.add({ x: pr.x + (Math.random() - 0.5) * 2, y: pr.y + Math.random() * h, z: pr.z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 1.2, size: 0.25, g: 14, c: i % 3 === 0 && (pr.t === 'pine' || pr.t === 'oak') ? 0x3f8a33 : col });
    }
    for (let i = 0; i < 6; i++) norm.add({ x: pr.x, y: pr.y + Math.random() * h * 0.6, z: pr.z, vx: (Math.random() - 0.5) * 2, vy: 0.5, vz: (Math.random() - 0.5) * 2, life: 1.5, size: 1.4, grow: 2, c: 0xd8d2c8, a: 0.35, fade: 'in-out' });
    Sfx.play('break', pr, { m: PROP_DEFS[pr.t].mat });
  }
  function explosion(p, r) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, b = Math.random() * 3.14, s = 4 + Math.random() * 9;
      add.add({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * Math.sin(b) * s, vy: Math.cos(b) * s * 0.8 + 3, vz: Math.sin(a) * Math.sin(b) * s, life: 0.45 + Math.random() * 0.3, size: 0.9 + Math.random() * 0.8, drag: 3, c: i % 3 ? 0xff8a2a : 0xffd070 });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.28, s = 1 + Math.random() * 3;
      norm.add({ x: p.x + Math.cos(a) * r * 0.3, y: p.y + Math.random() * r * 0.4, z: p.z + Math.sin(a) * r * 0.3, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * s, life: 2.2 + Math.random(), size: 2.2, grow: 2.5, drag: 1, c: 0x555555, a: 0.55, fade: 'in-out' });
    }
    for (let i = 0; i < 16; i++) norm.add({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 16, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 16, life: 1.2, size: 0.15, g: 20, c: 0x2a2a2a });
    const s = new THREE.Sprite(flashMat.clone());
    s.position.set(p.x, p.y, p.z); s.scale.set(r * 2.5, r * 2.5, 1);
    group.add(s);
    flashes.push({ m: s, life: 0.18, max: 0.18 });
    flashLight(p, 60, 0.35);
    Sfx.play('boom', p);
  }
  function sparkle(p, col) {
    for (let i = 0; i < 30; i++) add.add({ x: p.x + (Math.random() - 0.5) * 1.2, y: p.y + 0.4 + Math.random() * 0.6, z: p.z + (Math.random() - 0.5) * 1.2, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 2, life: 0.9, size: 0.12, g: 3, c: col });
    Sfx.play('chest', p);
  }
  function dust(p, n = 8) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; norm.add({ x: p.x + Math.cos(a) * 0.4, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.4, vx: Math.cos(a) * 2.5, vy: 0.4, vz: Math.sin(a) * 2.5, life: 0.8, size: 0.5, grow: 1.2, drag: 2, c: 0xd8cbb0, a: 0.45, fade: 'in-out' }); }
  }
  function heal(p, shield) {
    for (let i = 0; i < 2; i++) add.add({ x: p.x + (Math.random() - 0.5) * 0.8, y: p.y + Math.random() * 1.6, z: p.z + (Math.random() - 0.5) * 0.8, vy: 1.2, life: 0.8, size: 0.12, c: shield ? 0x4fb8ff : 0x6dff7a });
  }
  function stormSpecks(cam, s) {
    if (!s || s.r > 600) return;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * 6.28;
      const x = s.cx + Math.cos(a) * s.r, z = s.cz + Math.sin(a) * s.r;
      if (Math.hypot(x - cam.x, z - cam.z) > 140) continue;
      add.add({ x, y: cam.y - 10 + Math.random() * 40, z, vy: 2, vx: (Math.random() - 0.5) * 2, life: 2, size: 0.25, c: 0xd6a8ff, fade: 'in-out' });
    }
  }

  // projectiles (visual only) — positions come from G.proj
  function syncProjectiles(G, dt) {
    for (const [id, m] of projMeshes) if (!G.proj.has(id)) { group.remove(m); projMeshes.delete(id); }
    for (const pr of G.proj.values()) {
      let m = projMeshes.get(pr.id);
      if (!m) {
        m = new THREE.Group();
        if (pr.kind === 'bullet' && sp > 0.5) {
        const back = Math.min(8, 1 + (pr.age || 0) * sp * 0.5);
        streaks.once({ x: pr.x - pr.vx / sp * back, y: pr.y - pr.vy / sp * back, z: pr.z - pr.vz / sp * back }, { x: pr.x, y: pr.y, z: pr.z }, 0xffe2a8, 0.09);
      }
      if (pr.kind === 'rocket') {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), Models.mat(0x556070));
          b.rotation.x = Math.PI / 2; m.add(b);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), Models.mat(0xff4030)); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.4; m.add(tip);
        } else if (pr.kind === 'bullet') {
          // drawn by the streak batch below
        } else {
          const b = new THREE.Mesh(new THREE.SphereGeometry(pr.kind === 'gl' ? 0.1 : 0.12, 10, 8), Models.mat(pr.kind === 'gl' ? 0x3a3f46 : 0x4d6b2f)); m.add(b);
        }
        group.add(m);
        projMeshes.set(pr.id, m);
      }
      m.position.set(pr.x, pr.y, pr.z);
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
      if (sp > 0.5) m.lookAt(pr.x - pr.vx, pr.y - pr.vy, pr.z - pr.vz);
      if (pr.kind === 'rocket') {
        add.add({ x: pr.x, y: pr.y, z: pr.z, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 0.15, size: 0.45, c: 0xffa040 });
        norm.add({ x: pr.x, y: pr.y, z: pr.z, vy: 0.3, life: 1.4, size: 0.5, grow: 1.4, c: 0xbbbbbb, a: 0.4, fade: 'in-out' });
      } else if (pr.kind === 'gl' || pr.kind === 'nade') {
        if (Math.random() < 0.5) add.add({ x: pr.x, y: pr.y, z: pr.z, life: 0.2, size: 0.12, c: 0xff6040 });
      }
    }
  }

  function update(dt, cam) {
    add.mesh.material.uniforms.scale.value = window.innerHeight * 0.9;
    norm.mesh.material.uniforms.scale.value = window.innerHeight * 0.9;
    add.update(dt); norm.update(dt);
    streaks.update(dt, cam);
    casings.update(dt);
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / t.max) * 0.9;
      if (t.life <= 0) { group.remove(t.m); t.m.material.dispose(); tracers.splice(i, 1); }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt;
      f.m.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) { group.remove(f.m); f.m.material.dispose(); flashes.splice(i, 1); }
    }
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.life -= dt; f.vy -= 18 * dt;
      f.m.position.y += f.vy * dt;
      f.m.rotation.x += f.rx * dt; f.m.rotation.z += f.rz * dt;
      f.m.material.opacity = Math.max(0, f.life / 0.9);
      if (f.life <= 0) { group.remove(f.m); f.m.material.dispose(); falling.splice(i, 1); }
    }
    if (lightT > 0) { lightT -= dt; light.intensity *= Math.pow(0.0001, dt); if (lightT <= 0) light.intensity = 0; }
  }

  return { init, clear, update, tracer, muzzle, casing, wind, impact,
 harvest, weakPoint, debris, propBreak, explosion, sparkle, dust, heal, stormSpecks, syncProjectiles, flashLight, get add() { return add; }, get norm() { return norm; } };
})();
