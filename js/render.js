'use strict';
// three.js scene: sky, terrain, water, props, builds, players, loot, effects, storm.

const Render = (() => {
  let renderer, scene, camera, sun, hemi, skyMesh, waterMesh, terrainMesh, stormMesh, fog;
  let G = null, world = null;
  let quality = 'high';
  const uTime = { value: 0 };
  const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.32).normalize();
  const FOG_COLOR = new THREE.Color(0xbfd6ee);
  const STORM_FOG = new THREE.Color(0x6d3fb0);
  let stormTint = 0;

  // ---------- init ----------
  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: location.search.includes('dev') });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // the scene renders linear HDR into an offscreen target; Post does tone mapping, bloom and grading
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0016);
    scene.fog = fog;
    camera = new THREE.PerspectiveCamera(80, 1, 0.1, 2600);
    camera.rotation.order = 'YXZ';
    hemi = new THREE.HemisphereLight(0xc4dcff, 0x5a5236, 0.55);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 420;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.045;
    scene.add(sun); scene.add(sun.target);
    makeSky();
    makeEnvironment();
    Post.init(renderer);
    FX.init(scene);
    window.addEventListener('resize', resize);
    resize();
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const scale = (window.SETTINGS ? SETTINGS.renderScale : 1) || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2) * scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    Post.setSize(v.x, v.y, quality);
  }
  function setQuality(q, shadows) {
    quality = q;
    renderer.shadowMap.enabled = shadows && q !== 'low';
    sun.castShadow = renderer.shadowMap.enabled;
    const sz = q === 'high' ? 2048 : 1024;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(sz, sz);
    scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.needsUpdate = true); } });
    resize();
  }

  function makeSky() {
    const geo = new THREE.SphereGeometry(2400, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN_DIR }, time: uTime, storm: { value: 0 }, expo: { value: Post.uniforms.exposure } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: Post.GLSL + `
        uniform vec3 sunDir; uniform float time; uniform float storm; uniform float expo; varying vec3 vDir;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float y = max(d.y, -0.1);
          vec3 zen = vec3(0.10,0.32,0.72), hor = vec3(0.55,0.72,0.9), low = vec3(0.72,0.8,0.86);
          vec3 col = mix(hor, zen, pow(clamp(y,0.,1.), 0.55));
          col = mix(low, col, smoothstep(-0.05, 0.12, d.y));
          float sd = max(dot(d, sunDir), 0.);
          col += vec3(1.0,0.85,0.6) * pow(sd, 8.0) * 0.35;

          if (d.y > 0.0) {
            vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(time*0.004, time*0.002);
            float c = fbm(uv);
            c = smoothstep(0.52, 0.8, c) * smoothstep(0.0, 0.25, d.y);
            vec3 cc = mix(vec3(1.0), vec3(0.78,0.82,0.9), smoothstep(0.6, 1.0, fbm(uv*1.7+3.)));
            cc += vec3(1.0,0.9,0.7) * pow(sd, 4.0) * 0.3;
            col = mix(col, cc, c * 0.9);
          }
          // melt into the fog colour at the horizon so the sea meets the sky without a seam
          col = mix(col, vec3(0.75,0.84,0.93), smoothstep(0.1, -0.02, d.y) * 0.85);
          col = mix(col, vec3(0.42,0.24,0.62), storm * 0.55);
          // the colours above are display values: undo the tone curve so they survive Post unchanged
          vec3 lin = pow(clamp(col, 0.0, 0.9), vec3(2.2));
          gl_FragColor = vec4(invTone(lin) / expo + vec3(1.0,0.95,0.85) * smoothstep(0.9975, 0.9994, sd) * 30.0 + vec3(1.0,0.85,0.6) * pow(sd, 64.0) * 1.5, 1.0);
        }`,
    });
    m.toneMapped = false;
    skyMesh = new THREE.Mesh(geo, m);
    skyMesh.renderOrder = -10;
    scene.add(skyMesh);
  }

  // image-based lighting from a simple sky dome, so metals and glossy parts reflect sky and ground
  function makeEnvironment() {
    const es = new THREE.Scene();
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 sunDir; varying vec3 vD; void main(){
        vec3 d = normalize(vD);
        vec3 sky = mix(vec3(0.42,0.6,0.85), vec3(0.12,0.3,0.7), clamp(d.y,0.,1.));
        vec3 gnd = mix(vec3(0.22,0.26,0.14), vec3(0.4,0.45,0.35), smoothstep(-0.4, 0.0, d.y));
        vec3 c = d.y > 0.0 ? sky : gnd;
        c += vec3(1.0,0.9,0.75) * pow(max(dot(d, sunDir), 0.0), 24.0) * 3.0;
        gl_FragColor = vec4(c * 0.6, 1.0); }`,
    });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), m));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(es, 0.02).texture;
    pm.dispose();
  }

  // ---------- world load ----------

  const worldGroup = new THREE.Group();
  let pieces = null, propR = null, grass = null;
  const lootMeshes = new Map(), chestMeshes = new Map(), aboxMeshes = new Map(), padMeshes = new Map();
  const avatars = new Map();
  let blimpMesh = null;
  let ghost = null, editOverlay = null;

  function clearWorld() {
    scene.remove(worldGroup);
    worldGroup.traverse(o => {
      if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    });
    worldGroup.clear();
    lootMeshes.clear(); chestMeshes.clear(); aboxMeshes.clear(); padMeshes.clear(); avatars.clear();
    pieces = null; propR = null; grass = null; blimpMesh = null;
    FX.clear();
  }

  function load(game) {
    clearWorld();
    G = game; world = game.W;
    scene.add(worldGroup);
    buildTerrain();
    buildWater();
    propR = new PropRenderer(worldGroup, world);
    pieces = new PieceRenderer(worldGroup);
    for (const p of G.structs.map.values()) pieces.add(p);
    for (const l of G.loot.values()) addLoot(l);
    for (const c of G.chests.values()) addChest(c, false);
    for (const c of G.aboxes.values()) addChest(c, true);
    grass = new Grass(worldGroup, world);
    buildStorm();
    if (world.bus) { blimpMesh = Models.blimp(); worldGroup.add(blimpMesh); }
    buildClouds();
    ghost = new Ghost(worldGroup);
    editOverlay = new EditOverlay(worldGroup);
    for (const p of G.players.values()) avatarFor(p);
  }

  // big soft cloud billboards around skydiving height; they thin out as you pass through them
  let clouds = [];
  function buildClouds() {
    clouds = [];
    const R = U.rng(world.seed + 31);
    const n = world.bus ? 46 : 14, spread = world.bus ? 520 : 400;
    const tex = Tex.get('cloud');
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spread;
      const s = 70 + R() * 90;
      const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color().setHSL(0.6, 0.2, 0.94 + R() * 0.06), transparent: true, opacity: 0.9, depthWrite: false, fog: true, rotation: (R() - 0.5) * 0.3 });
      const sp = new THREE.Sprite(m);
      sp.position.set(Math.cos(a) * r, world.bus ? 150 + R() * 80 : 170 + R() * 60, Math.sin(a) * r);
      sp.scale.set(s, s * (0.45 + R() * 0.2), 1);
      sp.renderOrder = 2;
      sp.userData = { s, base: 0.75 + R() * 0.2, drift: 0.6 + R() * 0.8 };
      worldGroup.add(sp);
      clouds.push(sp);
    }
  }
  function updateClouds(dt) {
    const cp = camera.position;
    for (const c of clouds) {
      c.position.x += c.userData.drift * dt;
      if (c.position.x > 600) c.position.x -= 1200;
      const d = c.position.distanceTo(cp), s = c.userData.s;
      c.material.opacity = c.userData.base * U.clamp((d - s * 0.12) / (s * 0.45), 0, 1);
      c.visible = c.material.opacity > 0.01;
    }
  }

  function terrainColor(x, z, h, slope, N) {
    const c = new THREE.Color();
    const n = N(x * 0.05, z * 0.05) * 0.5 + 0.5;
    const n2 = N(x * 0.013 + 9, z * 0.013) * 0.5 + 0.5;
    const grass = new THREE.Color().setHSL(0.27 + n2 * 0.05, 0.52 + n * 0.12, 0.33 + n * 0.08);
    const dry = new THREE.Color().setHSL(0.17, 0.45, 0.45);
    c.copy(grass).lerp(dry, U.smooth(0.55, 0.85, n2) * 0.45);
    const sand = new THREE.Color(0xe0cc95);
    const rock = new THREE.Color().setHSL(0.08, 0.08, 0.42 + n * 0.12);
    const wet = new THREE.Color(0xa99a6e);
    if (h < 2.6) c.lerp(sand, U.smooth(2.6, 1.6, h));
    if (h < 0.4) c.lerp(wet, U.smooth(0.4, -1, h));
    c.lerp(rock, U.smooth(0.55, 0.95, slope));
    if (h > 30) c.lerp(rock, U.smooth(30, 46, h) * 0.6);
    for (const r of world.roads) {
      const d = World.segDist(x, z, r);
      if (d < 4.5) c.lerp(new THREE.Color(0x9c8460), U.smooth(4.5, 2.5, d) * 0.85);
    }
    for (const p of world.pois) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (p.kind === 'arena') { if (d < p.r + 30) c.lerp(new THREE.Color().setHSL(0.28, 0.42, 0.4 + n * 0.06), 0.4); continue; }
      if (d < p.r + 4) c.lerp(new THREE.Color().setHSL(0.09, 0.18, 0.5 + n * 0.08), U.smooth(p.r + 4, p.r - 2, d) * 0.75);
    }
    return c;
  }

  function buildTerrain() {
    const T = world.T;
    const n = T.n;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    const N = U.noise2(world.seed + 99);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -T.half + ix * T.cell, z = -T.half + iz * T.cell, h = T.hts[i];
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
      const hx = T.get(Math.min(n - 1, ix + 1), iz) - T.get(Math.max(0, ix - 1), iz);
      const hz = T.get(ix, Math.min(n - 1, iz + 1)) - T.get(ix, Math.max(0, iz - 1));
      const slope = Math.hypot(hx, hz) / (2 * T.cell);
      const c = terrainColor(x, z, h, slope, N);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      uv[i * 2] = x / 6; uv[i * 2 + 1] = z / 6;
    }
    const idx = [];
    for (let iz = 0; iz < n - 1; iz++) for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: Tex.get('ground'), roughness: 0.96, metalness: 0 });
    terrainMesh = new THREE.Mesh(g, m);
    terrainMesh.receiveShadow = true;
    worldGroup.add(terrainMesh);
    // skirt so the island edge never shows gaps
    const sk = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x8f8460, roughness: 1 }));
    sk.rotation.x = -Math.PI / 2; sk.position.y = -14;
    worldGroup.add(sk);
  }

  function buildWater() {
    const T = world.T;
    // height texture for shoreline foam/depth
    const n = T.n;
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      const h = U.clamp((T.hts[i] + 12) / 16, 0, 1);
      data[i * 4] = h * 255; data[i * 4 + 3] = 255;
    }
    const ht = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    ht.magFilter = THREE.LinearFilter; ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
    const m = new THREE.ShaderMaterial({
      transparent: true, fog: false,
      uniforms: { time: uTime, sunDir: { value: SUN_DIR }, hmap: { value: ht }, halfSize: { value: T.half }, fogColor: { value: FOG_COLOR.clone() }, fogDensity: { value: 0.0016 }, camPos: { value: new THREE.Vector3() } },
      vertexShader: `
        uniform float time; varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 p = position;
          vec4 w = modelMatrix * vec4(p,1.0);
          float a = sin(w.x*0.08 + time*1.1)*0.18 + sin(w.z*0.11 - time*0.9)*0.14 + sin((w.x+w.z)*0.05 + time*0.6)*0.2;
          w.y += a;
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float time; uniform vec3 sunDir; uniform sampler2D hmap; uniform float halfSize; uniform vec3 fogColor; uniform float fogDensity; uniform vec3 camPos;
        varying vec3 vW;
        void main(){
          vec2 uv = (vW.xz + halfSize) / (halfSize*2.0);
          float th = texture2D(hmap, uv).r * 16.0 - 12.0;
          float depth = clamp(-th, 0.0, 12.0);
          float dx = cos(vW.x*0.08 + time*1.1)*0.08*0.18 + cos((vW.x+vW.z)*0.05+time*0.6)*0.05*0.2 + sin(vW.x*0.9+time*2.0)*0.03;
          float dz = -sin(vW.z*0.11 - time*0.9)*0.11*0.14 + cos((vW.x+vW.z)*0.05+time*0.6)*0.05*0.2 + cos(vW.z*0.8-time*1.7)*0.03;
          float camD = length(camPos - vW);
          vec3 N = normalize(vec3(-dx*6.0, 1.0, -dz*6.0) * vec3(1.0 - smoothstep(40.0, 260.0, camD) * 0.85, 1.0, 1.0 - smoothstep(40.0, 260.0, camD) * 0.85));
          vec3 V = normalize(camPos - vW);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 shallow = vec3(0.2,0.72,0.74), deep = vec3(0.03,0.22,0.42);
          vec3 col = mix(shallow, deep, smoothstep(0.0, 9.0, depth));
          col = mix(col, vec3(0.62,0.8,0.95), fres*0.6);
          vec3 H = normalize(sunDir + V);
          float farF = smoothstep(60.0, 300.0, camD);
          col += vec3(1.0,0.95,0.85) * pow(max(dot(N,H),0.0), mix(180.0, 40.0, farF)) * mix(2.0, 0.5, farF);
          float foam = smoothstep(1.2, 0.0, depth) * (0.6 + 0.4*sin(time*2.0 + vW.x*0.6 + vW.z*0.4));
          col = mix(col, vec3(1.0), clamp(foam,0.0,1.0)*0.75);
          float alpha = mix(0.75, 0.96, smoothstep(0.0, 4.0, depth));
          float d = length(camPos - vW);
          float f = 1.0 - exp(-fogDensity*fogDensity*d*d);
          col = mix(col, fogColor, f);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const g = new THREE.PlaneGeometry(5200, 5200, 220, 220);
    g.rotateX(-Math.PI / 2);
    waterMesh = new THREE.Mesh(g, m);
    waterMesh.position.y = WATER_Y - 0.25;
    worldGroup.add(waterMesh);
  }

  function buildStorm() {
    const g = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true);
    g.translate(0, 0.5, 0);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { time: uTime, radius: { value: 100 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: Post.GLSL + `
        uniform float time; uniform float radius; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float ang = atan(vW.z, vW.x);
          vec2 p = vec2(ang * radius * 0.05, vW.y * 0.05);
          float a = n(p + vec2(time*0.6, -time*0.9)) * 0.6 + n(p*2.7 + vec2(-time*0.8, time*0.3)) * 0.4;
          float streak = smoothstep(0.55, 1.0, n(vec2(ang*radius*0.02, vW.y*0.004 - time*0.4)));
          vec3 col = mix(vec3(0.36,0.14,0.62), vec3(0.72,0.42,1.0), a);
          col += vec3(0.9,0.7,1.0) * streak * 0.6;
          float alpha = 0.22 + a*0.2 + streak*0.18;
          alpha *= smoothstep(0.0, 0.03, vUv.y);
          gl_FragColor = vec4(toLin(col) * 1.2, alpha);
        }`,
    });
    stormMesh = new THREE.Mesh(g, m);
    stormMesh.scale.set(400, 700, 400);
    stormMesh.position.y = -60;
    stormMesh.renderOrder = 5;
    stormMesh.frustumCulled = false;
    worldGroup.add(stormMesh);
  }

  // ---------- builds ----------
  const geoCache = new Map();
  function stairsGeo() {
    const parts = [];
    const n = 8, run = S / n;
    for (let i = 0; i < n; i++) {
      const top = (i + 0.5) * run + HT0 + 0.0;
      const hgt = run + 0.32;
      parts.push({ g: new THREE.BoxGeometry(S - 0.04, hgt, run + 0.01), m: Models.T(0, top - hgt / 2, -S / 2 + (i + 0.5) * run) });
    }
    const L = S * Math.SQRT2;
    for (const sx of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(0.12, 0.42, L), m: Models.TRS(sx * (S / 2 - 0.06), S / 2 + 0.05, 0, -Math.PI / 4, 0, 0) });
    return Models.merge(parts);
  }
  const HT0 = WALL_T / 2;
  function coneGeo(mask) {
    const pos = [], uv = [];
    const h = S / 2;
    const A = [0, CONE_H, 0];
    const push = (a, b, c, dy, flip) => {
      const tri = flip ? [a, c, b] : [a, b, c];
      for (const v of tri) { pos.push(v[0], v[1] + dy, v[2]); uv.push((v[0] + h) / S, (v[2] + h) / S); }
    };
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      if (mask & (1 << (j * 2 + i))) continue;
      const C = [i ? h : -h, 0, j ? h : -h];
      const M1 = [0, 0, j ? h : -h], M2 = [i ? h : -h, 0, 0];
      for (const [p, q] of [[M1, A], [A, M2]]) {
        // orient so the top face points up
        const e1 = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], e2 = [q[0] - C[0], q[1] - C[1], q[2] - C[2]];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        const up = ny > 0;
        push(C, p, q, HT0, !up);
        push(C, p, q, -HT0, up);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  function tileGeo(type, mask) {
    const parts = [];
    if (type === 'wall') {
      const t = S / 3;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        if (mask & (1 << (r * 3 + c))) continue;
        const g = new THREE.BoxGeometry(t, t, WALL_T);
        const uvA = g.attributes.uv;
        for (let k = 0; k < uvA.count; k++) uvA.setXY(k, (c + uvA.getX(k)) / 3, (r + uvA.getY(k)) / 3);
        parts.push({ g, m: Models.T(-S / 2 + (c + 0.5) * t, -S / 2 + (r + 0.5) * t, 0) });
      }
    } else {
      const t = S / 2;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        if (mask & (1 << (j * 2 + i))) continue;
        const g = new THREE.BoxGeometry(t, WALL_T, t);
        const uvA = g.attributes.uv;
        for (let k = 0; k < uvA.count; k++) uvA.setXY(k, (i + uvA.getX(k)) / 2, (1 - j + uvA.getY(k)) / 2);
        parts.push({ g, m: Models.T(-S / 2 + (i + 0.5) * t, 0, -S / 2 + (j + 0.5) * t) });
      }
    }
    return Models.merge(parts);
  }
  function pieceGeo(type, mask) {
    const key = type + ':' + mask;
    if (geoCache.has(key)) return geoCache.get(key);
    let g;
    if (type === 'ramp') g = stairsGeo();
    else if (type === 'cone') g = coneGeo(mask);
    else if (mask === 0) g = type === 'wall' ? new THREE.BoxGeometry(S, S, WALL_T) : new THREE.BoxGeometry(S, WALL_T, S);
    else g = tileGeo(type, mask);
    geoCache.set(key, g);
    return g;
  }
  function pieceMatrix(p, m, scale = 1) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(scale, scale, scale);
    if (p.type === 'wall') {
      if (p.axis === 'z') pos.set(x0 + S / 2, y0 + S / 2, z0);
      else { pos.set(x0, y0 + S / 2, z0 + S / 2); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2); }
    } else if (p.type === 'floor') pos.set(x0 + S / 2, y0, z0 + S / 2);
    else {
      pos.set(x0 + S / 2, y0, z0 + S / 2);
      if (p.type === 'ramp') q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.dir]);
    }
    return m.compose(pos, q, sc);
  }

  class PieceRenderer {
    constructor(parent) {
      this.parent = parent;
      this.mats = ['wood', 'brick', 'metal'].map((n, i) => {
        const t = Tex.get(n);
        return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: i === 2 ? 0.45 : 0.82, metalness: i === 2 ? 0.55 : 0 });
      });
      this.vcMats = this.mats.map(m => { const c = m.clone(); c.vertexColors = true; return c; });
      this.inst = {};
      this.slot = new Map();
      this.edited = new Map();
      this.anim = new Set();
      const caps = { wall: 6000, floor: 4000, ramp: 2000, cone: 2000 };
      for (const type of ['wall', 'floor', 'ramp', 'cone']) {
        for (let mi = 0; mi < 3; mi++) {
          const geo = pieceGeo(type, 0);
          const im = new THREE.InstancedMesh(geo, type === 'ramp' ? this.vcMats[mi] : this.mats[mi], caps[type]);
          im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.setColorAt(0, new THREE.Color(1, 1, 1));
          im.userData.free = []; im.userData.sharedGeo = true;
          parent.add(im);
          this.inst[type + mi] = im;
        }
      }
      this.tmpM = new THREE.Matrix4(); this.tmpC = new THREE.Color();
    }
    instFor(type, mask, mat) {
      const key = type + mask + ':' + mat;
      let im = this.inst[key];
      if (!im) {
        im = new THREE.InstancedMesh(pieceGeo(type, mask), type === 'ramp' ? this.vcMats[mat] : this.mats[mat], 1500);
        im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        im.userData.free = []; im.userData.sharedGeo = true;
        this.parent.add(im);
        this.inst[key] = im;
      }
      return im;
    }
    add(p) {
      {
        const im = p.mask && p.type !== 'ramp' ? this.instFor(p.type, p.mask, p.mat) : this.inst[p.type + p.mat];
        let idx = im.userData.free.pop();
        if (idx === undefined) {
          if (im.count >= im.instanceMatrix.count) return;
          idx = im.count++;
        }
        this.slot.set(p.k, { im, idx });
        im.setMatrixAt(idx, pieceMatrix(p, this.tmpM, p.born !== undefined && G && G.time - p.born < 0.3 ? 0.4 : 1));
        im.instanceMatrix.needsUpdate = true;
      }
      this.color(p);
      if (p.born !== undefined || p.grow > 0 || p.pending) this.anim.add(p);
    }
    remove(k) {
      const s = this.slot.get(k);
      if (s) {
        s.im.setMatrixAt(s.idx, this.tmpM.makeScale(0, 0, 0));
        s.im.instanceMatrix.needsUpdate = true;
        s.im.userData.free.push(s.idx);
        this.slot.delete(k);
      }
      const m = this.edited.get(k);
      if (m) { this.parent.remove(m); this.edited.delete(k); }
      for (const p of this.anim) if (p.k === k) this.anim.delete(p);
    }
    refresh(p) { this.remove(p.k); this.add(p); }
    color(p) {
      const f = U.clamp(p.hp / p.max, 0, 1);
      const c = this.tmpC;
      const v = 0.7 + 0.3 * Math.min(1, f * 1.5);
      c.setRGB(v, v, v);
      if (p.grow > 0 || p.pending) { const b = 0.5 + 0.5 * Math.sin((G ? G.time : 0) * 8); c.setRGB(0.78 + 0.1 * b, 0.92 + 0.08 * b, 1.25); }
      const s = this.slot.get(p.k);
      if (s) { s.im.setColorAt(s.idx, c); s.im.instanceColor.needsUpdate = true; }
      const m = this.edited.get(p.k);
      if (m) {
        if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
        m.material.color.copy(c);
      }
    }
    tick() {
      for (const p of this.anim) {
        const age = G.time - (p.born !== undefined ? p.born : -9);
        const s = this.slot.get(p.k);
        if (s && age < 0.25) {
          const k = 0.4 + 0.6 * easeOut(age / 0.25);
          s.im.setMatrixAt(s.idx, pieceMatrix(p, this.tmpM, k));
          s.im.instanceMatrix.needsUpdate = true;
        } else if (s && age < 0.4) {
          s.im.setMatrixAt(s.idx, pieceMatrix(p, this.tmpM, 1));
          s.im.instanceMatrix.needsUpdate = true;
        }
        this.color(p);
        if (age > 0.4 && !(p.grow > 0) && !p.pending) { this.color(p); this.anim.delete(p); }
      }
    }
  }
  const easeOut = t => 1 - Math.pow(1 - U.clamp(t, 0, 1), 3);

  class Ghost {
    constructor(parent) {
      this.mat = new THREE.MeshBasicMaterial({ map: Tex.get('blueprint'), transparent: true, opacity: 0.9, depthWrite: false, color: 0x9fd4ff, side: THREE.DoubleSide, fog: false });
      this.mesh = new THREE.Mesh(pieceGeo('wall', 0), this.mat);
      this.mesh.matrixAutoUpdate = false;
      this.mesh.visible = false;
      this.mesh.renderOrder = 10;
      parent.add(this.mesh);
    }
    show(desc, ok) {
      if (!desc) { this.mesh.visible = false; return; }
      this.mesh.geometry = pieceGeo(desc.type, 0);
      pieceMatrix({ ...desc, dir: desc.dir || 0 }, this.mesh.matrix, 1.002);
      this.mat.color.set(ok ? 0x9fd4ff : 0xff6a6a);
      this.mat.opacity = ok ? 0.85 : 0.6;
      this.mesh.visible = true;
    }
  }

  class EditOverlay {
    constructor(parent) {
      this.group = new THREE.Group();
      this.group.renderOrder = 11;
      parent.add(this.group);
      this.tiles = [];
      this.matOn = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false, side: THREE.DoubleSide });
      this.matOff = new THREE.MeshBasicMaterial({ map: Tex.get('blueprint'), color: 0x7fc4ff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.DoubleSide });
      this.matHover = new THREE.MeshBasicMaterial({ map: Tex.get('blueprint'), color: 0xd4f0ff, transparent: true, opacity: 1, depthWrite: false, fog: false, side: THREE.DoubleSide });
      this.arrow = null;
    }
    hide() { this.group.visible = false; }
    show(p, sel, hover, rampDir) {
      this.group.visible = true;
      const n = p.type === 'wall' ? 9 : 4;
      while (this.tiles.length < 9) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.matOff);
        m.renderOrder = 11;
        this.group.add(m); this.tiles.push(m);
      }
      for (let i = 0; i < 9; i++) {
        const m = this.tiles[i];
        if (i >= n) { m.visible = false; continue; }
        m.visible = true;
        const c = Build.tileCenter(p, i);
        m.position.set(c.x, c.y, c.z);
        m.rotation.set(0, 0, 0);
        if (p.type === 'wall') {
          const t = S / 3 - 0.06;
          if (p.axis === 'z') m.scale.set(t, t, WALL_T + 0.08); else m.scale.set(WALL_T + 0.08, t, t);
        } else {
          const t = S / 2 - 0.08;
          m.scale.set(t, 0.06, t);
          if (p.type === 'ramp') {
            m.scale.set(t, 0.06, t * Math.SQRT2);
            m.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][rampDir !== undefined ? rampDir : p.dir];
            m.rotation.order = 'YXZ';
            m.rotation.x = -Math.PI / 4;
          } else if (p.type === 'cone') m.scale.set(t, CONE_H * 0.5, t);
        }
        m.material = sel.has(i) ? this.matOn : (i === hover ? this.matHover : this.matOff);
      }
    }
  }

  // ---------- props ----------
  class PropRenderer {
    constructor(parent, W) {
      const geos = Models.propGeos();
      this.byType = {};
      this.idx = new Map();
      this.wobble = new Map();
      this.m = new THREE.Matrix4();
      const mkMat = (wind) => {
        const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
        if (wind) m.onBeforeCompile = sh => {
          sh.uniforms.time = uTime;
          sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            float sway = max(0.0, position.y - 2.0) * 0.025;
            vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
            transformed.x += sin(time*1.3 + wp.x*0.3 + wp.z*0.2) * sway;
            transformed.z += cos(time*1.1 + wp.z*0.3) * sway * 0.7;`);
        };
        return m;
      };
      const treeMat = mkMat(true), solidMat = mkMat(false);
      const tint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
      const counts = {};
      for (const p of W.props) counts[p.t] = (counts[p.t] || 0) + 1;
      for (const t of Object.keys(geos)) {
        if (t === 'bush') continue;
        const n = counts[t] || 0;
        if (!n) continue;
        const m = t === 'pine' || t === 'oak' ? treeMat : (t === 'car' || t === 'container' ? tint : solidMat);
        const im = new THREE.InstancedMesh(geos[t], m, n);
        im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
        im.count = 0;
        parent.add(im);
        this.byType[t] = im;
      }
      const carCols = [0xd83a3a, 0x3a7ad8, 0xf0f0f0, 0x2a2a2a, 0xf0c030, 0x3ab06a];
      const conCols = [0xc0392b, 0x2471a3, 0x1e8449, 0xd68910, 0x7d3c98];
      const R = U.rng(W.seed + 5);
      for (const p of W.props) {
        const im = this.byType[p.t];
        const i = im.count++;
        this.idx.set(p.id, { im, i, p });
        this.place(p, im, i, 0);
        if (p.t === 'car') im.setColorAt(i, new THREE.Color(R.pick(carCols)));
        else if (p.t === 'container') im.setColorAt(i, new THREE.Color(R.pick(conCols)));
        else im.setColorAt(i, new THREE.Color().setHSL(0, 0, 0.85 + R() * 0.3));
      }
      for (const im of Object.values(this.byType)) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      // bushes (decor only)
      if (W.bushes.length) {
        const bim = new THREE.InstancedMesh(geos.bush, treeMat, W.bushes.length);
        bim.receiveShadow = true; bim.castShadow = true; bim.frustumCulled = false;
        W.bushes.forEach((b, i) => { bim.setMatrixAt(i, Models.TRS(b.x, b.y - 0.1, b.z, 0, b.rot, 0, b.s, b.s, b.s)); bim.setColorAt(i, new THREE.Color().setHSL(0, 0, 0.8 + R() * 0.35)); });
        parent.add(bim);
      }
    }
    place(p, im, i, wob) {
      const s = p.s;
      const rx = wob ? Math.sin(wob * 40) * wob * 0.08 : 0;
      im.setMatrixAt(i, Models.TRS(p.x, p.y - (p.t === 'rock' ? 0.25 * s : 0), p.z, rx, p.rot, rx * 0.5, s, s, s));
    }
    hit(id) { const e = this.idx.get(id); if (e) this.wobble.set(id, 0.35); }
    kill(id) {
      const e = this.idx.get(id);
      if (!e) return;
      e.im.setMatrixAt(e.i, this.m.makeScale(0, 0, 0));
      e.im.instanceMatrix.needsUpdate = true;
      this.wobble.delete(id);
    }
    tick(dt) {
      for (const [id, t] of this.wobble) {
        const e = this.idx.get(id);
        const nt = t - dt;
        if (!e.p.alive) { this.wobble.delete(id); continue; }
        this.place(e.p, e.im, e.i, Math.max(0, nt));
        e.im.instanceMatrix.needsUpdate = true;
        if (nt <= 0) this.wobble.delete(id); else this.wobble.set(id, nt);
      }
    }
  }

  // ---------- grass ----------
  class Grass {
    constructor(parent, W) {
      this.W = W;
      this.cap = 16000;
      const g = new THREE.BufferGeometry();
      const P = [], UVs = [], N = [];
      for (let k = 0; k < 2; k++) {
        const a = k * Math.PI / 2 + 0.4;
        const cx = Math.cos(a) * 0.45, cz = Math.sin(a) * 0.45;
        const v = [[-cx, 0, -cz], [cx, 0, cz], [cx, 0.5, cz], [-cx, 0.5, -cz]];
        const u = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const t of [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]) { P.push(...v[t]); UVs.push(...u[t]); N.push(0, 1, 0); }
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      const m = new THREE.MeshStandardMaterial({ map: Tex.get('grass'), alphaTest: 0.5, roughness: 1 });
      m.onBeforeCompile = sh => {
        sh.uniforms.time = uTime;
        sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float w = position.y * 0.35;
          transformed.x += sin(time*2.2 + wp.x*0.7 + wp.z*0.4) * w;
          transformed.z += cos(time*1.7 + wp.z*0.6) * w * 0.6;`);
      };
      this.mesh = new THREE.InstancedMesh(g, m, this.cap);
      this.mesh.frustumCulled = false;
      this.mesh.receiveShadow = true;
      this.mesh.count = 0;
      parent.add(this.mesh);
      this.cx = 1e9; this.cz = 1e9;
      this.color = new THREE.Color();
    }
    update(x, z) {
      if (!SETTINGS.grass || quality === 'low') { this.mesh.visible = false; return; }
      this.mesh.visible = true;
      if (Math.hypot(x - this.cx, z - this.cz) < 8) return;
      this.cx = x; this.cz = z;
      const W = this.W, T = W.T, R = 46, cs = 2;
      let n = 0;
      const m = new THREE.Matrix4();
      const gx0 = Math.floor((x - R) / cs), gx1 = Math.floor((x + R) / cs);
      const gz0 = Math.floor((z - R) / cs), gz1 = Math.floor((z + R) / cs);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const h0 = U.hashStr(gx + ':' + gz);
        const cnt = 2 + h0 % 4;
        for (let k = 0; k < cnt && n < this.cap; k++) {
          const hx = ((h0 >>> (k * 3)) & 1023) / 1023, hz = ((h0 >>> (k * 5 + 7)) & 1023) / 1023;
          const px = (gx + hx) * cs, pz = (gz + hz) * cs;
          if ((px - x) ** 2 + (pz - z) ** 2 > R * R) continue;
          const h = T.h(px, pz);
          if (h < 2.8) continue;
          const sl = Math.abs(T.h(px + 1, pz) - T.h(px - 1, pz)) + Math.abs(T.h(px, pz + 1) - T.h(px, pz - 1));
          if (sl > 1.6) continue;
          if (W.pois.some(p => (px - p.x) ** 2 + (pz - p.z) ** 2 < (p.r + 5) ** 2)) continue;
          if (W.roads.some(r => World.segDist(px, pz, r) < 4)) continue;
          const sc = 0.6 + ((h0 >>> (k * 2)) & 255) / 255 * 0.55;
          m.compose(new THREE.Vector3(px, h - 0.05, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hx * 6.28), new THREE.Vector3(sc, sc, sc));
          this.mesh.setMatrixAt(n, m);
          this.color.setHSL(0.24 + hz * 0.05, 0.45, 0.42 + hx * 0.16);
          this.mesh.setColorAt(n, this.color);
          n++;
        }
      }
      this.mesh.count = n;
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------- loot & chests ----------
  const lootModelCache = new Map();
  function lootModel(it) {
    let key, make;
    if (isWeapon(it)) { key = 'w' + it.w + it.r; make = () => Models.gun(it.w, it.r); }
    else if (isItem(it)) { key = 'c' + it.c; make = () => Models.item(it.c); }
    else if (it.a) { key = 'a' + it.a; make = () => Models.ammoBox(it.a); }
    else { key = 'm' + it.m; make = () => Models.matsIcon(it.m); }
    if (!lootModelCache.has(key)) lootModelCache.set(key, make());
    return lootModelCache.get(key).clone();
  }
  let glowMat = null, beamGeo = null;
  function addLoot(l) {
    const g = new THREE.Group();
    const model = lootModel(l.it);
    model.scale.setScalar(isWeapon(l.it) ? 1.25 : 1.6);
    model.position.y = 0.55;
    g.add(model);
    const rar = itemRarity(l.it);
    const col = l.it.a || l.it.m !== undefined ? 0xffffff : RARITY[rar].glow;
    if (!glowMat) { beamGeo = new THREE.CylinderGeometry(0.12, 0.28, 3.2, 10, 1, true); beamGeo.translate(0, 1.6, 0); }
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.get('glow'), color: col, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    ring.scale.set(1.6, 1.6, 1); ring.position.y = 0.4;
    g.add(ring);
    if (isWeapon(l.it) && rar >= 2) {
      const bm = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: Tex.get('beam'), color: col, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      bm.userData.sharedGeo = true;
      g.add(bm);
    }
    g.position.set(l.x, l.y + 0.05, l.z);
    g.userData.model = model;
    g.userData.phase = (l.id % 100) * 0.7;
    g.userData.born = G ? G.time : 0;
    worldGroup.add(g);
    lootMeshes.set(l.id, g);
  }
  function removeLoot(id) {
    const g = lootMeshes.get(id);
    if (!g) return;
    worldGroup.remove(g);
    g.traverse(o => { if (o.material && o.material.dispose && o.isSprite) o.material.dispose(); });
    lootMeshes.delete(id);
  }
  function addChest(c, abox) {
    const g = abox ? Models.ammoCrate() : Models.chest(c.vault);
    g.position.set(c.x, c.y, c.z);
    g.rotation.y = c.rot;
    if (!abox) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.get('glow'), color: c.vault ? 0xb07cff : 0xffd56a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      sp.scale.set(2.6, 2.6, 1); sp.position.y = 0.6;
      g.add(sp); g.userData.glow = sp;
    }
    if (c.open) openChestMesh(g);
    worldGroup.add(g);
    (abox ? aboxMeshes : chestMeshes).set(c.id, g);
  }
  function openChestMesh(g) {
    if (g.userData.lid) g.userData.lid.rotation.x = -1.9;
    if (g.userData.glow) g.userData.glow.visible = false;
    g.userData.open = true;
  }

  // ---------- avatars ----------
  const heldCache = new Map();
  function heldModel(code) {
    if (!heldCache.has(code)) {
      let m = null;
      if (code === 'pick') m = Models.pickaxe();
      else if (code.startsWith('w:')) { const [, w, r] = code.split(':'); m = Models.gun(w, +r); }
      else if (code.startsWith('c:')) { m = Models.item(code.slice(2)); }
      heldCache.set(code, m);
    }
    const m = heldCache.get(code);
    return m ? m.clone() : null;
  }
  function nameSprite(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 30px "Lilita One", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(name, 128, 32);
    g.fillStyle = '#fff'; g.fillText(name, 128, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
    s.scale.set(2.2, 0.55, 1); s.position.y = 2.35;
    return s;
  }
  function avatarFor(p) {
    let a = avatars.get(p.id);
    if (a) return a;
    a = Character.create(p.skin);
    if (p.human && p.id !== (window.LOCAL_ID || -1)) { a.tag = nameSprite(p.name); a.root.add(a.tag); }
    worldGroup.add(a.root);
    avatars.set(p.id, a);
    return a;
  }
  const animState = { state: '', code: '', flags: 0, pitch: 0, yaw: 0, vx: 0, vz: 0, onGround: true, swim: false, swing: 1, fire: 0, time: 0, dive: 0 };
  function animateAvatar(p, a, dt, isLocal, hideLocal) {
    const r = a.root;
    const st = p.state;
    const dx = p.rx - camera.position.x, dz = p.rz - camera.position.z;
    r.visible = p.alive && st !== 'bus' && !(isLocal && hideLocal) && Math.abs(dx) < 320 && Math.abs(dz) < 320;
    if (!r.visible) return;
    r.position.set(p.rx, p.ry, p.rz);
    r.rotation.y = p.ryaw;
    // held item
    const code = st === 'ground' ? (p.flags & FL.BUILD ? 'build' : p.held || '') : '';
    if (code !== a.held) Character.setHeld(a, code, code && code !== 'build' ? heldModel(code) : null);
    // far characters animate at a lower rate
    const d2 = dx * dx + dz * dz;
    const near = d2 < 65 * 65;
    if (a.mesh.castShadow !== near) { a.mesh.castShadow = near; if (a.heldMesh) a.heldMesh.traverse(o => { if (o.isMesh) o.castShadow = near; }); }
    const far = d2 > 110 * 110;
    a.skipT = (a.skipT || 0) + dt;
    if (far && a.skipT < 0.08) return;
    const adt = a.skipT; a.skipT = 0;
    const s = animState;
    s.state = st; s.code = code; s.flags = p.flags || 0; s.pitch = p.rpitch || 0; s.yaw = p.ryaw;
    s.vx = p.rvx || 0; s.vz = p.rvz || 0; s.onGround = p.onGroundR !== false; s.swim = !!(p.flags & FL.SWIM);
    s.swing = p.swingT !== undefined && G ? U.clamp((G.time - p.swingT) / 0.35, 0, 1) : 1;
    s.fire = p.fireAnim || 0; s.time = uTime.value; s.dive = p.dive || 0; s.vfwd = 0;
    Character.animate(a, s, adt);
    if (p.fireAnim) p.fireAnim = Math.max(0, p.fireAnim - adt * 8);
    if (a.tag) a.tag.visible = !!SETTINGS.showNames;
  }

  // ---------- events ----------
  function onEvent(ev) {
    if (!pieces) return;
    switch (ev.t) {
      case 'sAdd': { const p = G.structs.get(Build.keyOf(ev.p)); if (p) { pieces.remove(p.k); pieces.add(p); } break; }
      case 'sAdopt': pieces.refresh(ev.p); break;
      case 'sRem': {
        const s = pieces.slot.get(ev.k) || pieces.edited.get(ev.k);
        if (s && ev.why !== 'rej') FX.debris(ev.k, ev.mat, ev.type, ev.why === 'collapse');
        pieces.remove(ev.k);
        break;
      }
      case 'sClear': for (const k of ev.ks) pieces.remove(k); break;
      case 'sHp': { const p = G.structs.get(ev.k); if (p) { pieces.color(p); if (p.grow > 0) pieces.anim.add(p); } break; }
      case 'sEdit': { const p = G.structs.get(ev.k); if (p) pieces.refresh(p); break; }
      case 'pHp': propR.hit(ev.id); break;
      case 'pRem': { propR.kill(ev.id); const pr = G.props.byId.get(ev.id); if (pr) FX.propBreak(pr); break; }
      case 'lAdd': addLoot(ev.l); break;
      case 'lRem': removeLoot(ev.id); break;
      case 'lClear': for (const id of [...lootMeshes.keys()]) removeLoot(id); break;
      case 'chest': { const g = chestMeshes.get(ev.id); if (g) { openChestMesh(g); FX.sparkle(g.position, ev.vault ? 0xb07cff : 0xffd56a); } break; }
      case 'abox': { const g = aboxMeshes.get(ev.id); if (g) openChestMesh(g); break; }
      case 'pad': { const m = Models.pad(); m.position.set(ev.pad.x, ev.pad.box[1], ev.pad.z); worldGroup.add(m); padMeshes.set(ev.pad.id, m); break; }
      case 'padClear': for (const m of padMeshes.values()) worldGroup.remove(m); padMeshes.clear(); break;
    }
  }

  // ---------- frame ----------
  function frame(dt, view) {
    uTime.value += dt;
    if (!G) { Post.render(scene, camera, uTime.value); return; }
    const camP = camera.position;
    // sun & shadow follow camera target
    const focus = view.focus || camP;
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    sun.position.set(fx + SUN_DIR.x * 200, focus.y + SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
    sun.target.position.set(fx, focus.y, fz);
    skyMesh.position.copy(camP);
    if (waterMesh) { waterMesh.material.uniforms.camPos.value.copy(camP); waterMesh.position.x = Math.round(camP.x / 16) * 16; waterMesh.position.z = Math.round(camP.z / 16) * 16; }
    // storm
    const s = G.storm;
    if (stormMesh) stormMesh.visible = false;
    if (s && stormMesh) {
      stormMesh.visible = s.r < 600;
      stormMesh.scale.set(Math.max(1, s.r), 700, Math.max(1, s.r));
      stormMesh.position.x = s.cx; stormMesh.position.z = s.cz;
      stormMesh.material.uniforms.radius.value = Math.max(1, s.r);
    }
    stormTint += ((view.inStorm ? 1 : 0) - stormTint) * Math.min(1, dt * 3);
    fog.color.copy(FOG_COLOR).lerp(STORM_FOG, stormTint * 0.85);
    fog.density = 0.0016 + stormTint * 0.012;
    skyMesh.material.uniforms.storm.value = stormTint;
    if (waterMesh) { waterMesh.material.uniforms.fogColor.value.copy(fog.color); waterMesh.material.uniforms.fogDensity.value = fog.density; }
    // blimp
    if (blimpMesh) {
      const bp = G.busPos(Math.max(0, G.time - 3));
      const show = G.phase === 'bus' || (bp && bp.f < 1 && G.time < 60);
      blimpMesh.visible = !!show;
      if (show && bp) {
        blimpMesh.position.set(bp.x, bp.y + 6 + Math.sin(uTime.value * 0.6) * 0.6, bp.z);
        blimpMesh.rotation.set(Math.sin(uTime.value * 0.45) * 0.015, bp.yaw, Math.sin(uTime.value * 0.5) * 0.02);
        for (const pr of blimpMesh.userData.props) pr.rotation.z += dt * 18;
      }
    }
    pieces.tick();
    propR.tick(dt);
    updateClouds(dt);

    grass.update(focus.x, focus.z);
    // loot bob
    const t = uTime.value;
    for (const g of lootMeshes.values()) {
      const far = Math.abs(g.position.x - camP.x) > 85 || Math.abs(g.position.z - camP.z) > 85;
      g.visible = !far;
      if (far) continue;
      const m = g.userData.model;
      m.rotation.y = t * 1.2 + g.userData.phase;
      m.position.y = 0.55 + Math.sin(t * 2 + g.userData.phase) * 0.08;
    }
    for (const g of [...chestMeshes.values(), ...aboxMeshes.values()]) g.visible = Math.abs(g.position.x - camP.x) < 140 && Math.abs(g.position.z - camP.z) < 140;
    for (const g of chestMeshes.values()) {
      if (g.userData.glow && !g.userData.open) g.userData.glow.material.opacity = 0.45 + Math.sin(t * 3 + g.position.x) * 0.2;
    }
    // avatars
    for (const p of G.players.values()) {
      const a = avatarFor(p);
      animateAvatar(p, a, dt, p.id === view.localId, view.hideLocal);
    }
    FX.update(dt, camera);
    Post.uniforms.storm = stormTint;
    Post.render(scene, camera, uTime.value);
  }

  function project(v) {
    const p = new THREE.Vector3(v.x, v.y, v.z).project(camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  return {
    init, load, frame, onEvent, setQuality, resize, project, clearWorld,
    get camera() { return camera; }, get renderer() { return renderer; }, get scene() { return scene; },
    ghost: (d, ok) => ghost && ghost.show(d, ok),
    edit: (p, sel, hover, dir) => { if (!editOverlay) return; if (!p) editOverlay.hide(); else editOverlay.show(p, sel, hover, dir); },
    pieces: () => pieces, avatar: id => avatars.get(id), pieceMatrix, pieceGeo,
  };
})();
