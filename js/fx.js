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
  let tracerGeo, tracerMat, light, lightT = 0, flashMat;
  const fallMats = [];

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
    light = new THREE.PointLight(0xffa040, 0, 30, 2);
    group.add(light);
  }
  function clear() {
    add.p.length = 0; norm.p.length = 0;
    for (const t of tracers) group.remove(t.m);
    for (const f of flashes) group.remove(f.m);
    for (const f of falling) group.remove(f.m);
    for (const m of projMeshes.values()) group.remove(m);
    tracers.length = 0; flashes.length = 0; falling.length = 0; projMeshes.clear();
  }

  function tracer(o, e, col = 0xffe9a8, width = 0.035, life = 0.09) {
    const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.material.color.set(col);
    m.position.set(o.x, o.y, o.z);
    m.lookAt(o.x - dx, o.y - dy, o.z - dz);
    m.scale.set(width, width, len);
    group.add(m);
    tracers.push({ m, life, max: life });
  }
  function muzzle(p, size = 0.7) {
    const s = new THREE.Sprite(flashMat.clone());
    s.position.set(p.x, p.y, p.z);
    s.scale.set(size, size, 1);
    s.material.rotation = Math.random() * 6.28;
    group.add(s);
    flashes.push({ m: s, life: 0.05, max: 0.05 });
    flashLight(p, 6, 0.06);
  }
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
        if (pr.kind === 'rocket') {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), Models.mat(0x556070));
          b.rotation.x = Math.PI / 2; m.add(b);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), Models.mat(0xff4030)); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.4; m.add(tip);
        } else if (pr.kind === 'bullet') {
          const b = new THREE.Mesh(tracerGeo, tracerMat.clone()); b.scale.set(0.05, 0.05, 3); b.material.color.set(0xfff2c0); m.add(b);
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

  return { init, clear, update, tracer, muzzle, impact, harvest, weakPoint, debris, propBreak, explosion, sparkle, dust, heal, stormSpecks, syncProjectiles, flashLight, get add() { return add; }, get norm() { return norm; } };
})();
