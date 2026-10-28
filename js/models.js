'use strict';
// Geometry builders: props, characters, weapons, items, chests, the battle blimp.

const Models = (() => {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const M4 = () => new THREE.Matrix4();
  const matCache = new Map();

  function mat(color, o = {}) {
    const key = color + JSON.stringify(o);
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough !== undefined ? o.rough : 0.6, metalness: o.metal || 0, emissive: o.emissive || 0x000000, emissiveIntensity: o.ei || 1, flatShading: !!o.flat });
    matCache.set(key, m);
    return m;
  }

  // Merge geometries into one non-indexed geometry with per-vertex color.
  function merge(parts) {
    const pos = [], nor = [], col = [], uv = [];
    const c = new THREE.Color();
    for (const p of parts) {
      let g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
      if (p.m) g.applyMatrix4(p.m);
      if (!g.attributes.normal) g.computeVertexNormals();
      c.set(p.c !== undefined ? p.c : 0xffffff);
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      const UV = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i = 0; i < P.length / 3; i++) {
        pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        const j = p.jitter ? 1 + (Math.sin(i * 12.9898 + P[i * 3] * 78.233) * 0.5) * p.jitter : 1;
        col.push(c.r * j, c.g * j, c.b * j);
        if (UV) uv.push(UV[i * 2], UV[i * 2 + 1]); else uv.push(0, 0);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  // Collapse a group's direct mesh children into one vertex-colored mesh (far fewer draw calls).
  const bakedMats = new Map();
  function bakeMat(emissive) {
    const k = emissive || 0;
    if (!bakedMats.has(k)) bakedMats.set(k, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.08, emissive: emissive || 0, emissiveIntensity: emissive ? 0.35 : 0 }));
    return bakedMats.get(k);
  }
  function bake(group, splitEmissive) {
    const plain = [], glow = [];
    let glowCol = 0;
    for (const ch of [...group.children]) {
      if (!ch.isMesh) continue;
      ch.updateMatrix();
      const e = ch.material.emissive && ch.material.emissive.getHex();
      const part = { g: ch.geometry, c: ch.material.color.getHex(), m: ch.matrix.clone() };
      if (splitEmissive && e) { glow.push(part); glowCol = ch.material.color.getHex(); } else plain.push(part);
      group.remove(ch);
    }
    const out = [];
    if (plain.length) out.push(new THREE.Mesh(merge(plain), bakeMat(0)));
    if (glow.length) out.push(new THREE.Mesh(merge(glow), bakeMat(glowCol)));
    for (const m of out) { m.castShadow = true; group.add(m); }
    return group;
  }
  const T = (x, y, z) => M4().makeTranslation(x, y, z);
  const TRS = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => M4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));

  function jitterGeo(g, amt, seed) {
    g = g.index ? g.toNonIndexed() : g;
    const R = U.rng(seed);
    const P = g.attributes.position;
    const map = new Map();
    for (let i = 0; i < P.count; i++) {
      const k = P.getX(i).toFixed(3) + ',' + P.getY(i).toFixed(3) + ',' + P.getZ(i).toFixed(3);
      if (!map.has(k)) map.set(k, [(R() - 0.5) * amt, (R() - 0.5) * amt, (R() - 0.5) * amt]);
      const o = map.get(k);
      P.setXYZ(i, P.getX(i) + o[0], P.getY(i) + o[1], P.getZ(i) + o[2]);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- props ----------
  function propGeos() {
    const pine = merge([
      { g: new THREE.CylinderGeometry(0.22, 0.38, 3.6, 7), c: 0x6b4426, m: T(0, 1.8, 0) },
      { g: new THREE.ConeGeometry(2.4, 3.6, 8), c: 0x2f6b34, m: T(0, 3.9, 0), jitter: 0.12 },
      { g: new THREE.ConeGeometry(1.9, 3.1, 8), c: 0x3a7d3c, m: TRS(0, 5.6, 0, 0, 0.4, 0), jitter: 0.12 },
      { g: new THREE.ConeGeometry(1.25, 2.6, 8), c: 0x478f45, m: TRS(0, 7.2, 0, 0, 0.8, 0), jitter: 0.12 },
    ]);
    const oak = merge([
      { g: new THREE.CylinderGeometry(0.3, 0.45, 3.4, 7), c: 0x6e4a2c, m: T(0, 1.7, 0) },
      { g: new THREE.CylinderGeometry(0.12, 0.18, 1.8, 5), c: 0x6e4a2c, m: TRS(0.7, 3.4, 0, 0, 0, -0.8) },
      { g: jitterGeo(new THREE.IcosahedronGeometry(2.5, 1), 0.5, 3), c: 0x4c9a3a, m: T(0, 4.9, 0), jitter: 0.15 },
      { g: jitterGeo(new THREE.IcosahedronGeometry(1.7, 1), 0.4, 4), c: 0x5aa844, m: T(1.4, 4.1, 0.6), jitter: 0.15 },
      { g: jitterGeo(new THREE.IcosahedronGeometry(1.6, 1), 0.4, 5), c: 0x438c34, m: T(-1.2, 4.4, -0.7), jitter: 0.15 },
    ]);
    const rock = merge([
      { g: jitterGeo(new THREE.IcosahedronGeometry(1.35, 1), 0.55, 9), c: 0x8d8f93, m: TRS(0, 0.45, 0, 0, 0, 0, 1, 0.72, 1), jitter: 0.12 },
      { g: jitterGeo(new THREE.IcosahedronGeometry(0.7, 0), 0.3, 10), c: 0x7b7d82, m: T(0.9, 0.2, 0.5), jitter: 0.1 },
    ]);
    const bush = merge([
      { g: jitterGeo(new THREE.IcosahedronGeometry(0.85, 1), 0.3, 21), c: 0x3f8a33, m: T(0, 0.55, 0), jitter: 0.15 },
      { g: jitterGeo(new THREE.IcosahedronGeometry(0.6, 1), 0.25, 22), c: 0x4d9c3b, m: T(0.6, 0.4, 0.2), jitter: 0.15 },
      { g: jitterGeo(new THREE.IcosahedronGeometry(0.55, 1), 0.25, 23), c: 0x387d2e, m: T(-0.5, 0.4, -0.3), jitter: 0.15 },
    ]);
    const crate = merge([
      { g: new THREE.BoxGeometry(1.5, 1.5, 1.5), c: 0xb07a45, m: T(0, 0.75, 0) },
      ...[-0.7, 0.7].flatMap(x => [-0.7, 0.7].map(z => ({ g: new THREE.BoxGeometry(0.16, 1.54, 0.16), c: 0x6b4423, m: T(x, 0.75, z) }))),
      ...[0.04, 1.46].flatMap(y => [{ g: new THREE.BoxGeometry(1.54, 0.16, 0.16), c: 0x6b4423, m: T(0, y, 0.7) }, { g: new THREE.BoxGeometry(1.54, 0.16, 0.16), c: 0x6b4423, m: T(0, y, -0.7) }, { g: new THREE.BoxGeometry(0.16, 0.16, 1.54), c: 0x6b4423, m: T(0.7, y, 0) }, { g: new THREE.BoxGeometry(0.16, 0.16, 1.54), c: 0x6b4423, m: T(-0.7, y, 0) }]),
      { g: new THREE.BoxGeometry(0.12, 1.9, 0.12), c: 0x6b4423, m: TRS(0, 0.75, 0.76, 0, 0, 0.78) },
      { g: new THREE.BoxGeometry(0.12, 1.9, 0.12), c: 0x6b4423, m: TRS(0, 0.75, -0.76, 0, 0, 0.78) },
    ]);
    const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12);
    const car = merge([
      { g: new THREE.BoxGeometry(2.0, 0.72, 4.3), c: 0xffffff, m: T(0, 0.62, 0) },
      { g: new THREE.BoxGeometry(1.8, 0.62, 2.2), c: 0xffffff, m: T(0, 1.28, 0.2) },
      { g: new THREE.BoxGeometry(1.82, 0.46, 2.0), c: 0x1d2a38, m: T(0, 1.3, 0.2) },
      { g: new THREE.BoxGeometry(1.7, 0.42, 0.06), c: 0x24384c, m: TRS(0, 1.27, -0.92, -0.35, 0, 0) },
      ...[[-0.95, -1.35], [0.95, -1.35], [-0.95, 1.35], [0.95, 1.35]].map(([x, z]) => ({ g: wheel, c: 0x1a1a1a, m: TRS(x, 0.38, z, 0, 0, Math.PI / 2) })),
      { g: new THREE.BoxGeometry(0.35, 0.16, 0.05), c: 0xfff2b0, m: T(-0.65, 0.72, -2.16) },
      { g: new THREE.BoxGeometry(0.35, 0.16, 0.05), c: 0xfff2b0, m: T(0.65, 0.72, -2.16) },
      { g: new THREE.BoxGeometry(0.35, 0.14, 0.05), c: 0xd02020, m: T(-0.7, 0.75, 2.16) },
      { g: new THREE.BoxGeometry(0.35, 0.14, 0.05), c: 0xd02020, m: T(0.7, 0.75, 2.16) },
      { g: new THREE.BoxGeometry(2.04, 0.12, 4.34), c: 0x333333, m: T(0, 0.3, 0) },
    ]);
    const cparts = [{ g: new THREE.BoxGeometry(2.6, 2.8, 6.4), c: 0xffffff, m: T(0, 1.4, 0) }];
    for (let z = -2.9; z <= 2.9; z += 0.5) {
      cparts.push({ g: new THREE.BoxGeometry(2.66, 2.7, 0.12), c: 0xdddddd, m: T(0, 1.4, z) });
    }
    cparts.push({ g: new THREE.BoxGeometry(2.7, 0.14, 6.5), c: 0x888888, m: T(0, 2.82, 0) });
    cparts.push({ g: new THREE.BoxGeometry(2.7, 0.14, 6.5), c: 0x888888, m: T(0, 0.05, 0) });
    const container = merge(cparts);
    // fake ambient occlusion: darken towards the ground and the inside of canopies
    const ao = (g, y0, y1, lo) => {
      const P = g.attributes.position, C = g.attributes.color;
      for (let i = 0; i < P.count; i++) { const f = lo + (1 - lo) * U.smooth(y0, y1, P.getY(i)); C.setXYZ(i, C.getX(i) * f, C.getY(i) * f, C.getZ(i) * f); }
    };
    ao(pine, 0, 8.5, 0.5); ao(oak, 0.5, 7, 0.55); ao(bush, 0, 1.3, 0.55); ao(rock, 0, 1.1, 0.68); ao(crate, 0, 1.5, 0.75); ao(car, 0, 1.6, 0.7);
    return { pine, oak, rock, bush, crate, car, container };
  }

  // ---------- weapons ----------
  // Guns point down -Z with the bore near y = 0. userData: muzzle (z), grip / fore (hand points),
  // hold (pose family used by Character) and eject (ejection port z).
  const gunMats = new Map();
  function gunMat(emissive) {
    const k = emissive || 0;
    if (!gunMats.has(k)) {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: emissive ? 0.1 : 0.45, emissive: emissive ? 0xffffff : 0, emissiveIntensity: emissive ? 1.1 : 0 });
      // glowing parts take their emissive colour from the vertex colour
      if (emissive) m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;'); };
      gunMats.set(k, m);
    }
    return gunMats.get(k);
  }
  function gun(w, r) {
    const g = new THREE.Group();
    const st = WEAPONS[w];
    const rc = RARITY[r] ? RARITY[r].glow : 0xffffff;
    const myth = !!st.mythic;
    const body = mat(myth ? 0x2e2716 : 0x2a2e34, { rough: 0.45, metal: 0.5 });
    const body2 = mat(myth ? 0x4a3d1c : 0x474e57, { rough: 0.45, metal: 0.55 });
    const steel = mat(0x8d969f, { rough: 0.3, metal: 0.85 });
    const dark = mat(0x16181b, { rough: 0.6 });
    const wood = mat(0x7a4b28, { rough: 0.7 });
    const woodD = mat(0x5c3519, { rough: 0.7 });
    const accent = mat(rc, { rough: 0.35, metal: 0.2, emissive: rc, ei: 0.5 });
    const glow = mat(rc, { emissive: rc, ei: 1 });
    const gold = mat(0xffcf40, { rough: 0.3, metal: 0.85, emissive: 0x553300, ei: 0.6 });
    const lens = mat(0x6fd0ff, { rough: 0.05, metal: 0.3, emissive: 0x2a7fb0, ei: 1 });
    const trim = myth ? gold : accent;
    const B = (m, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
    const C = (m, rt, rb, len, x, y, z, seg = 12) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m); me.rotation.x = Math.PI / 2; me.position.set(x, y, z); g.add(me); return me; };
    const D = (m, rr, len, x, y, z, seg = 16) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, len, seg), m); me.rotation.z = Math.PI / 2; me.position.set(x, y, z); g.add(me); return me; };
    const ud = g.userData;
    ud.hold = 'rifle'; ud.eject = -0.06;
    const rail = (z0, z1, y) => { B(body2, 0.044, 0.018, z1 - z0, 0, y, (z0 + z1) / 2); for (let z = z0 + 0.02; z < z1; z += 0.035) B(body, 0.05, 0.012, 0.016, 0, y + 0.012, z); };
    const scope = (y, z, len, rad) => {
      C(body, rad, rad, len, 0, y, z, 14);
      C(body2, rad * 1.3, rad, len * 0.22, 0, y, z - len * 0.5, 14);
      C(body2, rad, rad * 1.2, len * 0.18, 0, y, z + len * 0.48, 14);
      C(lens, rad * 1.15, rad * 1.15, 0.006, 0, y, z - len * 0.61, 14);
      D(body2, rad * 0.45, 0.04, rad + 0.012, y, z, 8);
      for (const dz of [-0.07, 0.07]) B(body, 0.03, y - 0.06, 0.025, 0, 0.06 + (y - 0.06) / 2, z + dz);
    };
    if (w === 'ar' || w === 'burst' || w === 'heavyar' || w === 'scoped' || w === 'tempest') {
      const T = w === 'heavyar' ? 1.18 : 1;
      B(body, 0.072 * T, 0.095 * T, 0.4, 0, 0, -0.08);                       // receiver
      B(body2, 0.06 * T, 0.03, 0.3, 0, 0.055 * T, -0.1);                    // upper
      rail(-0.26, 0.02, 0.08 * T);
      B(dark, 0.074 * T, 0.03, 0.06, 0.002, 0.02, -0.04);                   // ejection port
      B(w === 'burst' ? body2 : body, 0.07 * T, 0.072 * T, 0.27, 0, 0.0, -0.41); // handguard
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) B(dark, 0.004, 0.02, 0.04, sx * 0.036 * T, 0.006, -0.32 - i * 0.06);
      C(steel, 0.016, 0.016, 0.2, 0, 0.004, -0.63);                         // barrel
      C(body, 0.026, 0.024, 0.075, 0, 0.004, -0.75, 8);                     // muzzle brake
      B(dark, 0.054, 0.008, 0.02, 0, 0.004, -0.75);
      B(body, 0.012, 0.06, 0.016, 0, 0.05, -0.52);                          // front sight
      B(body, 0.048, 0.16, 0.08, 0, -0.12, -0.14, 0.22);                    // magazine
      B(body, 0.048, 0.07, 0.076, 0, -0.215, -0.115, 0.42);
      B(trim, 0.05, 0.016, 0.082, 0, -0.07, -0.152, 0.22);
      B(body, 0.046, 0.13, 0.058, 0, -0.1, 0.06, -0.34);                    // pistol grip
      B(dark, 0.012, 0.012, 0.075, 0, -0.065, -0.005);                      // trigger guard
      B(body2, 0.056, 0.085, 0.2, 0, -0.012, 0.25);                         // stock
      B(dark, 0.06, 0.12, 0.03, 0, -0.022, 0.36);
      B(trim, 0.076 * T, 0.018, 0.22, 0, 0.03, -0.12);                      // rarity stripes
      B(trim, 0.06, 0.018, 0.12, 0, 0.012, 0.25);
      if (w === 'scoped') scope(0.135, -0.1, 0.3, 0.032);
      else B(body, 0.032, 0.035, 0.04, 0, 0.11 * T, -0.02);                 // rear sight
      if (w === 'heavyar') { B(body, 0.08, 0.04, 0.2, 0, -0.06, -0.41); C(body2, 0.03, 0.03, 0.08, 0, 0.004, -0.79, 10); }
      if (myth) { B(gold, 0.08, 0.026, 0.1, 0, -0.035, -0.5); B(glow, 0.078, 0.008, 0.28, 0, 0.044, -0.4); B(glow, 0.058, 0.008, 0.14, 0, 0.055, 0.25); }
      ud.muzzle = w === 'heavyar' ? -0.83 : -0.79;
      ud.grip = V3(0, -0.11, 0.07); ud.fore = V3(0, -0.055, -0.3);
    } else if (w === 'pump' || w === 'tac' || w === 'drum' || w === 'dragon') {
      B(body, 0.074, 0.1, 0.32, 0, 0, -0.04);
      B(dark, 0.076, 0.03, 0.08, 0.001, 0.015, -0.06);
      C(body2, 0.026, 0.026, 0.55, 0, 0.032, -0.46);
      if (w !== 'drum') C(body, 0.02, 0.02, 0.44, 0, -0.024, -0.42);
      const woodFore = w === 'pump' || w === 'dragon';
      B(woodFore ? wood : body2, 0.072, 0.066, 0.19, 0, -0.024, -0.38);
      for (let i = 0; i < 5; i++) B(woodFore ? woodD : dark, 0.075, 0.07, 0.012, 0, -0.024, -0.31 - i * 0.035);
      if (w === 'tac' || w === 'drum') { B(body, 0.046, 0.12, 0.058, 0, -0.1, 0.07, -0.3); B(body2, 0.05, 0.08, 0.2, 0, -0.02, 0.24); B(dark, 0.055, 0.1, 0.025, 0, -0.025, 0.345); }
      else { B(wood, 0.062, 0.1, 0.28, 0, -0.045, 0.24, 0.14); B(woodD, 0.064, 0.12, 0.03, 0, -0.07, 0.37, 0.14); }
      if (w === 'drum') { D(body2, 0.085, 0.1, 0, -0.12, -0.1, 18); D(trim, 0.087, 0.02, 0, -0.12, -0.1, 18); }
      B(dark, 0.012, 0.012, 0.07, 0, -0.065, 0.01);
      C(body, 0.034, 0.03, 0.06, 0, 0.032, -0.73, 10);
      B(steel, 0.012, 0.016, 0.012, 0, 0.065, -0.7);
      B(trim, 0.078, 0.022, 0.24, 0, 0.055, -0.06);
      if (w === 'dragon') { C(gold, 0.05, 0.036, 0.08, 0, 0.032, -0.77, 10); B(glow, 0.076, 0.008, 0.3, 0, -0.06, -0.06); B(gold, 0.066, 0.024, 0.2, 0, -0.06, -0.38); }
      ud.muzzle = w === 'dragon' ? -0.81 : -0.77;
      ud.grip = w === 'tac' || w === 'drum' ? V3(0, -0.11, 0.075) : V3(0, -0.08, 0.1);
      ud.fore = V3(0, -0.06, -0.31); ud.eject = -0.06;
    } else if (w === 'minigun') {
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; C(steel, 0.02, 0.02, 0.66, Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.44, 8); }
      for (const z of [-0.3, -0.62]) C(body2, 0.085, 0.085, 0.04, 0, 0, z, 14);
      C(dark, 0.03, 0.03, 0.7, 0, 0, -0.44, 8);
      C(trim, 0.09, 0.09, 0.03, 0, 0, -0.76, 14);
      B(body, 0.17, 0.18, 0.34, 0, -0.01, 0.06);
      B(trim, 0.172, 0.04, 0.2, 0, 0.06, 0.06);
      B(body2, 0.12, 0.08, 0.12, 0, -0.13, 0.1);
      B(dark, 0.035, 0.12, 0.035, 0, 0.13, -0.06); B(body2, 0.04, 0.035, 0.2, 0, 0.19, 0.0); B(dark, 0.035, 0.12, 0.035, 0, 0.13, 0.08);
      B(body2, 0.04, 0.12, 0.05, 0, -0.06, 0.27, -0.2);
      ud.muzzle = -0.8; ud.grip = V3(0, -0.07, 0.27); ud.fore = V3(0, 0.2, -0.04); ud.hold = 'minigun'; ud.eject = 0.0;
    } else if (w === 'smg' || w === 'stinger') {
      B(body, 0.07, 0.1, 0.3, 0, 0, -0.06);
      B(body2, 0.058, 0.03, 0.26, 0, 0.055, -0.07);
      B(dark, 0.072, 0.028, 0.05, 0.001, 0.02, -0.03);
      C(body2, 0.03, 0.03, 0.12, 0, 0.012, -0.27);
      C(steel, 0.016, 0.016, 0.06, 0, 0.012, -0.35);
      C(body, 0.022, 0.022, 0.05, 0, 0.012, -0.39, 8);
      B(body, 0.04, 0.18, 0.058, 0, -0.14, -0.12, w === 'stinger' ? 0.2 : 0.04);
      B(trim, 0.042, 0.016, 0.06, 0, -0.08, -0.12, w === 'stinger' ? 0.2 : 0.04);
      B(body, 0.044, 0.12, 0.054, 0, -0.1, 0.06, -0.28);
      B(dark, 0.012, 0.012, 0.06, 0, -0.065, 0.005);
      B(body2, 0.034, 0.09, 0.04, 0, -0.09, -0.21);
      B(body2, 0.028, 0.045, 0.18, 0, -0.005, 0.18);
      B(dark, 0.05, 0.08, 0.02, 0, -0.012, 0.27);
      B(body, 0.04, 0.045, 0.07, 0, 0.095, -0.06); B(lens, 0.03, 0.03, 0.004, 0, 0.098, -0.097);
      B(trim, 0.072, 0.02, 0.16, 0, 0.026, -0.12);
      if (w === 'stinger') { B(glow, 0.06, 0.008, 0.2, 0, 0.073, -0.07); C(trim, 0.034, 0.034, 0.02, 0, 0.012, -0.22, 10); }
      ud.muzzle = -0.42; ud.grip = V3(0, -0.11, 0.065); ud.fore = V3(0, -0.12, -0.21); ud.hold = 'smg'; ud.eject = -0.03;
    } else if (w === 'pistol' || w === 'hcannon') {
      const s = w === 'hcannon' ? 1.3 : 1;
      B(body2, 0.044 * s, 0.05 * s, 0.22 * s, 0, 0.022 * s, -0.06 * s);
      for (let i = 0; i < 5; i++) B(dark, 0.046 * s, 0.035 * s, 0.006, 0, 0.022 * s, 0.01 * s + i * 0.009);
      B(body, 0.04 * s, 0.035 * s, 0.17 * s, 0, -0.018 * s, -0.06 * s);
      B(body, 0.042 * s, 0.13 * s, 0.062 * s, 0, -0.085 * s, 0.03 * s, -0.22);
      B(trim, 0.044 * s, 0.03 * s, 0.05 * s, 0, -0.09 * s, 0.035 * s, -0.22);
      B(dark, 0.01, 0.01, 0.05 * s, 0, -0.045 * s, -0.04 * s);
      C(steel, 0.012 * s, 0.012 * s, 0.03, 0, 0.022 * s, -0.175 * s, 8);
      B(steel, 0.008, 0.014 * s, 0.01, 0, 0.054 * s, -0.16 * s);
      B(trim, 0.046 * s, 0.012, 0.15 * s, 0, 0.04 * s, -0.08 * s);
      ud.muzzle = -0.19 * s; ud.grip = V3(0, -0.095 * s, 0.035 * s); ud.fore = null; ud.hold = 'pistol'; ud.eject = -0.04 * s;
    } else if (w === 'hunting' || w === 'bolt' || w === 'heavysniper' || w === 'skybreaker') {
      const L = w === 'heavysniper' ? 1.15 : 1;
      if (w === 'hunting') {
        B(wood, 0.07, 0.085, 0.62, 0, -0.02, -0.14);
        B(wood, 0.064, 0.11, 0.26, 0, -0.06, 0.3, 0.12); B(woodD, 0.066, 0.13, 0.03, 0, -0.08, 0.43, 0.12);
        B(body2, 0.05, 0.05, 0.3, 0, 0.04, -0.02);
      } else {
        B(body, 0.068, 0.09, 0.44 * L, 0, 0, -0.08);
        B(body2, 0.06, 0.1, 0.24, 0, -0.03, 0.3);
        B(dark, 0.064, 0.13, 0.03, 0, -0.04, 0.425);
        B(dark, 0.04, 0.06, 0.12, 0, -0.03, 0.27);
        B(body, 0.05, 0.09, 0.07, 0, -0.1, -0.08);
        B(body, 0.044, 0.12, 0.058, 0, -0.1, 0.11, -0.32);
      }
      C(steel, 0.018 * L, 0.02 * L, 0.6 * L, 0, 0.03, -0.62 * L);
      B(body, 0.054 * L, 0.044 * L, 0.09, 0, 0.03, -0.95 * L);
      for (const sx of [-1, 1]) B(dark, 0.004, 0.026, 0.05, sx * 0.028 * L, 0.03, -0.95 * L);
      scope(0.13, -0.08, 0.36 * L, 0.036 * L);
      D(steel, 0.009, 0.06, 0.06, 0.035, 0.07);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), steel); knob.position.set(0.09, 0.035, 0.07); g.add(knob);
      B(trim, 0.072, 0.02, 0.3, 0, 0.0, -0.14);
      if (w === 'heavysniper') { for (const sx of [-1, 1]) B(body2, 0.014, 0.014, 0.28, sx * 0.03, -0.07, -0.42, 0.25); }
      if (myth) { B(gold, 0.074, 0.03, 0.2, 0, -0.035, -0.4); B(glow, 0.07, 0.008, 0.42, 0, 0.048, -0.14); C(gold, 0.05, 0.045, 0.1, 0, 0.03, -0.96, 10); }
      ud.muzzle = -1.0 * L; ud.grip = w === 'hunting' ? V3(0, -0.09, 0.16) : V3(0, -0.11, 0.12); ud.fore = V3(0, -0.06, -0.32); ud.eject = 0.06;
    } else if (w === 'rocket') {
      C(body2, 0.095, 0.095, 1.0, 0, 0, -0.12, 16);
      C(trim, 0.108, 0.1, 0.1, 0, 0, -0.62, 16);
      C(dark, 0.08, 0.08, 0.02, 0, 0, -0.675, 16);
      C(trim, 0.11, 0.1, 0.08, 0, 0, 0.38, 16);
      for (const z of [-0.3, 0.1]) C(body, 0.1, 0.1, 0.04, 0, 0, z, 16);
      B(body, 0.05, 0.14, 0.06, 0, -0.15, 0.04, -0.2); B(body, 0.05, 0.14, 0.06, 0, -0.15, -0.28, -0.1);
      B(body, 0.05, 0.1, 0.14, -0.11, 0.05, -0.18); B(lens, 0.004, 0.05, 0.05, -0.138, 0.06, -0.25);
      ud.muzzle = -0.66; ud.grip = V3(0, -0.2, 0.04); ud.fore = V3(0, -0.19, -0.28); ud.hold = 'launcher'; ud.eject = 99;
    } else if (w === 'gl') {
      C(body, 0.06, 0.06, 0.4, 0, 0.03, -0.3, 14);
      C(dark, 0.045, 0.045, 0.01, 0, 0.03, -0.505, 12);
      D(body2, 0.11, 0.16, 0, -0.02, -0.02, 6);
      D(trim, 0.112, 0.03, 0, -0.02, -0.02, 6);
      B(body, 0.05, 0.14, 0.06, 0, -0.13, 0.1, -0.25);
      B(body2, 0.06, 0.1, 0.22, 0, -0.02, 0.24);
      B(body2, 0.04, 0.1, 0.05, 0, -0.08, -0.3);
      B(trim, 0.1, 0.02, 0.12, 0, 0.1, -0.02);
      ud.muzzle = -0.52; ud.grip = V3(0, -0.12, 0.11); ud.fore = V3(0, -0.12, -0.3); ud.eject = 99;
    }
    if (ud.muzzle === undefined) ud.muzzle = -0.6;
    // bake into one opaque mesh plus one glowing accent mesh
    const plain = [], lit = [];
    for (const ch of [...g.children]) {
      ch.updateMatrix();
      const e = ch.material.emissive && ch.material.emissive.getHex();
      const part = { g: ch.geometry, c: ch.material.color.getHex(), m: ch.matrix.clone() };
      if (e && ch.material.emissiveIntensity >= 0.5 && e !== 0x553300) lit.push(part); else plain.push(part);
      g.remove(ch);
    }
    if (plain.length) g.add(new THREE.Mesh(merge(plain), gunMat(0)));
    if (lit.length) g.add(new THREE.Mesh(merge(lit), gunMat(1)));
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function pickaxe() {
    // handle along +Y, gripped near y = 0; head at the top
    const g = new THREE.Group();
    const steel = mat(0xb9c4cf, { metal: 0.85, rough: 0.28 }), steelD = mat(0x6d7884, { metal: 0.8, rough: 0.35 });
    const wood = mat(0x7a4a26, { rough: 0.7 }), wrapM = mat(0x2f6fd6, { rough: 0.6 }), capM = mat(0xffc53d, { metal: 0.6, rough: 0.35 });
    const M = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
    M(new THREE.CylinderGeometry(0.022, 0.027, 0.92, 8), wood, 0, 0.32, 0);
    for (let i = 0; i < 4; i++) M(new THREE.TorusGeometry(0.028, 0.008, 5, 10), wrapM, 0, -0.06 + i * 0.045, 0, Math.PI / 2, 0, 0.3);
    M(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), wrapM, 0, 0.01, 0);
    M(new THREE.SphereGeometry(0.035, 10, 8), capM, 0, -0.12, 0);
    M(new THREE.BoxGeometry(0.11, 0.1, 0.07), steelD, 0, 0.74, 0);
    M(new THREE.TorusGeometry(0.036, 0.01, 5, 12), capM, 0, 0.68, 0, Math.PI / 2, 0, 0);
    // curved pick blades, thick at the eye and tapering to points
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        M(new THREE.BoxGeometry(0.07, 0.07 - f * 0.045, 0.055 - f * 0.025), steel, sx * (0.09 + f * 0.24), 0.74 - f * f * 0.11, 0, 0, 0, -sx * (f * 0.55));
      }
      M(new THREE.ConeGeometry(0.018, 0.08, 4), steel, sx * 0.36, 0.62, 0, 0, 0, sx * (Math.PI / 2 + 0.6));
    }
    bake(g);
    return g;
  }

  function item(c) {
    const g = new THREE.Group();
    const M = (geo, col, x = 0, y = 0, z = 0, o = {}) => { const me = new THREE.Mesh(geo, mat(col, o)); me.position.set(x, y, z); me.castShadow = true; g.add(me); return me; };
    switch (c) {
      case 'bandage': M(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 14), 0xf4f1ea); M(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 14), 0xd8b48a); break;
      case 'medkit': M(new THREE.BoxGeometry(0.42, 0.28, 0.16), 0xf2f2f2); M(new THREE.BoxGeometry(0.2, 0.06, 0.17), 0xe23b3b); M(new THREE.BoxGeometry(0.06, 0.2, 0.17), 0xe23b3b); M(new THREE.BoxGeometry(0.16, 0.04, 0.04), 0x666666, 0, 0.16, 0); break;
      case 'mini': M(new THREE.SphereGeometry(0.11, 14, 10), 0x3fb8ff, 0, 0, 0, { rough: 0.1, emissive: 0x1166aa, ei: 0.6 }); M(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), 0xdddddd, 0, 0.13, 0); break;
      case 'big': M(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 14), 0x2f8dff, 0, 0, 0, { rough: 0.1, emissive: 0x0a4fb0, ei: 0.7 }); M(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), 0xdddddd, 0, 0.2, 0); break;
      case 'fizz': M(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 14), 0x6bdc3c, 0, 0, 0, { emissive: 0x2a6a10, ei: 0.5 }); M(new THREE.CylinderGeometry(0.102, 0.102, 0.08, 14), 0x3a7df0, 0, 0.02, 0); break;
      case 'splash': M(new THREE.CylinderGeometry(0.17, 0.2, 0.36, 16), 0xf0f6ff, 0, 0, 0, { rough: 0.2 }); M(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16), 0x2f8dff, 0, 0.02, 0, { emissive: 0x1a5ab0, ei: 0.6 }); M(new THREE.TorusGeometry(0.09, 0.025, 6, 12), 0xf0f6ff, 0.2, 0.06, 0); break;
      case 'nade': M(new THREE.SphereGeometry(0.11, 12, 10), 0x4d6b2f); M(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8), 0x888888, 0, 0.12, 0); M(new THREE.TorusGeometry(0.03, 0.008, 5, 10), 0xcccccc, 0.05, 0.14, 0); break;
      case 'bounce': M(new THREE.CylinderGeometry(0.3, 0.32, 0.06, 18), 0x2c2f36); M(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 18), 0x48e0ff, 0, 0.04, 0, { emissive: 0x1890c0, ei: 0.8 }); break;
    }
    return g;
  }
  // ammo pickups are drawn as the rounds themselves: brass cases, copper tips, red shotgun hulls, a mini rocket
  function ammoBox(a) {
    const g = new THREE.Group();
    const col = new THREE.Color(AMMO[a].color).getHex();
    const brass = mat(0xd9a640, { metal: 0.85, rough: 0.28 }), brassD = mat(0xa87a2a, { metal: 0.85, rough: 0.32 });
    const copper = mat(0xc8703a, { metal: 0.8, rough: 0.3 }), hull = mat(0xc8302c, { rough: 0.45 });
    const band = mat(col, { emissive: col, ei: 0.55, rough: 0.4 });
    const tray = mat(0x2c3238, { rough: 0.55, metal: 0.3 });
    const M = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); g.add(me); return me; };
    const round = (x, z, r, len, tipLen) => {
      const y0 = 0.02;
      M(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.008, 12), brassD, x, y0 + 0.004, z);
      M(new THREE.CylinderGeometry(r, r, len, 12), brass, x, y0 + len / 2, z);
      M(new THREE.CylinderGeometry(r * 0.82, r, len * 0.12, 12), brass, x, y0 + len + len * 0.06, z);
      const tip = new THREE.LatheGeometry([[r * 0.82, 0], [r * 0.8, tipLen * 0.35], [r * 0.6, tipLen * 0.7], [r * 0.28, tipLen * 0.93], [0.001, tipLen]].map(p => new THREE.Vector2(p[0], p[1])), 12);
      M(tip, copper, x, y0 + len * 1.12, z);
    };
    if (a === 'shells') {
      for (const [x, z] of [[-0.05, 0], [0.05, 0], [0, 0.07]]) {
        M(new THREE.CylinderGeometry(0.036, 0.036, 0.11, 14), hull, x, 0.085, z);
        M(new THREE.CylinderGeometry(0.038, 0.038, 0.035, 14), brass, x, 0.025, z);
        M(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 12), brassD, x, 0.142, z);
      }
      M(new THREE.CylinderGeometry(0.12, 0.13, 0.012, 20), band, 0, 0.004, 0.02);
    } else if (a === 'rockets') {
      const body = mat(0x5d6672, { rough: 0.4, metal: 0.5 }), red = mat(0xe8402a, { rough: 0.4 });
      M(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 14), body, 0, 0.19, 0);
      M(new THREE.ConeGeometry(0.045, 0.1, 14), red, 0, 0.36, 0);
      M(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 14), band, 0, 0.29, 0);
      for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; M(new THREE.BoxGeometry(0.006, 0.07, 0.05), red, Math.cos(an) * 0.055, 0.1, Math.sin(an) * 0.055, 0, -an, 0); }
      M(new THREE.CylinderGeometry(0.03, 0.04, 0.04, 12), mat(0x22252a), 0, 0.055, 0);
      M(new THREE.CylinderGeometry(0.11, 0.12, 0.012, 20), band, 0, 0.004, 0);
    } else {
      const [r, len, tl, n] = a === 'heavy' ? [0.034, 0.12, 0.07, 2] : a === 'medium' ? [0.025, 0.095, 0.05, 3] : [0.021, 0.06, 0.04, 4];
      const pts = n === 2 ? [[-0.045, 0], [0.045, 0]] : n === 3 ? [[-0.055, -0.02], [0.0, 0.03], [0.055, -0.02]] : [[-0.06, -0.025], [-0.02, 0.025], [0.02, -0.025], [0.06, 0.025]];
      for (const [x, z] of pts) round(x, z, r, len, tl);
      M(new THREE.BoxGeometry(n * 0.042 + 0.06, 0.04, 0.11), tray, 0, 0.02, 0);
      M(new THREE.BoxGeometry(n * 0.042 + 0.062, 0.014, 0.112), band, 0, 0.03, 0);
    }
    bake(g, true);
    return g;
  }
  function matsIcon(m) {
    const g = new THREE.Group();
    const col = [0xb57a42, 0xb5543e, 0x9aa6b1][m];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(m === 1 ? new THREE.BoxGeometry(0.26, 0.11, 0.13) : new THREE.BoxGeometry(0.45, 0.05, 0.14), mat(col, { metal: m === 2 ? 0.6 : 0, rough: m === 2 ? 0.35 : 0.8 }));
      b.position.set(0, i * (m === 1 ? 0.115 : 0.055), 0); b.rotation.y = i * 0.25;
      b.castShadow = true;
      g.add(b);
    }
    return g;
  }

  function chest(vault) {
    const g = new THREE.Group();
    const wood = mat(vault ? 0x3b2a6b : 0x7a4b20, { rough: 0.6 });
    const gold = mat(vault ? 0xb07cff : 0xffc533, { metal: 0.85, rough: 0.3, emissive: vault ? 0x2a1050 : 0x402200, ei: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), wood); base.position.y = 0.28; base.castShadow = true; g.add(base);
    for (const x of [-0.5, 0.5]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.57, 0.72), gold); t.position.set(x, 0.28, 0); g.add(t); }
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.07, 0.72), gold); t2.position.y = 0.06; g.add(t2);
    const lid = new THREE.Group(); lid.position.set(0, 0.55, 0.35); g.add(lid);
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 14, 1, false, 0, Math.PI), wood);
    lg.rotation.z = Math.PI / 2; lg.rotation.y = 0; lg.position.set(0, 0, -0.35); lg.castShadow = true; lid.add(lg);
    for (const x of [-0.5, 0.5]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 14, 1, false, 0, Math.PI), gold); t.rotation.z = Math.PI / 2; t.position.set(x, 0, -0.35); lid.add(t); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), gold); lock.position.set(0, 0.5, -0.37); g.add(lock);
    g.userData.lid = lid;
    bake(lid); bake(g, true);
    return g;
  }
  function ammoCrate() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.55), mat(0x4a5a34, { rough: 0.7 })); b.position.y = 0.21; b.castShadow = true; g.add(b);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.57), mat(0xe8c020, { emissive: 0x403000, ei: 0.4 })); s.position.y = 0.3; g.add(s);
    const lid = new THREE.Group(); lid.position.set(0, 0.42, 0.27); g.add(lid);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.56), mat(0x3d4a2a, { rough: 0.7 })); l.position.z = -0.28; lid.add(l);
    g.userData.lid = lid;
    bake(g, true);
    return g;
  }

  // the Battle Blimp: nose points down -Z
  function blimpTexture() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const x = c.getContext('2d');
    // u runs around the hull (0 top, 0.25 right flank, 0.5 belly, 0.75 left flank); v runs tail (0) to nose (1)
    const grd = x.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#4a98f5'); grd.addColorStop(0.25, '#2f7fe0'); grd.addColorStop(0.5, '#1b5ab0'); grd.addColorStop(0.75, '#2f7fe0'); grd.addColorStop(1, '#4a98f5');
    x.fillStyle = grd; x.fillRect(0, 0, 1024, 512);
    x.strokeStyle = 'rgba(10,30,70,0.32)'; x.lineWidth = 3;
    for (let i = 0; i < 16; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 512); x.stroke(); }
    for (let j = 1; j < 8; j++) { x.strokeStyle = 'rgba(10,30,70,0.14)'; x.beginPath(); x.moveTo(0, j * 64); x.lineTo(1024, j * 64); x.stroke(); }
    x.fillStyle = '#ffc531'; x.fillRect(0, 0, 1024, 34);
    x.fillStyle = '#ff5a3a'; x.fillRect(0, 488, 1024, 24);
    x.fillStyle = '#ffc531'; x.fillRect(0, 300, 1024, 18);
    x.fillStyle = '#ffffff'; x.fillRect(0, 294, 1024, 5); x.fillRect(0, 319, 1024, 5);
    for (const u of [0.25, 0.75]) {
      x.save(); x.translate(u * 1024, 262); x.rotate(u < 0.5 ? -Math.PI / 2 : Math.PI / 2);
      x.font = 'bold 50px "Lilita One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 9; x.strokeStyle = '#0f2f66'; x.lineJoin = 'round'; x.strokeText('BATTLE BLIMP', 0, 0);
      x.fillStyle = '#ffffff'; x.fillText('BATTLE BLIMP', 0, 0);
      x.restore();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  function blimp() {
    const g = new THREE.Group();
    const L = 23, Rm = 7.6;
    const prof = [];
    for (let i = 0; i <= 28; i++) {
      const y = -1 + i / 14;
      const r = Math.sqrt(Math.max(0, 1 - y * y)) * (y < 0 ? 1 - 0.32 * y * y : 1) * Rm;
      prof.push(new THREE.Vector2(Math.max(0.001, r), y * L));
    }
    const env = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), new THREE.MeshStandardMaterial({ map: blimpTexture(), roughness: 0.42, metalness: 0.05 }));
    env.rotation.x = -Math.PI / 2; env.castShadow = true; g.add(env);
    const finM = mat(0xff5a3a, { rough: 0.45 }), whiteM = mat(0xf4f4f4, { rough: 0.45 }), goldM = mat(0xffc531, { rough: 0.35, metal: 0.4 }), strutM = mat(0x4a4f57, { metal: 0.6, rough: 0.4 });
    // tail fins: a swept plate in the YZ plane, rotated round the hull axis
    const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(8, 0); fs.lineTo(10, 6.4); fs.lineTo(6, 6.4); fs.lineTo(0, 1.2); fs.lineTo(0, 0);
    const finGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
    finGeo.translate(0, 0, -0.15);
    finGeo.rotateY(-Math.PI / 2); // shape x -> +z (towards the tail), shape y stays up
    for (let i = 0; i < 4; i++) {
      const pv = new THREE.Group(); pv.rotation.z = i * Math.PI / 2 + Math.PI / 4; g.add(pv);
      const f = new THREE.Mesh(finGeo, i % 2 ? finM : whiteM);
      f.position.set(0, 2.6, 11.5); f.castShadow = true; pv.add(f);
    }
    // gondola with lit windows
    const gon = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 7.5, 6, 16), whiteM);
    gon.rotation.x = Math.PI / 2; gon.scale.set(1.25, 1, 0.85); gon.position.set(0, -8.4, -1); gon.castShadow = true; g.add(gon);
    const win = mat(0x1d2a3a, { emissive: 0xffd790, ei: 0.9, rough: 0.1 });
    for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.85), win); w.position.set(sx * 2.08, -8.1, -4.4 + i * 1.15); g.add(w); }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), win); nose.scale.set(1.5, 0.8, 0.6); nose.position.set(0, -8.0, -5.9); g.add(nose);
    const trimG = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.12, 8, 30), goldM); trimG.scale.set(1.25, 0.85, 1); trimG.position.set(0, -8.4, 3.0); g.add(trimG);
    for (const z of [-4.5, 3]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.5, 8), strutM); s.position.set(0, -6.3, z); g.add(s); }
    g.userData.props = [];
    for (const sx of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 0.8), strutM); strut.position.set(sx * 3.6, -7.7, 1.5); g.add(strut);
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.2, 4, 14), goldM); pod.rotation.x = Math.PI / 2; pod.position.set(sx * 5.4, -7.7, 1.5); pod.castShadow = true; g.add(pod);
      const prop = new THREE.Group(); prop.position.set(sx * 5.4, -7.7, 3.35); g.add(prop);
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.8, 0.08), mat(0x2a2d33)); b.rotation.z = i * Math.PI * 2 / 3; prop.add(b); }
      prop.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), finM));
      g.userData.props.push(prop);
    }
    const lr = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(0xff2a2a, { emissive: 0xff2a2a, ei: 2 })); lr.position.set(-Rm * 0.98, 0, 0); g.add(lr);
    const lgt = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mat(0x2aff5a, { emissive: 0x2aff5a, ei: 2 })); lgt.position.set(Rm * 0.98, 0, 0); g.add(lgt);
    return g;
  }

  function pad() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.14, 24), mat(0x2c2f36)); base.position.y = 0.07; base.castShadow = true; g.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 24), mat(0x48e0ff, { emissive: 0x1890c0, ei: 0.9 })); top.position.y = 0.17; g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.05, 6, 30), mat(0xffd23a, { emissive: 0x806000, ei: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
    return g;
  }

  return { mat, merge, bake, propGeos, gun, pickaxe, item, ammoBox, matsIcon, chest, ammoCrate, blimp, pad, T, TRS };
})();
