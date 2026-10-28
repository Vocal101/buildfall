'use strict';
// Player characters. Each one is a single skinned mesh (one draw call) on a 17-bone rig, with a painted
// face, per-skin hair and outfit, hands that grip the held weapon through two-bone IK, and procedural
// animation for running, strafing, aiming, reloading, building, harvesting, skydiving, gliding and emotes.
// Characters face -Z. Positive rotation.x on a limb swings it forward.

const Character = (() => {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const TRS = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
  const ARM_UP = 0.29, ARM_LO = 0.27 + 0.055;
  const PELVIS_Y = 0.98;

  // ---------- geometry helpers ----------
  const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  const cap = (r, len, rs = 10) => new THREE.CapsuleGeometry(r, len, 4, rs);
  const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
  const tor = (R, r, rs = 8, ts = 22) => new THREE.TorusGeometry(R, r, rs, ts);
  const hemi = (r, cover = 0.5, w = 20, h = 10) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * cover);
  const lathe = (pts, s = 16) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), s);
  const shade = (c, f) => new THREE.Color(c).multiplyScalar(f).getHex();
  const hexCss = c => '#' + new THREE.Color(c).getHexString();

  // ---------- face atlas ----------
  // Left half: the head sphere's equirectangular map with the face painted at u = 0.75 (the -Z side).
  // Right half: white, used by every vertex-coloured part.
  const atlasCache = new Map();
  function atlas(si, sk) {
    if (atlasCache.has(si)) return atlasCache.get(si);
    const st = sk.style || {};
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(512, 0, 512, 512);
    g.fillStyle = hexCss(sk.skin); g.fillRect(0, 0, 512, 512);
    // subtle shading: darker towards the neck, warmer cheeks
    const sh = g.createLinearGradient(0, 390, 0, 512);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,20,10,0.18)');
    g.fillStyle = sh; g.fillRect(0, 390, 512, 122);
    g.save();
    g.translate(384, 0); g.scale(0.5, 1); // 1 unit is the same angle on both axes
    if (st.mask) paintMask(g, st, sk);
    else paintFace(g, st, sk, si);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    atlasCache.set(si, t);
    return t;
  }

  function paintFace(g, st, sk, si) {
    const eyeY = 236;
    const blush = st.paint === 'blush' ? 0.42 : 0.22;
    for (const sx of [-1, 1]) {
      const rg = g.createRadialGradient(sx * 92, 290, 4, sx * 92, 290, 44);
      rg.addColorStop(0, `rgba(255,90,90,${blush})`); rg.addColorStop(1, 'rgba(255,90,90,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(sx * 92, 290, 44, 0, 7); g.fill();
    }
    if (st.paint === 'stripes') {
      g.fillStyle = 'rgba(25,20,22,0.85)';
      for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) { g.beginPath(); g.ellipse(sx * (70 + i * 26), 286, 9, 26, sx * 0.25, 0, 7); g.fill(); }
    }
    if (st.paint === 'freckles') {
      g.fillStyle = 'rgba(140,70,40,0.55)';
      const R = U.rng(si * 31 + 7);
      for (let i = 0; i < 26; i++) { const sx = i % 2 ? 1 : -1; g.beginPath(); g.arc(sx * (40 + R() * 70), 262 + R() * 34, 3 + R() * 2.5, 0, 7); g.fill(); }
    }
    if (st.paint === 'star') {
      g.fillStyle = hexCss(sk.accent);
      g.save(); g.translate(104, 284); g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 18, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.fill(); g.restore();
    }
    // eyes
    for (const sx of [-1, 1]) {
      const ex = sx * 62;
      g.fillStyle = '#fbfbfb';
      g.beginPath(); g.ellipse(ex, eyeY, 25, 30, 0, 0, 7); g.fill();
      g.save(); g.beginPath(); g.ellipse(ex, eyeY, 25, 30, 0, 0, 7); g.clip();
      const ir = g.createRadialGradient(ex - sx * 3, eyeY + 2, 2, ex - sx * 3, eyeY + 2, 18);
      ir.addColorStop(0, hexCss(shade(st.eyes || 0x3b7fd6, 1.25))); ir.addColorStop(1, hexCss(shade(st.eyes || 0x3b7fd6, 0.6)));
      g.fillStyle = ir; g.beginPath(); g.arc(ex - sx * 3, eyeY + 2, 18, 0, 7); g.fill();
      g.fillStyle = '#101018'; g.beginPath(); g.arc(ex - sx * 3, eyeY + 2, 8.5, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(ex - sx * 3 - 7, eyeY - 8, 5, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(ex - sx * 3 + 6, eyeY + 9, 2.5, 0, 7); g.fill();
      // upper lid shadow
      const lid = g.createLinearGradient(0, eyeY - 30, 0, eyeY - 10);
      lid.addColorStop(0, 'rgba(40,20,20,0.45)'); lid.addColorStop(1, 'rgba(40,20,20,0)');
      g.fillStyle = lid; g.fillRect(ex - 30, eyeY - 32, 60, 24);
      g.restore();
      // lash line
      g.strokeStyle = '#1c1416'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.ellipse(ex, eyeY + 2, 27, 31, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(ex + sx * 24, eyeY - 14); g.lineTo(ex + sx * 34, eyeY - 20); g.stroke();
      // brow
      g.strokeStyle = hexCss(shade(sk.hair, sk.hair > 0xc00000 && st.cut !== 'helmet' ? 0.8 : 1)); g.lineWidth = 12;
      g.beginPath(); g.moveTo(ex - sx * 26, eyeY - 44); g.quadraticCurveTo(ex + sx * 4, eyeY - 56, ex + sx * 30, eyeY - 46); g.stroke();
    }
    // mouth
    g.strokeStyle = '#7a2e2a'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-40, 312); g.quadraticCurveTo(0, 338, 42, 308); g.stroke();
    g.strokeStyle = 'rgba(122,46,42,0.35)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-14, 336); g.quadraticCurveTo(0, 342, 14, 336); g.stroke();
  }

  // Masks are painted over the face area of the atlas (the skull covers the whole head, its base colour
  // being the skin tone). Glowing eyes, horns, filters and ears are added as geometry in maskParts().
  function paintMask(g, st, sk) {
    const egg = (cx, cy, rx, ry) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); };
    const radial = (x, y, r0, r1, c0, c1) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr; };
    const shell = (fill, edge) => {
      egg(0, 258, 152, 124); g.fillStyle = fill; g.fill();
      g.lineWidth = 7; g.strokeStyle = edge; g.stroke();
    };
    switch (st.mask) {
      case 'skull': {
        for (const sx of [-1, 1]) {
          g.fillStyle = radial(sx * 150, 240, 10, 80, 'rgba(70,52,36,0.38)', 'rgba(70,52,36,0)'); g.fillRect(sx * 150 - 80, 160, 160, 160);
          g.fillStyle = radial(sx * 92, 302, 4, 42, 'rgba(70,50,34,0.45)', 'rgba(70,50,34,0)'); g.fillRect(sx * 92 - 42, 260, 84, 84);
          // sockets: a soft dark rim and a black centre (the glowing eye sits inside)
          g.save(); g.translate(sx * 58, 240); g.rotate(sx * -0.18);
          g.fillStyle = radial(0, 0, 18, 50, 'rgba(25,12,10,0.95)', 'rgba(40,24,18,0)'); egg(0, 0, 52, 48); g.fill();
          g.fillStyle = '#070405'; egg(0, 2, 31, 27); g.fill();
          g.restore();
          g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 5; g.lineCap = 'round';
          g.beginPath(); g.ellipse(sx * 58, 240, 40, 36, 0, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
        }
        g.fillStyle = '#0b0606';
        g.beginPath(); g.moveTo(0, 268); g.bezierCurveTo(-10, 276, -22, 300, -9, 307); g.lineTo(0, 299); g.lineTo(9, 307); g.bezierCurveTo(22, 300, 10, 276, 0, 268); g.fill();
        g.fillStyle = '#24140f'; g.beginPath(); g.roundRect(-74, 318, 148, 36, 12); g.fill();
        for (let i = -4; i <= 4; i++) {
          const x = i * 15.5, w = 13 - Math.abs(i) * 0.6;
          g.fillStyle = '#f3eddd'; g.beginPath(); g.roundRect(x - w / 2, 320, w, 14, [2, 2, 5, 5]); g.fill();
          g.fillStyle = '#e2d9c3'; g.beginPath(); g.roundRect(x - w / 2, 337, w, 14, [5, 5, 2, 2]); g.fill();
        }
        g.strokeStyle = 'rgba(60,40,28,0.7)'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(-36, 140); g.lineTo(-26, 168); g.lineTo(-38, 184); g.lineTo(-24, 204); g.stroke();
        g.beginPath(); g.moveTo(-26, 168); g.lineTo(-10, 176); g.stroke();
        for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 84, 336); g.quadraticCurveTo(sx * 104, 346, sx * 118, 330); g.stroke(); }
        break;
      }
      case 'oni': {
        shell(radial(0, 240, 30, 170, '#e33a2c', '#8c1510'), '#2a0808');
        g.strokeStyle = 'rgba(70,6,6,0.55)'; g.lineWidth = 5; g.lineCap = 'round';
        for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-40 + i * 4, 172 + i * 12); g.quadraticCurveTo(0, 160 + i * 12, 40 - i * 4, 172 + i * 12); g.stroke(); }
        for (const sx of [-1, 1]) {
          // heavy brows sloping down to the nose
          g.fillStyle = '#140606';
          g.beginPath(); g.moveTo(sx * 18, 222); g.lineTo(sx * 104, 176); g.lineTo(sx * 110, 196); g.lineTo(sx * 26, 236); g.fill();
          g.save(); g.translate(sx * 62, 242); g.rotate(sx * -0.36);
          g.fillStyle = '#ffd23a'; egg(0, 0, 33, 16); g.fill(); g.lineWidth = 6; g.strokeStyle = '#140606'; g.stroke();
          g.fillStyle = '#140606'; egg(0, 0, 6, 13); g.fill();
          g.restore();
          g.fillStyle = '#3a0606'; egg(sx * 14, 292, 7, 9); g.fill();
          g.strokeStyle = '#ffcf40'; g.lineWidth = 5;
          g.beginPath(); g.moveTo(sx * 92, 270); g.quadraticCurveTo(sx * 128, 286, sx * 112, 318); g.quadraticCurveTo(sx * 100, 330, sx * 110, 342); g.stroke();
        }
        g.fillStyle = '#1a0505';
        g.beginPath(); g.moveTo(-84, 312); g.quadraticCurveTo(0, 300, 84, 312); g.quadraticCurveTo(60, 362, 0, 364); g.quadraticCurveTo(-60, 362, -84, 312); g.fill();
        g.fillStyle = '#f6efdc';
        for (const sx of [-1, 1]) {
          g.beginPath(); g.moveTo(sx * 36, 309); g.lineTo(sx * 56, 311); g.lineTo(sx * 46, 342); g.fill();
          g.beginPath(); g.moveTo(sx * 58, 356); g.lineTo(sx * 78, 348); g.lineTo(sx * 74, 314); g.fill();
        }
        for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 13 - 6, 307); g.lineTo(i * 13 + 6, 307); g.lineTo(i * 13, 318); g.fill(); }
        break;
      }
      case 'hockey': {
        shell(radial(-30, 210, 20, 180, '#fbf8ef', '#cfc7b4'), 'rgba(60,50,40,0.45)');
        g.fillStyle = '#c4161c';
        for (const sx of [-1, 1]) {
          g.beginPath(); g.moveTo(sx * 34, 186); g.lineTo(sx * 82, 186); g.lineTo(sx * 58, 210); g.fill();
          g.beginPath(); g.moveTo(sx * 80, 286); g.lineTo(sx * 112, 280); g.lineTo(sx * 100, 304); g.fill();
        }
        g.beginPath(); g.moveTo(-14, 150); g.lineTo(14, 150); g.lineTo(0, 172); g.fill();
        for (const sx of [-1, 1]) {
          g.save(); g.translate(sx * 58, 240); g.rotate(sx * 0.12);
          g.fillStyle = '#0c0a09'; egg(0, 0, 27, 19); g.fill();
          g.restore();
          g.fillStyle = '#8a8478'; g.beginPath(); g.arc(sx * 142, 232, 7, 0, 7); g.fill();
        }
        g.fillStyle = '#16120f';
        for (let row = 0; row < 4; row++) for (let i = -3; i <= 3; i++) {
          const x = i * 17 + (row % 2) * 8.5, y = 284 + row * 17;
          if (Math.abs(x) > 62 - row * 6 || (row === 0 && Math.abs(x) < 20)) continue;
          g.beginPath(); g.arc(x, y, 4.6, 0, 7); g.fill();
        }
        g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(60, 160); g.lineTo(96, 196); g.moveTo(-100, 300); g.lineTo(-70, 340); g.stroke();
        break;
      }
      case 'fox': {
        g.beginPath(); g.moveTo(0, 132); g.bezierCurveTo(110, 132, 150, 210, 140, 262); g.bezierCurveTo(130, 320, 50, 350, 0, 372); g.bezierCurveTo(-50, 350, -130, 320, -140, 262); g.bezierCurveTo(-150, 210, -110, 132, 0, 132);
        g.fillStyle = radial(0, 230, 20, 170, '#ffffff', '#dcd6cc'); g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(80,40,30,0.4)'; g.stroke();
        g.fillStyle = '#d8342c';
        g.beginPath(); g.moveTo(0, 150); g.quadraticCurveTo(18, 178, 0, 206); g.quadraticCurveTo(-18, 178, 0, 150); g.fill();
        for (const sx of [-1, 1]) {
          g.beginPath(); g.moveTo(sx * 22, 252); g.quadraticCurveTo(sx * 70, 222, sx * 118, 200); g.quadraticCurveTo(sx * 84, 238, sx * 30, 260); g.fill();
          g.save(); g.translate(sx * 60, 242); g.rotate(sx * -0.3);
          g.fillStyle = '#100808'; egg(0, 0, 25, 6.5); g.fill();
          g.restore();
          g.strokeStyle = '#d8342c'; g.lineWidth = 5; g.lineCap = 'round';
          for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(sx * 76, 290 + i * 10); g.lineTo(sx * 124, 280 + i * 16); g.stroke(); }
          g.strokeStyle = '#d9a640'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(sx * 110, 190); g.quadraticCurveTo(sx * 138, 236, sx * 128, 286); g.stroke();
        }
        g.fillStyle = '#100808'; egg(0, 318, 12, 8); g.fill();
        g.strokeStyle = '#100808'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(-30, 334); g.quadraticCurveTo(-14, 346, 0, 334); g.quadraticCurveTo(14, 346, 30, 334); g.stroke();
        break;
      }
      case 'gas': {
        shell(radial(-30, 220, 20, 170, '#3d433b', '#1c201b'), '#121512');
        for (const sx of [-1, 1]) {
          g.fillStyle = '#6a7066'; g.beginPath(); g.arc(sx * 60, 240, 41, 0, 7); g.fill();
          g.fillStyle = '#9aa196'; g.beginPath(); g.moveTo(sx * 60, 240); g.arc(sx * 60, 240, 41, Math.PI * 1.1, Math.PI * 1.6); g.fill();
          g.fillStyle = '#0a140c'; g.beginPath(); g.arc(sx * 60, 240, 31, 0, 7); g.fill();
          g.fillStyle = '#2b302a';
          for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.arc(sx * 60 + Math.cos(a) * 36, 240 + Math.sin(a) * 36, 3, 0, 7); g.fill(); }
        }
        g.fillStyle = '#2f342e'; g.beginPath(); g.roundRect(-58, 278, 116, 80, 30); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 4;
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-46, 292 + i * 16); g.lineTo(46, 292 + i * 16); g.stroke(); }
        break;
      }
      case 'cyber': {
        shell(radial(-40, 200, 10, 190, '#252a36', '#07080c'), hexCss(sk.accent));
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let y = 150; y < 380; y += 9) g.fillRect(-150, y, 300, 2);
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 4;
        g.beginPath(); g.ellipse(-40, 200, 70, 40, -0.4, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
        for (const sx of [-1, 1]) { g.fillStyle = radial(sx * 58, 242, 4, 46, hexCss(sk.visor) + '66', hexCss(sk.visor) + '00'); g.fillRect(sx * 58 - 46, 196, 92, 92); }
        g.fillStyle = radial(0, 322, 4, 60, hexCss(sk.accent) + '55', hexCss(sk.accent) + '00'); g.fillRect(-60, 262, 120, 120);
        break;
      }
    }
  }

  // ---------- material: vertex colours * atlas, a soft rim light and per-vertex glow ----------
  const matCache = new Map();
  function material(si, sk) {
    if (matCache.has(si)) return matCache.get(si);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas(si, sk), roughness: 0.6, metalness: 0.04 });
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float emis;\nvarying float vEmis;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmis = emis;');
      sh.fragmentShader = 'varying float vEmis;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
        {
          float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          outgoingLight += diffuseColor.rgb * rim * 0.45 + vec3(0.55, 0.72, 1.0) * rim * 0.10;
          outgoingLight += diffuseColor.rgb * vEmis * 2.6;
        }
        #include <opaque_fragment>`);
    };
    matCache.set(si, m);
    return m;
  }

  // ---------- rig ----------
  const BONES = [
    ['root', null, 0, 0, 0], ['pelvis', 'root', 0, PELVIS_Y, 0], ['spine', 'pelvis', 0, 0.1, 0], ['chest', 'spine', 0, 0.2, 0],
    ['neck', 'chest', 0, 0.3, 0], ['head', 'neck', 0, 0.07, 0],
    ['shL', 'chest', -0.22, 0.235, 0], ['elL', 'shL', 0, -ARM_UP, 0], ['haL', 'elL', 0, -0.27, 0],
    ['shR', 'chest', 0.22, 0.235, 0], ['elR', 'shR', 0, -ARM_UP, 0], ['haR', 'elR', 0, -0.27, 0],
    ['thL', 'pelvis', -0.098, -0.04, 0], ['knL', 'thL', 0, -0.44, 0], ['ftL', 'knL', 0, -0.44, 0],
    ['thR', 'pelvis', 0.098, -0.04, 0], ['knR', 'thR', 0, -0.44, 0], ['ftR', 'knR', 0, -0.44, 0],
  ];

  function create(skinIdx) {
    const si = ((skinIdx % SKINS.length) + SKINS.length) % SKINS.length;
    const sk = SKINS[si], st = sk.style || {};
    const B = {}, bones = [];
    for (const [n, par, x, y, z] of BONES) {
      const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z);
      b.userData.i = bones.length; bones.push(b); B[n] = b;
      if (par) B[par].add(b);
    }
    const parts = [];
    const P = (bone, geo, col, m, o = {}) => parts.push({ bone, geo, col, m, uv: o.uv, emis: o.emis || 0 });
    const at = (x, y, z, rx, ry, rz, sx, sy, sz) => TRS(x, y, z, rx, ry, rz, sx, sy, sz);
    const orient = (pos, dir, s) => new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize()), s || V3(1, 1, 1));

    const suit = sk.suit, acc = sk.accent, skin = sk.skin, hair = sk.hair;
    const pants = sk.pants || shade(suit, 0.5), suitDk = shade(suit, 0.72);
    const strap = 0x34302b, boot = 0x2e2924, sole = 0x17171a, glove = st.top === 'armor' ? shade(suit, 0.6) : 0x2d2f36;
    const metal = 0xb8c2cc, gold = 0xd8b24a, glowC = sk.visor;
    const glowE = st.glow ? 1 : 0;

    // pelvis
    P('pelvis', lathe([[0.001, -0.13], [0.14, -0.125], [0.18, -0.07], [0.185, 0], [0.176, 0.08], [0.165, 0.135], [0.001, 0.135]], 18), pants, at(0, 0, 0, 0, 0, 0, 1, 1, 0.76));
    P('pelvis', tor(0.177, 0.024), strap, at(0, 0.07, 0, Math.PI / 2, 0, 0, 1, 0.77, 1));
    P('pelvis', box(0.07, 0.052, 0.02), gold, at(0, 0.07, -0.138));
    for (const sx of [-1, 1]) P('pelvis', box(0.075, 0.08, 0.055), strap, at(sx * 0.16, 0.025, -0.05, 0, sx * 0.5, 0));
    // abdomen
    P('spine', lathe([[0.001, -0.03], [0.17, -0.03], [0.178, 0.08], [0.188, 0.2], [0.001, 0.2]], 18), suit, at(0, 0, 0, 0, 0, 0, 1, 1, 0.74));
    // chest
    P('chest', lathe([[0.001, -0.07], [0.186, -0.07], [0.205, 0.04], [0.222, 0.14], [0.216, 0.21], [0.175, 0.268], [0.085, 0.3], [0.001, 0.305]], 20), suit, at(0, 0, 0, 0, 0, 0, 1.08, 1, 0.7));
    if (st.top === 'jacket') {
      P('chest', tor(0.078, 0.03), suitDk, at(0, 0.285, 0.005, Math.PI / 2, 0, 0, 1, 0.85, 1.2));
      P('chest', box(0.014, 0.33, 0.012), metal, at(0, 0.1, -0.157));
      P('spine', box(0.014, 0.2, 0.012), metal, at(0, 0.08, -0.133));
      for (const sx of [-1, 1]) P('chest', box(0.08, 0.07, 0.02), suitDk, at(sx * 0.1, 0.11, -0.148, 0, sx * 0.3, 0));
      P('spine', tor(0.18, 0.02), acc, at(0, 0.0, 0, Math.PI / 2, 0, 0, 1, 0.76, 1));
    } else if (st.top === 'hoodie') {
      P('chest', sph(0.13, 14, 10), suitDk, at(0, 0.27, 0.085, 0, 0, 0, 1.08, 0.62, 0.75));
      for (const sx of [-1, 1]) P('chest', cyl(0.007, 0.007, 0.15, 5), 0xf4f4f4, at(sx * 0.04, 0.18, -0.152));
      P('spine', box(0.22, 0.09, 0.02), suitDk, at(0, 0.06, -0.13));
    } else if (st.top === 'vest') {
      const vc = shade(acc === 0x2b2b30 ? 0x3a3d44 : acc, 0.85);
      P('chest', box(0.33, 0.27, 0.05), vc, at(0, 0.1, -0.135));
      P('chest', box(0.33, 0.27, 0.05), vc, at(0, 0.1, 0.135));
      for (let i = 0; i < 3; i++) P('chest', box(0.075, 0.08, 0.045), strap, at(-0.105 + i * 0.105, 0.02, -0.165));
      for (const sx of [-1, 1]) P('chest', box(0.06, 0.04, 0.31), strap, at(sx * 0.115, 0.25, 0));
    } else if (st.top === 'armor') {
      P('chest', lathe([[0.001, 0.0], [0.205, 0.0], [0.228, 0.12], [0.216, 0.22], [0.13, 0.27], [0.001, 0.275]], 20), shade(acc, 0.9), at(0, 0, 0, 0, 0, 0, 1.1, 1, 0.74));
      P('chest', box(0.2, 0.014, 0.012), glowC, at(0, 0.14, -0.168), { emis: glowE });
      P('chest', box(0.012, 0.09, 0.012), glowC, at(0, 0.07, -0.166), { emis: glowE });
      P('spine', tor(0.182, 0.025), shade(acc, 0.7), at(0, 0.02, 0, Math.PI / 2, 0, 0, 1, 0.76, 1));
    }
    // shoulder pads
    for (const sx of [-1, 1]) {
      if (st.top === 'armor' || st.top === 'vest') P('chest', sph(0.1, 14, 10), st.top === 'armor' ? shade(acc, 0.9) : strap, at(sx * 0.225, 0.25, 0, 0, 0, sx * -0.3, 1.15, 0.72, 1.1));
      else P('chest', sph(0.085, 12, 8), suit, at(sx * 0.215, 0.235, 0));
    }
    // back bling
    if (st.back === 'pack') {
      P('chest', sph(0.16, 16, 12), shade(acc, 0.62), at(0, 0.11, 0.17, 0, 0, 0, 0.92, 1.05, 0.5));
      P('chest', sph(0.15, 16, 10), acc, at(0, 0.235, 0.168, 0, 0, 0, 0.94, 0.42, 0.53));
      P('chest', box(0.16, 0.09, 0.04), acc, at(0, 0.02, 0.245));
      P('chest', box(0.05, 0.03, 0.01), gold, at(0, 0.035, 0.267));
      for (const sx of [-1, 1]) P('chest', box(0.03, 0.31, 0.014), shade(acc, 0.5), at(sx * 0.1, 0.12, -0.154, 0.1, 0, 0));
    } else if (st.back === 'tank') {
      for (const sx of [-1, 1]) {
        P('chest', cyl(0.06, 0.06, 0.34, 14), metal, at(sx * 0.068, 0.12, 0.18));
        P('chest', sph(0.06, 14, 8), metal, at(sx * 0.068, 0.29, 0.18, 0, 0, 0, 1, 0.6, 1));
        P('chest', cyl(0.025, 0.025, 0.05, 8), shade(acc, 0.8), at(sx * 0.068, 0.33, 0.18));
        P('chest', tor(0.062, 0.012), glowC, at(sx * 0.068, 0.05, 0.18, Math.PI / 2, 0, 0), { emis: glowE });
      }
      P('chest', box(0.34, 0.035, 0.32), strap, at(0, 0.2, 0.02));
    } else if (st.back === 'wings') {
      for (const sx of [-1, 1]) {
        P('chest', box(0.34, 0.02, 0.12), shade(suit, 0.9), at(sx * 0.2, 0.16, 0.2, 0, 0, sx * 0.45));
        P('chest', box(0.34, 0.012, 0.02), acc, at(sx * 0.2, 0.16, 0.26, 0, 0, sx * 0.45), { emis: 1 });
      }
      P('chest', sph(0.09, 12, 8), shade(suit, 0.6), at(0, 0.14, 0.16, 0, 0, 0, 1, 1.2, 0.6));
      P('chest', sph(0.04, 10, 8), acc, at(0, 0.14, 0.215), { emis: 1 });
    } else if (st.back === 'scythe') {
      // staff across the back with the blade curling over the left shoulder
      const a = 0.55, dir = V3(-Math.sin(a), Math.cos(a), 0), top = V3(0, 0.14, 0.205).addScaledVector(dir, 0.56);
      P('chest', cyl(0.016, 0.016, 1.12, 8), 0x3b2a20, at(0, 0.14, 0.205, 0, 0, a));
      for (const t of [-0.45, 0.2]) P('chest', cyl(0.021, 0.021, 0.05, 8), shade(acc, 0.8), at(-Math.sin(a) * t, 0.14 + Math.cos(a) * t, 0.205, 0, 0, a));
      P('chest', box(0.06, 0.07, 0.04), 0x4a4f57, at(top.x, top.y, top.z, 0, 0, a));
      for (let i = 0; i < 7; i++) {
        const f = i / 6;
        P('chest', box(0.075, 0.07 - f * 0.05, 0.012), 0xc3ccd5, at(top.x + 0.04 + f * 0.36, top.y + 0.02 - f * f * 0.2, top.z, 0, 0, -0.15 - f * 0.8));
        P('chest', box(0.075, 0.012, 0.014), acc, at(top.x + 0.04 + f * 0.36, top.y - 0.014 - f * f * 0.2 + f * 0.02, top.z, 0, 0, -0.15 - f * 0.8), { emis: glowE * 0.8 });
      }
    } else if (st.back === 'blades') {
      // two crossed swords in dark scabbards
      for (const sx of [-1, 1]) {
        const a = sx * 0.62, z = 0.2 + sx * 0.012, dir = V3(-Math.sin(a), Math.cos(a), 0), top = V3(0, 0.12, z).addScaledVector(dir, 0.38);
        P('chest', box(0.034, 0.76, 0.02), 0x18181d, at(0, 0.12, z, 0, 0, a));
        P('chest', box(0.036, 0.04, 0.022), acc, at(Math.sin(a) * 0.3, 0.12 - Math.cos(a) * 0.3, z, 0, 0, a));
        P('chest', box(0.08, 0.014, 0.05), gold, at(top.x, top.y, top.z, 0, 0, a));
        P('chest', box(0.026, 0.17, 0.026), acc, at(top.x + dir.x * 0.09, top.y + dir.y * 0.09, top.z, 0, 0, a));
        P('chest', sph(0.018, 8, 6), gold, at(top.x + dir.x * 0.185, top.y + dir.y * 0.185, top.z));
      }
    } else if (st.back === 'board') {
      P('chest', cap(0.13, 0.42, 14), acc, at(0.02, 0.12, 0.19, 0, 0, 0.5, 1, 1, 0.15));
      P('chest', cap(0.135, 0.42, 14), 0xffffff, at(0.02, 0.12, 0.2, 0, 0, 0.5, 0.25, 1.01, 0.13));
    }
    // neck & head
    P('neck', cyl(0.05, 0.058, 0.13, 12), skin, at(0, 0.0, 0));
    P('head', headGeo(), 0xffffff, at(0, 0.1, 0, 0, 0, 0, 0.95, 1.06, 1), { uv: 'head' });
    if (!st.mask) P('head', sph(0.017, 10, 8), skin, at(0, 0.082, -0.129, -0.2, 0, 0, 0.85, 1.05, 1.0));
    for (const sx of [-1, 1]) P('head', sph(0.032, 10, 8), shade(skin, 0.94), at(sx * 0.122, 0.1, 0.005, 0, 0, 0, 0.45, 1, 0.75));
    hairFor(st.cut, P, at, orient, hair, acc, suit, glowC);
    if (st.mask) maskParts(st.mask, P, orient, sk);

    // arms
    for (const [s, sx] of [['L', -1], ['R', 1]]) {
      const sh = 'sh' + s, el = 'el' + s, ha = 'ha' + s;
      P(sh, sph(0.074, 12, 8), suit, at(0, -0.01, 0));
      P(sh, cap(0.068, 0.17), suit, at(0, -0.145, 0));
      P(el, sph(0.062, 12, 8), suit, at(0, 0, 0));
      if (st.top === 'vest' || st.top === 'armor') {
        P(el, cap(0.057, 0.16), st.top === 'armor' ? suitDk : skin, at(0, -0.12, 0));
        P(el, cyl(0.067, 0.061, 0.1, 12), st.top === 'armor' ? shade(acc, 0.9) : strap, at(0, -0.17, 0));
        if (st.top === 'armor') P(el, box(0.012, 0.08, 0.012), glowC, at(sx * 0.058, -0.15, 0), { emis: glowE });
      } else {
        P(el, cap(0.059, 0.16), suit, at(0, -0.12, 0));
        P(el, cyl(0.065, 0.065, 0.045, 12), st.top === 'hoodie' ? suitDk : acc, at(0, -0.22, 0));
      }
      // glove: palm, finger block, thumb and knuckle guard
      P(ha, sph(0.056, 12, 8), glove, at(0, -0.045, 0, 0, 0, 0, 0.74, 1, 1.05));
      P(ha, sph(0.05, 12, 8), glove, at(-sx * 0.004, -0.095, -0.008, 0.25, 0, 0, 0.72, 0.95, 1.0));
      P(ha, cap(0.02, 0.04, 6), glove, at(-sx * 0.03, -0.05, -0.038, 0.7, 0, -sx * 0.3));
      P(ha, box(0.032, 0.032, 0.07), shade(acc, 0.85), at(sx * 0.034, -0.07, -0.005));
    }
    // legs
    for (const [s, sx] of [['L', -1], ['R', 1]]) {
      const th = 'th' + s, kn = 'kn' + s, ft = 'ft' + s;
      P(th, lathe([[0.001, 0.05], [0.098, 0.04], [0.102, -0.05], [0.09, -0.25], [0.075, -0.42], [0.001, -0.45]], 14), pants, at(0, 0, 0));
      P(th, box(0.032, 0.13, 0.1), shade(pants, 0.8), at(sx * 0.097, -0.15, 0));
      P(th, box(0.006, 0.13, 0.004), shade(pants, 0.6), at(sx * 0.114, -0.15, -0.035));
      P(kn, sph(0.075, 12, 8), pants, at(0, 0, 0));
      P(kn, sph(0.068, 12, 8), st.top === 'armor' ? shade(acc, 0.9) : shade(pants, 0.7), at(0, 0.0, -0.045, 0, 0, 0, 1, 1.1, 0.55));
      P(kn, lathe([[0.001, 0.0], [0.074, -0.01], [0.072, -0.12], [0.063, -0.38], [0.001, -0.4]], 14), pants, at(0, 0, 0));
      P(ft, cyl(0.075, 0.07, 0.13, 12), boot, at(0, 0.035, 0));
      P(ft, sph(0.082, 14, 10), boot, at(0, -0.015, -0.055, 0, 0, 0, 0.88, 0.62, 1.7));
      P(ft, sph(0.066, 12, 8), shade(boot, 1.35), at(0, -0.022, -0.14, 0, 0, 0, 0.95, 0.65, 1.0));
      P(ft, box(0.14, 0.028, 0.31), sole, at(0, -0.046, -0.055));
      P(ft, box(0.07, 0.012, 0.08), acc, at(0, 0.02, -0.098, -0.45, 0, 0));
      P(ft, tor(0.074, 0.012, 6, 16), acc, at(0, 0.095, 0, Math.PI / 2, 0, 0));
    }

    // merge into one skinned geometry
    B.root.updateMatrixWorld(true);
    const pos = [], nor = [], col = [], uv = [], sIdx = [], sW = [], em = [], idx = [];
    const c = new THREE.Color(), nm = new THREE.Matrix3(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const p of parts) {
      const g = p.geo, b = B[p.bone];
      M.multiplyMatrices(b.matrixWorld, p.m);
      nm.getNormalMatrix(M);
      const base = pos.length / 3;
      const PA = g.attributes.position, NA = g.attributes.normal, UA = g.attributes.uv;
      c.set(p.col);
      for (let i = 0; i < PA.count; i++) {
        v.fromBufferAttribute(PA, i).applyMatrix4(M); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(NA, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
        col.push(c.r, c.g, c.b);
        if (p.uv === 'head' && UA) uv.push(UA.getX(i) * 0.5, UA.getY(i)); else uv.push(0.75, 0.5);
        sIdx.push(b.userData.i, 0, 0, 0); sW.push(1, 0, 0, 0); em.push(p.emis);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < PA.count; i++) idx.push(base + i);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
    geo.setAttribute('emis', new THREE.Float32BufferAttribute(em, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geo, material(si, sk));
    mesh.add(B.root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true; mesh.receiveShadow = false;
    // a generous fixed bound lets the renderer cull characters that are off screen, whatever the pose
    mesh.boundingSphere = new THREE.Sphere(V3(0, 1.1, 0), 2.6);

    const root = new THREE.Group();
    root.add(mesh);
    const gunMount = new THREE.Group(); B.spine.add(gunMount);
    const handMount = new THREE.Group(); handMount.position.set(0, -0.07, -0.005); B.haR.add(handMount);
    const glider = makeGlider(sk); glider.visible = false; root.add(glider);
    return {
      root, mesh, B, gunMount, handMount, glider, skin: si,
      walk: 0, hipYaw: 0, moveW: 0, ikW: 0, gliderT: 0, roll: 0, lastYaw: 0, held: '', heldMesh: null, hold: null,
      // kept for older call sites
      get head() { return B.head; }, get torso() { return B.chest; },
    };
  }

  // head sphere narrowed into a jaw with the chin pulled slightly forward
  function headGeo() {
    const g = new THREE.SphereGeometry(0.13, 32, 22);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (y < 0) {
        const f = -y / 0.13;
        pa.setX(i, x * (1 - 0.2 * f * f));
        pa.setZ(i, z < 0 ? z * (1 + 0.05 * f) : z * (1 - 0.18 * f));
      }
      if (y > 0.02 && z < 0) pa.setZ(i, z * 0.97);
    }
    g.computeVertexNormals();
    return g;
  }

  function hairFor(cut, P, at, orient, hair, acc, suit, glowC) {
    const hd = shade(hair, 0.82), hl = shade(hair, 1.18);
    const capHair = (r = 0.14, rx = 0.36, cover = 0.5, col = hair) => P('head', hemi(r, cover), col, at(0, 0.108, 0.008, rx, 0, 0, 1, 1.04, 1.04));
    switch (cut) {
      case 'swoop':
        capHair();
        P('head', sph(0.12, 16, 12), hair, at(0.0, 0.19, 0.01, 0, 0, 0, 1.12, 0.62, 1.18));
        // front quiff sweeping to the right
        P('head', sph(0.06, 12, 10), hl, at(0.03, 0.225, -0.095, 0.3, 0, -0.5, 1.5, 0.75, 0.9));
        P('head', sph(0.05, 12, 10), hair, at(-0.055, 0.21, -0.1, 0.25, 0, 0.4, 1.3, 0.7, 0.85));
        for (const sx of [-1, 1]) P('head', sph(0.045, 10, 8), hd, at(sx * 0.115, 0.13, -0.035, 0, 0, 0, 0.5, 1.2, 0.9));
        break;

      case 'spiky': {
        capHair(0.14, 0.32);
        const R = U.rng(5);
        for (let i = 0; i < 11; i++) {
          const a = -0.5 + (i / 10) * Math.PI * 1.2 + R() * 0.2, up = 0.55 + R() * 0.4;
          const d = V3(Math.cos(a) * 0.65, up, Math.sin(a) * 0.65 + 0.25);
          P('head', cone(0.045, 0.16 + R() * 0.05, 6), i % 3 ? hair : hl, orient(V3(Math.cos(a) * 0.06, 0.19, Math.sin(a) * 0.06 + 0.02), d));
        }
        break;
      }
      case 'beanie':
        P('head', cap(0.03, 0.12), hair, at(-0.05, 0.165, -0.12, 0, 0, 1.3));
        P('head', cap(0.028, 0.1), hair, at(0.06, 0.16, -0.122, 0, 0, -1.2));
        P('head', hemi(0.15, 0.52), acc, at(0, 0.118, 0.004, 0.22, 0, 0, 1, 1.12, 1.04));
        P('head', tor(0.143, 0.024, 8, 24), shade(acc, 0.86), at(0, 0.135, 0.01, Math.PI / 2 + 0.22, 0, 0, 1.0, 1.05, 1));
        P('head', sph(0.05, 12, 10), shade(suit, 1.0), at(0, 0.29, 0.03));
        break;
      case 'cap':
        P('head', hemi(0.137, 0.5, 18, 8), hd, at(0, 0.1, 0.01, 0.45, 0, 0, 1, 1, 1.04));
        P('head', hemi(0.145, 0.5), acc, at(0, 0.125, 0.004, 0.15, 0, 0, 1, 0.92, 1.04));
        P('head', cyl(0.11, 0.11, 0.012, 20), shade(acc, 0.8), at(0, 0.148, -0.155, -0.12, 0, 0, 1, 1, 1.15));
        P('head', sph(0.018, 8, 6), shade(acc, 0.7), at(0, 0.258, 0.0));
        break;
      case 'bun':
        capHair(0.14, 0.38);
        P('head', sph(0.07, 14, 12), hair, at(0, 0.25, 0.06));
        P('head', tor(0.05, 0.014), acc, at(0, 0.215, 0.05, 0.9, 0, 0), { emis: 0.6 });
        P('head', sph(0.05, 12, 10), hl, at(-0.04, 0.215, -0.095, 0.3, 0, 0.4, 1.4, 0.7, 0.85));
        P('head', cap(0.03, 0.14), hair, at(0.1, 0.07, -0.06, 0.15, 0, -0.05));
        break;
      case 'curly': {
        capHair(0.142, 0.34);
        const R = U.rng(9);
        for (let i = 0; i < 22; i++) {
          const th = R() * Math.PI * 0.55, ph = R() * Math.PI * 2;
          if (Math.sin(ph) < -0.55 && th > 0.95) continue; // keep the face clear
          const d = V3(Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
          P('head', sph(0.055 + R() * 0.02, 10, 8), i % 4 ? hair : hl, at(d.x * 0.15, 0.12 + d.y * 0.15, 0.01 + d.z * 0.15));
        }
        break;
      }
      case 'helmet':
        // open-face helmet with a glowing visor over the eyes
        P('head', hemi(0.158, 0.56, 24, 12), shade(suit, 1.35), at(0, 0.1, 0.012, 0.42, 0, 0, 1, 1.08, 1.04));
        P('head', new THREE.SphereGeometry(0.15, 24, 6, Math.PI * 1.5 - 1.0, 2.0, Math.PI * 0.4, Math.PI * 0.15), glowC, at(0, 0.098, 0.0, 0, 0, 0, 1, 1.06, 1.0), { emis: 0.85 });
        for (const sx of [-1, 1]) P('head', cyl(0.042, 0.042, 0.035, 14), acc, at(sx * 0.13, 0.1, 0.0, 0, 0, Math.PI / 2), { emis: 0.5 });
        P('head', box(0.02, 0.05, 0.16), acc, at(0, 0.26, 0.02, 0.2, 0, 0), { emis: 0.6 });
        break;
      case 'pony':
        capHair(0.141, 0.36);
        P('head', cap(0.05, 0.16), hl, at(0.0, 0.2, -0.095, -0.5, 0, 1.4, 1, 1, 0.8));
        P('head', sph(0.055, 12, 10), hair, at(0, 0.2, 0.135));
        P('head', tor(0.04, 0.012), acc, at(0, 0.18, 0.165, 1.2, 0, 0));
        P('head', cap(0.045, 0.16), hair, at(0, 0.06, 0.19, 0.3, 0, 0));
        P('head', cone(0.04, 0.1, 8), hd, at(0, -0.07, 0.215, Math.PI + 0.3, 0, 0));
        break;
      case 'buzz':
        capHair(0.134, 0.42, 0.52, hd);
        break;
      case 'mohawk':
        capHair(0.133, 0.42, 0.5, shade(hair, 0.45));
        for (let i = 0; i < 6; i++) {
          const a = -0.9 + i * 0.42;
          P('head', cone(0.045, 0.13, 6), i % 2 ? hair : hl, at(0, 0.1 + Math.cos(a) * 0.14, Math.sin(a) * 0.14, a * 0.9, 0, 0, 0.38, 1, 1));
        }
        break;
      case 'hood': {
        // deep cloth hood framing the face, with a pointed tip at the back
        const hc = shade(suit, 0.9), hcd = shade(suit, 0.6);
        P('head', hemi(0.172, 0.62, 24, 12), hc, at(0, 0.1, 0.01, 0.5, 0, 0, 1, 1.1, 1.06));
        P('head', tor(0.124, 0.014, 8, 28), hcd, at(0, 0.1, -0.09, 0.12, 0, 0, 0.98, 1.18, 1));
        P('head', cone(0.06, 0.16, 10), hc, at(0, 0.21, 0.13, -2.2, 0, 0));
        P('head', lathe([[0.15, 0.0], [0.18, -0.08], [0.22, -0.17], [0.0, -0.17]], 20), hcd, at(0, -0.02, 0.04, 0, 0, 0, 1, 1, 0.9));
        break;
      }
      case 'shag': {
        capHair(0.142, 0.34);
        const R = U.rng(13);
        for (let i = 0; i < 16; i++) {
          const a = -0.4 + (i / 15) * (Math.PI + 0.8);
          const x = Math.cos(a) * 0.13, z = Math.sin(a) * 0.12 + 0.02;
          P('head', sph(0.034, 10, 8), i % 3 ? hair : hl, at(x * 1.02, 0.1 - R() * 0.04, z * 1.02, 0.2 * Math.sin(a), 0, -0.3 * Math.cos(a), 0.6, 2.0 + R() * 0.6, 0.6));
        }
        P('head', sph(0.06, 12, 10), hd, at(0.04, 0.2, -0.1, 0.4, 0, -0.4, 1.4, 0.6, 0.8));
        break;
      }
      case 'oni': {
        capHair(0.143, 0.3);
        const R = U.rng(21);
        for (let i = 0; i < 9; i++) {
          const a = 0.35 + (i / 8) * (Math.PI - 0.7) + R() * 0.15;
          P('head', cone(0.05, 0.2 + R() * 0.06, 6), i % 3 ? hair : hl, orient(V3(Math.cos(a) * 0.08, 0.17, Math.sin(a) * 0.06 + 0.06), V3(Math.cos(a) * 0.5, 0.35, 0.9)));
        }
        break;
      }
      case 'fox':
        capHair(0.141, 0.36);
        P('head', cap(0.05, 0.22), hair, at(0, 0.03, 0.17, 0.25, 0, 0));
        P('head', tor(0.045, 0.012), acc, at(0, 0.15, 0.165, 1.25, 0, 0));
        for (const sx of [-1, 1]) {
          P('head', cone(0.055, 0.13, 4), 0xf6f3ee, orient(V3(sx * 0.075, 0.24, 0.0), V3(sx * 0.35, 1, 0.1)));
          P('head', cone(0.032, 0.09, 4), acc, orient(V3(sx * 0.076, 0.235, -0.022), V3(sx * 0.35, 1, 0.1)));
        }
        break;
      case 'cyber':
        P('head', hemi(0.152, 0.52, 24, 12), shade(suit, 1.4), at(0, 0.1, 0.012, 0.42, 0, 0, 1, 1.08, 1.04));
        for (const sx of [-1, 1]) {
          P('head', cyl(0.045, 0.045, 0.04, 16), shade(suit, 1.8), at(sx * 0.13, 0.1, 0.005, 0, 0, Math.PI / 2));
          P('head', tor(0.03, 0.006, 6, 16), glowC, at(sx * 0.152, 0.1, 0.005, 0, Math.PI / 2, 0), { emis: 1 });
        }
        P('head', box(0.014, 0.12, 0.014), shade(suit, 1.8), at(0.09, 0.27, 0.05, 0, 0, -0.3));
        P('head', sph(0.016, 8, 6), acc, at(0.108, 0.33, 0.05), { emis: 1 });
        break;
      default: capHair();
    }
  }

  // a point on the face, from atlas coordinates (the scaled face space of paintFace) to head space
  function headPt(ax, ay, lift = 0) {
    const phi = (0.75 + ax / 1024) * Math.PI * 2, th = ay / 512 * Math.PI, r = 0.13 * (1 + lift);
    let x = -r * Math.cos(phi) * Math.sin(th), y = r * Math.cos(th), z = r * Math.sin(phi) * Math.sin(th);
    if (y < 0) { const f = -y / 0.13; x *= 1 - 0.2 * f * f; z = z < 0 ? z * (1 + 0.05 * f) : z * (1 - 0.18 * f); }
    if (y > 0.02 && z < 0) z *= 0.97;
    return { pos: V3(x * 0.95, y * 1.06 + 0.1, z), n: V3(x / 0.95, y / 1.06, z).normalize() };
  }
  function maskParts(mask, P, orient, sk) {
    const glowC = sk.visor, acc = sk.accent;
    const onFace = (ax, ay, lift, geo, col, o, spin = 0) => {
      const h = headPt(ax, ay, lift);
      const m = orient(h.pos, h.n);
      if (spin) m.multiply(new THREE.Matrix4().makeRotationY(spin));
      P('head', geo, col, m, o);
    };
    switch (mask) {
      case 'skull':
        for (const sx of [-1, 1]) onFace(sx * 58, 242, -0.07, sph(0.017, 10, 8), glowC, { emis: 1 });
        break;
      case 'oni':
        for (const sx of [-1, 1]) {
          const h = headPt(sx * 86, 150, -0.05), d = V3(-sx * 0.55, 1, -0.35);
          P('head', cone(0.034, 0.17, 10), 0xf1e6c6, orient(h.pos, d));
          P('head', cone(0.014, 0.06, 8), 0xd8b24a, orient(h.pos.clone().addScaledVector(d.clone().normalize(), 0.1), d));
        }
        break;
      case 'hockey':
        P('head', new THREE.TorusGeometry(0.136, 0.01, 6, 24, Math.PI * 1.25), 0x2a2622, new THREE.Matrix4().compose(V3(0, 0.125, 0.006), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -Math.PI * 0.125)), V3(0.98, 1.02, 1)));
        break;
      case 'gas':
        for (const sx of [-1, 1]) {
          onFace(sx * 60, 240, 0.0, cyl(0.032, 0.034, 0.016, 18), 0x5a6056);
          onFace(sx * 60, 240, 0.04, cyl(0.026, 0.026, 0.006, 18), glowC, { emis: 0.9 });
          onFace(sx * 108, 330, 0.02, cyl(0.026, 0.03, 0.05, 12), 0x2b302a);
          onFace(sx * 108, 330, 0.24, cyl(0.03, 0.03, 0.014, 12), shade(acc, 1.2));
        }
        onFace(0, 322, 0.08, cyl(0.04, 0.046, 0.06, 16), 0x3a4038);
        onFace(0, 322, 0.32, cyl(0.046, 0.046, 0.02, 16), 0x22261f);
        onFace(0, 322, 0.4, cyl(0.03, 0.03, 0.006, 16), 0x4a5246);
        break;
      case 'cyber':
        // angry LED eyes and a segmented LED mouth
        for (const sx of [-1, 1]) onFace(sx * 58, 244, 0.0, box(0.052, 0.008, 0.013), glowC, { emis: 1 }, -sx * 0.4);
        for (let i = -3; i <= 3; i++) onFace(i * 13, 322 - Math.abs(i) * 2.5, -0.005, box(0.0085, 0.008, 0.014 - Math.abs(i) * 0.0012), acc, { emis: 1 });
        break;
    }
  }


  // ---------- glider ----------
  function makeGlider(sk) {
    const g = new THREE.Group();
    const seg = 14, ch = 5;
    const pos = [], uvs = [], idx = [];
    for (let j = 0; j <= ch; j++) for (let i = 0; i <= seg; i++) {
      const u = i / seg * 2 - 1, v = j / ch;
      const x = u * 2.1, z = -0.95 + v * 1.9;
      const y = 0.6 * (1 - u * u) + 0.14 * Math.sin(Math.PI * v) - 0.1 * v;
      pos.push(x, y, z); uvs.push(i / seg, v);
    }
    // painted canopy: bold stripes, a dark trailing edge and a light leading edge
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const x2 = cv.getContext('2d');
    const cols = [hexCss(sk.accent), hexCss(sk.suit), '#f6f6f6'];
    for (let i = 0; i < 9; i++) { x2.fillStyle = cols[i % 3]; x2.fillRect(i * 512 / 9, 0, 512 / 9 + 1, 128); }
    x2.fillStyle = 'rgba(0,0,0,0.35)'; x2.fillRect(0, 0, 512, 10);
    x2.fillStyle = 'rgba(255,255,255,0.4)'; x2.fillRect(0, 118, 512, 10);
    x2.strokeStyle = 'rgba(0,0,0,0.25)'; x2.lineWidth = 2;
    for (let i = 1; i < 9; i++) { x2.beginPath(); x2.moveTo(i * 512 / 9, 0); x2.lineTo(i * 512 / 9, 128); x2.stroke(); }
    const ctex = new THREE.CanvasTexture(cv); ctex.colorSpace = THREE.SRGBColorSpace; ctex.anisotropy = 4;
    for (let j = 0; j < ch; j++) for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    cg.setIndex(idx); cg.computeVertexNormals();
    const canopy = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: ctex, side: THREE.DoubleSide, roughness: 0.55 }));
    canopy.castShadow = true;
    canopy.position.y = 2.72;
    g.add(canopy);
    // leading edge tube and hand bar
    const edgePts = []; for (let i = 0; i <= seg; i++) { const u = i / seg * 2 - 1; edgePts.push(V3(u * 2.1, 2.72 + 0.6 * (1 - u * u) - 0.02, -0.95)); }
    const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePts), 24, 0.045, 6), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.5 }));
    edge.castShadow = true; g.add(edge);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.6 }));
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.06, -0.06); g.add(bar);
    // rigging lines
    const lp = [];
    for (const sx of [-1, 1]) for (const u of [0.15, 0.55, 0.95]) for (const zz of [-0.9, 0.85]) {
      const y = 2.72 + 0.6 * (1 - u * u) + (zz > 0 ? -0.1 : 0);
      lp.push(sx * 0.33, 2.06, -0.06, sx * u * 2.1, y, zz);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7 })));
    g.userData.canopy = canopy;
    // pivot at the hand bar so the deploy animation unfolds from the hands
    const pivot = new THREE.Group(); pivot.position.y = 2.06;
    g.position.y = -2.06; pivot.add(g);
    pivot.userData.canopy = canopy;
    return pivot;
  }

  // ---------- held items ----------
  // Weapons sit on a mount on the spine (so aiming pitch carries them) and the hands are solved onto
  // grip points; harvesting tools and consumables sit in the right hand.
  const HOLD = {
    rifle: { m: [0.22, 0.28, -0.31], tw: -0.6, s: 0.95 },
    smg: { m: [0.21, 0.28, -0.33], tw: -0.5, s: 1.0 },
    pistol: { m: [0.04, 0.33, -0.47], tw: -0.12, s: 1.2, two: true },
    launcher: { m: [0.17, 0.47, -0.06], tw: -0.35, s: 1.0 },
    minigun: { m: [0.13, 0.1, -0.24], tw: -0.3, s: 1.0 },
  };
  function setHeld(a, code, mesh) {
    if (a.heldMesh && a.heldMesh.parent) a.heldMesh.parent.remove(a.heldMesh);
    a.heldMesh = mesh; a.held = code; a.hold = null;
    if (!mesh) return;
    if (code.startsWith('w:')) {
      a.hold = HOLD[mesh.userData.hold || 'rifle'] || HOLD.rifle;
      mesh.scale.setScalar(a.hold.s);
      mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0);
      a.gunMount.add(mesh);
    } else if (code === 'pick') {
      mesh.position.set(0, 0, 0.02); mesh.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
      a.handMount.add(mesh);
    } else {
      mesh.position.set(0, -0.02, -0.02); mesh.rotation.set(0, 0, 0); mesh.scale.setScalar(0.72);

      a.handMount.add(mesh);
    }
  }

  // ---------- animation ----------
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function R(b, x, y, z, k, order) {
    _e.set(x, y, z, order || 'XYZ'); _q.setFromEuler(_e);
    if (k >= 1) b.quaternion.copy(_q); else b.quaternion.slerp(_q, k);
  }
  const _S = V3(), _T = V3(), _d = V3(), _pl = V3(), _u = V3(), _E = V3(), _f = V3(), _dn = V3();
  const _qp = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _ql = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qid = new THREE.Quaternion();
  // two-bone IK: put the hand of `side` on world point `target`, elbow bending towards `pole` (chest space)
  function ik(a, side, target, pole, w) {
    const sh = a.B['sh' + side], el = a.B['el' + side], ha = a.B['ha' + side];
    sh.parent.getWorldQuaternion(_qp);
    sh.getWorldPosition(_S);
    _d.subVectors(target, _S);
    const dist = U.clamp(_d.length(), 0.08, ARM_UP + ARM_LO - 0.002);
    _d.normalize();
    const cosA = (ARM_UP * ARM_UP + dist * dist - ARM_LO * ARM_LO) / (2 * ARM_UP * dist);
    const A = Math.acos(U.clamp(cosA, -1, 1));
    _pl.copy(pole).applyQuaternion(_qp);
    _pl.addScaledVector(_d, -_pl.dot(_d)).normalize();
    _u.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_pl, Math.sin(A));
    _E.copy(_S).addScaledVector(_u, ARM_UP);
    _f.copy(_S).addScaledVector(_d, dist).sub(_E).normalize();
    _dn.set(0, -1, 0).applyQuaternion(_qp);
    _qs.setFromUnitVectors(_dn, _u).multiply(_qp);              // shoulder, world
    _ql.copy(_qp).invert().multiply(_qs);
    sh.quaternion.slerp(_ql, w);
    _qe.setFromUnitVectors(_u, _f).multiply(_qs);                 // elbow, world
    _ql.copy(_qs).invert().multiply(_qe);
    el.quaternion.slerp(_ql, w);
    ha.quaternion.slerp(_qid, w);
  }
  const POLE_R = V3(0.8, -1, 0.45), POLE_L = V3(-0.9, -1, 0.1);
  const GRIP = V3(), FORE = V3();

  // s: { state, code, flags, pitch, yaw, vx, vz, onGround, swim, swing (0..1, 1 = idle), fire (0..1), time, menu }
  function animate(a, s, dt) {
    const B = a.B, t = s.time;
    const k = Math.min(1, dt * 11), kf = Math.min(1, dt * 22);
    const pitch = s.pitch || 0;
    const fl = s.flags || 0;
    // yaw rate (for glide banking)
    const dy = U.wrapAngle(s.yaw - a.lastYaw); a.lastYaw = s.yaw;
    a.roll += (U.clamp(-dy / Math.max(dt, 1e-3) * 0.12, -0.5, 0.5) - a.roll) * Math.min(1, dt * 4);
    let ikTarget = 0;
    a.glider.visible = s.state === 'glide';
    if (a.glider.visible) {
      a.gliderT += dt;
      const e = Math.min(1, a.gliderT / 0.35), sc = 0.25 + 0.75 * (1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2));
      a.glider.scale.set(sc, Math.min(1, e * 1.4), sc);
      a.glider.rotation.z = a.roll * 0.6;
      a.glider.userData.canopy.position.y = 2.72 + Math.sin(t * 2.2) * 0.03;
    } else a.gliderT = 0;
    const gunHeld = a.hold && s.code.startsWith('w:');
    if (a.gunMount.children.length) a.gunMount.visible = s.state === 'ground';
    if (a.handMount.children.length) a.handMount.visible = s.state === 'ground';

    if (s.state === 'sky') {
      const dive = s.dive || 0;
      const wob = Math.sin(t * 7.3) * 0.05, wob2 = Math.sin(t * 5.1 + 1) * 0.05;
      B.pelvis.position.y += (PELVIS_Y + 0.15 - B.pelvis.position.y) * k;
      R(B.pelvis, -1.3 - dive * 0.45, 0, a.roll * 0.8, k);
      R(B.spine, 0.05 - dive * 0.1, 0, 0, k); R(B.chest, 0.05, 0, 0, k);
      R(B.neck, 0.45, 0, 0, k); R(B.head, 0.55 + dive * 0.2, 0, 0, k);
      R(B.shL, U.lerp(0.35, -0.15, dive) + wob, 0, U.lerp(-1.65, -0.3, dive), k); R(B.elL, U.lerp(0.6, 0.05, dive), 0, 0, k);
      R(B.shR, U.lerp(0.35, -0.15, dive) - wob, 0, U.lerp(1.65, 0.3, dive), k); R(B.elR, U.lerp(0.6, 0.05, dive), 0, 0, k);
      R(B.thL, U.lerp(-0.1, 0, dive) + wob2, 0, U.lerp(-0.32, -0.05, dive), k); R(B.knL, U.lerp(-0.75, -0.1, dive), 0, 0, k);
      R(B.thR, U.lerp(-0.1, 0, dive) - wob2, 0, U.lerp(0.32, 0.05, dive), k); R(B.knR, U.lerp(-0.75, -0.1, dive), 0, 0, k);
      R(B.ftL, 0.6, 0, 0, k); R(B.ftR, 0.6, 0, 0, k);
      R(B.haL, 0, 0, 0, k); R(B.haR, 0, 0, 0, k);
      a.ikW = 0;
      return;
    }
    if (s.state === 'glide') {
      const sw = Math.sin(t * 2.2);
      B.pelvis.position.y += (PELVIS_Y - B.pelvis.position.y) * k;
      R(B.pelvis, -0.12 + (s.vfwd || 0) * -0.012, 0, a.roll * 0.5, k);
      R(B.spine, 0.05, 0, 0, k); R(B.chest, 0.08, 0, 0, k); R(B.neck, -0.05, 0, 0, k); R(B.head, -0.1 - pitch * 0.3, 0, 0, k);
      R(B.shL, 0.12, 0, -2.72, k); R(B.elL, 0.35, 0, 0, k);
      R(B.shR, 0.12, 0, 2.72, k); R(B.elR, 0.35, 0, 0, k);
      R(B.haL, 0, 0, 0, k); R(B.haR, 0, 0, 0, k);
      R(B.thL, 0.3 + sw * 0.12, 0, -0.06, k); R(B.knL, -0.35 - sw * 0.1, 0, 0, k);
      R(B.thR, 0.12 - sw * 0.12, 0, 0.06, k); R(B.knR, -0.25 + sw * 0.1, 0, 0, k);
      R(B.ftL, 0.35, 0, 0, k); R(B.ftR, 0.35, 0, 0, k);
      a.ikW = 0;
      return;
    }

    // ---- on foot ----
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const vf = (s.vx || 0) * fx + (s.vz || 0) * fz, vs = (s.vx || 0) * rx + (s.vz || 0) * rz;
    const sp = Math.hypot(vf, vs);
    const moving = sp > 0.6 && s.onGround !== false;
    let hip = 0, dir = 1;
    if (moving) {
      let ang = Math.atan2(vs, vf);
      if (Math.abs(ang) > 1.95) { dir = -1; ang = U.wrapAngle(ang - Math.PI); }
      hip = -U.clamp(ang, -1.05, 1.05) * 0.75;
    }
    a.hipYaw += (hip - a.hipYaw) * Math.min(1, dt * 9);
    a.moveW += ((moving ? 1 : 0) - a.moveW) * Math.min(1, dt * 9);
    a.walk += dt * sp * 1.45 * dir;
    const sprint = !!(fl & FL.SPRINT) || (sp > 7.2 && !gunHeld);
    const A = U.clamp(sp / 6.4, 0, 1.25) * 0.62 * a.moveW;
    const w = a.walk;
    const air = s.onGround === false && !s.swim;
    const emote = fl & FL.EMOTE;

    if (s.swim) {
      const st = Math.sin(t * 5);
      B.pelvis.position.y += (PELVIS_Y - 0.35 - B.pelvis.position.y) * k;
      R(B.pelvis, -1.0, a.hipYaw, 0, k, 'YXZ'); R(B.spine, 0.1, -a.hipYaw, 0, k, 'YXZ'); R(B.chest, 0.1, 0, 0, k);
      R(B.neck, 0.5, 0, 0, k); R(B.head, 0.35, 0, 0, k);
      R(B.shL, 2.2 + Math.sin(t * 3) * 0.9, 0, -0.5, k); R(B.elL, 0.6, 0, 0, k);
      R(B.shR, 2.2 - Math.sin(t * 3) * 0.9, 0, 0.5, k); R(B.elR, 0.6, 0, 0, k);
      R(B.thL, st * 0.35, 0, -0.05, k); R(B.thR, -st * 0.35, 0, 0.05, k);
      R(B.knL, -0.3, 0, 0, k); R(B.knR, -0.3, 0, 0, k); R(B.ftL, 0.5, 0, 0, k); R(B.ftR, 0.5, 0, 0, k);
      R(B.haL, 0, 0, 0, k); R(B.haR, 0, 0, 0, k);
      a.ikW = 0;
      return;
    }
    if (emote) {
      // a bouncy two-step with arm pumps
      const e = t * 6.5, b = Math.abs(Math.sin(e));
      B.pelvis.position.y += (PELVIS_Y - 0.04 + b * 0.06 - B.pelvis.position.y) * kf;
      R(B.pelvis, 0, Math.sin(e * 0.5) * 0.35, Math.sin(e) * 0.08, kf, 'YXZ');
      R(B.spine, -0.08, -Math.sin(e * 0.5) * 0.5, -Math.sin(e) * 0.12, kf, 'YXZ');
      R(B.chest, 0.05, 0, Math.sin(e) * 0.06, kf); R(B.neck, 0, 0, -Math.sin(e) * 0.1, kf); R(B.head, -0.1 + b * 0.15, 0, 0, kf);
      R(B.shL, 1.2 + Math.sin(e) * 0.8, 0, -0.35, kf); R(B.elL, 1.5, 0, 0, kf);
      R(B.shR, 1.2 - Math.sin(e) * 0.8, 0, 0.35, kf); R(B.elR, 1.5, 0, 0, kf);
      R(B.thL, 0.2 + Math.max(0, Math.sin(e)) * 0.5, 0, -0.08, kf); R(B.knL, -0.2 - Math.max(0, Math.sin(e)) * 0.8, 0, 0, kf);
      R(B.thR, 0.2 + Math.max(0, -Math.sin(e)) * 0.5, 0, 0.08, kf); R(B.knR, -0.2 - Math.max(0, -Math.sin(e)) * 0.8, 0, 0, kf);
      R(B.ftL, 0, 0, 0, kf); R(B.ftR, 0, 0, 0, kf); R(B.haL, 0, 0, 0, kf); R(B.haR, 0, 0, 0, kf);
      a.ikW = 0;
      return;
    }

    // legs
    let thL, thR, knL, knR;
    if (air) { thL = 0.6; knL = -1.0; thR = 0.08; knR = -0.45; }
    else {
      thL = Math.sin(w) * A; thR = -Math.sin(w) * A;
      knL = -(0.06 + Math.max(0, Math.cos(w)) * A * 1.7);
      knR = -(0.06 + Math.max(0, -Math.cos(w)) * A * 1.7);
    }
    const stance = 0.04 * (1 - a.moveW);
    R(B.thL, thL, 0, -0.03 - stance, k); R(B.thR, thR, 0, 0.03 + stance, k);
    R(B.knL, knL, 0, 0, k); R(B.knR, knR, 0, 0, k);
    R(B.ftL, U.clamp(-(thL + knL) * 0.6, -0.4, 0.6), 0, 0, k); R(B.ftR, U.clamp(-(thR + knR) * 0.6, -0.4, 0.6), 0, 0, k);
    const bob = air ? 0 : -Math.abs(Math.sin(w)) * 0.05 * A - 0.02 * A;
    const breath = Math.sin(t * 2.1) * 0.012;
    B.pelvis.position.y += (PELVIS_Y + bob - B.pelvis.position.y) * kf;
    R(B.pelvis, 0, a.hipYaw, Math.sin(w) * 0.05 * A, kf, 'YXZ');

    // upper body
    const lean = sprint ? -0.2 : -0.06 * a.moveW;
    let tw = 0, spineP = pitch * 0.4, chestP = pitch * 0.1, headP = pitch * 0.5;
    const code = s.code || '';
    const swing = s.swing === undefined ? 1 : s.swing;
    if (gunHeld) {
      const H = a.hold, mesh = a.heldMesh, ud = mesh.userData;
      const reload = fl & FL.RELOAD, ads = fl & FL.ADS;
      tw = H.tw;
      if (sprint && !ads) tw = -0.15;
      // gun mount pose (spine space)
      let mx = H.m[0], my = H.m[1], mz = H.m[2], gx = pitch * 0.55, gy = 0, gz = 0;
      const kick = s.fire || 0;
      if (ads) { mx -= 0.07; my += 0.1; mz -= 0.03; }
      if (sprint && !ads) { mx -= 0.1; my -= 0.06; mz += 0.08; gx = -0.55; gy = 0.85; gz = 0.25; }
      if (reload) { my -= 0.06; gx -= 0.35; gz = 0.55; }
      if (s.menu) { mx -= 0.02; my -= 0.1; gx = -0.45; gy = 0.35; gz = 0.15; tw = -0.4; }
      mz += kick * 0.07; gx += kick * 0.14;
      const gm = a.gunMount;
      gm.position.x += (mx - gm.position.x) * kf; gm.position.y += (my - gm.position.y) * kf; gm.position.z += (mz - gm.position.z) * kf;
      R(gm, gx, gy, gz, kf);
      ikTarget = 1;
      a.ikW += (ikTarget - a.ikW) * Math.min(1, dt * 14);
      // FK fallback the IK blends from
      R(B.shR, 1.2, 0, 0.1, k); R(B.elR, 0.6, 0, 0, k);
      R(B.shL, 1.3, 0, -0.2, k); R(B.elL, 0.3, 0, 0, k);
      R(B.spine, spineP + lean, -a.hipYaw, 0, kf, 'YXZ');
      R(B.chest, chestP + breath, tw, 0, kf, 'YXZ');
      R(B.neck, headP * 0.3, -tw * 0.5, 0, kf, 'YXZ');
      R(B.head, headP * 0.7, -tw * 0.5 + (s.lookYaw || 0), 0, kf, 'YXZ');
      // solve hands onto the grips
      a.root.updateMatrixWorld(true);
      GRIP.copy(ud.grip || V3(0, -0.1, 0.05)); mesh.localToWorld(GRIP);
      ik(a, 'R', GRIP, POLE_R, a.ikW);
      if (H.two || !ud.fore) { FORE.copy(ud.grip || V3(0, -0.1, 0.05)).add(V3(-0.035, -0.03, 0.0)); }
      else if (reload) { FORE.set(0, -0.15 + Math.sin(t * 9) * 0.03, -0.08); }
      else FORE.copy(ud.fore);
      mesh.localToWorld(FORE);
      ik(a, 'L', FORE, POLE_L, a.ikW);
      return;
    }
    a.ikW = 0;
    if (code === 'pick') {
      let shx = 0.4, elx = 1.0, twist = 0;
      if (swing < 1) {
        if (swing < 0.32) { const f = swing / 0.32, e = 1 - (1 - f) * (1 - f); shx = 0.4 + e * 2.3; elx = 1.0 + e * 0.6; twist = 0.35 * e; }
        else if (swing < 0.58) { const f = (swing - 0.32) / 0.26, e = f * f; shx = 2.7 - e * 2.65; elx = 1.6 - e * 1.45; twist = 0.35 - e * 0.6; }
        else { const f = (swing - 0.58) / 0.42, e = f * (2 - f); shx = 0.05 + e * 0.35; elx = 0.15 + e * 0.85; twist = -0.25 + e * 0.25; }
      }
      const kk = swing < 1 ? 1 : k;
      R(B.shR, shx + pitch * 0.4, 0, 0.12, kk); R(B.elR, elx, 0, 0, kk); R(B.haR, 0.2, 0, 0, kk);
      R(B.shL, -Math.sin(w) * A * 0.9 + 0.1, 0, -0.12, k); R(B.elL, 0.35 + A * 0.4, 0, 0, k); R(B.haL, 0, 0, 0, k);
      tw = twist;
    } else if (code === 'build' || fl & FL.EDIT) {
      const r = Math.sin(t * 3) * 0.04;
      R(B.shR, 1.0 + pitch * 0.6 + r, 0, 0.2, k); R(B.elR, 0.55, 0, 0, k); R(B.haR, 0.3, 0, 0, k);
      R(B.shL, 1.0 + pitch * 0.6 - r, 0, -0.2, k); R(B.elL, 0.55, 0, 0, k); R(B.haL, 0.3, 0, 0, k);
    } else if (code.startsWith('c:')) {
      const heal = fl & FL.HEAL;
      if (heal) {
        const h = Math.sin(t * 9) * 0.12;
        R(B.shR, 1.05 + h, 0, -0.25, k); R(B.elR, 1.95, 0, 0, k); R(B.haR, 0.2, 0, 0, k);
        R(B.shL, 0.85 - h, 0, 0.25, k); R(B.elL, 1.6, 0, 0, k); R(B.haL, 0, 0, 0, k);
      } else {
        R(B.shR, 0.55, 0, 0.1, k); R(B.elR, 1.35, 0, 0, k); R(B.haR, 0.15, 0, 0, k);
        R(B.shL, -Math.sin(w) * A * 0.9, 0, -0.12, k); R(B.elL, 0.35 + A * 0.4, 0, 0, k); R(B.haL, 0, 0, 0, k);
      }
    } else {
      R(B.shR, Math.sin(w) * A * 0.9 + (air ? 0.5 : 0), 0, 0.12 + (air ? 0.4 : 0), k); R(B.elR, 0.3 + A * 0.5, 0, 0, k); R(B.haR, 0, 0, 0, k);
      R(B.shL, -Math.sin(w) * A * 0.9 + (air ? 0.5 : 0), 0, -0.12 - (air ? 0.4 : 0), k); R(B.elL, 0.3 + A * 0.5, 0, 0, k); R(B.haL, 0, 0, 0, k);
    }
    R(B.spine, spineP * 0.6 + lean, -a.hipYaw * 0.7, 0, kf, 'YXZ');
    R(B.chest, chestP + breath, tw - Math.sin(w) * 0.12 * A, 0, kf, 'YXZ');
    R(B.neck, headP * 0.3, -tw * 0.5, 0, kf, 'YXZ');
    R(B.head, headP * 0.7 + spineP * 0.4, -tw * 0.5, 0, kf, 'YXZ');
  }

  function muzzle(a, out) {
    if (!a.heldMesh || !a.hold || !a.root.visible) return null;
    a.root.updateMatrixWorld(true);
    out = out || V3();
    out.set(0, 0.012, a.heldMesh.userData.muzzle || -0.6);
    return a.heldMesh.localToWorld(out);
  }
  // world position and direction of the ejection port (for shell casings)
  function ejectPort(a) {
    if (!a.heldMesh || !a.hold || !a.root.visible) return null;
    const m = a.heldMesh;
    const p = V3(0.045, 0.03, (m.userData.eject !== undefined ? m.userData.eject : -0.05));
    m.localToWorld(p);
    const r = V3(1, 0.6, 0.25).transformDirection(m.matrixWorld);
    return { p, r };
  }

  // head-and-shoulders portraits for the locker, drawn once with a small throwaway renderer
  const portraits = new Map();
  function portraitAll() {
    const need = SKINS.map((_, i) => i).filter(i => !portraits.has(i));
    if (need.length) {
      let r;
      try {
        r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      } catch (e) { return SKINS.map(() => ''); }
      r.setSize(176, 176, false);
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a4a3a, 1.5));
      const key = new THREE.DirectionalLight(0xfff2e0, 2.4); key.position.set(-1.2, 2.4, -2); scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fc8ff, 1.6); rim.position.set(1.5, 2, 2); scene.add(rim);
      const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
      cam.position.set(0.42, 1.78, -1.32); cam.lookAt(0, 1.6, 0);
      const s = { state: 'ground', code: '', flags: 0, pitch: 0, yaw: 0, vx: 0, vz: 0, onGround: true, swim: false, swing: 1, fire: 0, time: 0, dive: 0, menu: true };
      for (const i of need) {
        const a = create(i);
        for (let k = 0; k < 40; k++) { s.time = k / 60; animate(a, s, 1 / 60); }
        a.root.updateMatrixWorld(true);
        scene.add(a.root);
        r.render(scene, cam);
        portraits.set(i, r.domElement.toDataURL('image/png'));
        scene.remove(a.root);
        a.mesh.geometry.dispose();
      }
      r.dispose(); r.forceContextLoss();
    }
    return SKINS.map((_, i) => portraits.get(i));
  }

  return { create, animate, setHeld, muzzle, ejectPort, HOLD, portraitAll };
})();
