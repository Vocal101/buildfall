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
    return { pine, oak, rock, bush, crate, car, container };
  }

  // ---------- characters ----------
  function avatar(skinIdx) {
    const sk = SKINS[skinIdx % SKINS.length];
    const root = new THREE.Group();
    const dk = c => new THREE.Color(c).multiplyScalar(0.55).getHex();
    const suit = mat(sk.suit, { rough: 0.55 }), pants = mat(dk(sk.suit), { rough: 0.7 }), acc = mat(sk.accent, { rough: 0.45 });
    const skin = mat(sk.skin, { rough: 0.65 }), hairM = mat(sk.hair, { rough: 0.75 });
    const dark = mat(0x22252c, { rough: 0.6 }), white = mat(0xffffff, { rough: 0.3 }), eye = mat(0x16181d, { rough: 0.2 });
    const boot = mat(0x2b2622, { rough: 0.7 }), strap = mat(0x3a3128, { rough: 0.8 }), visor = mat(sk.visor, { rough: 0.15, metal: 0.5 });
    const add = (parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.scale.set(sx, sy, sz);
      me.castShadow = true;
      parent.add(me);
      return me;
    };
    const RB = (w, h, d) => new THREE.CapsuleGeometry(Math.min(w, d) / 2, Math.max(0.01, h - Math.min(w, d)), 4, 10);
    const hips = new THREE.Group(); hips.position.y = 0.9; root.add(hips);
    add(hips, new THREE.CapsuleGeometry(0.2, 0.08, 4, 10), pants, 0, 0.02, 0, 0, 0, Math.PI / 2, 1, 1.05, 0.7);
    const mkLeg = sx => {
      const g = new THREE.Group(); g.position.set(sx * 0.12, -0.02, 0); hips.add(g);
      add(g, new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), pants, 0, -0.24, 0);
      add(g, new THREE.CapsuleGeometry(0.088, 0.3, 4, 10), pants, 0, -0.58, 0);
      add(g, new THREE.SphereGeometry(0.095, 10, 8), acc, 0, -0.42, -0.035, 0, 0, 0, 1, 0.8, 0.7);
      add(g, RB(0.18, 0.16, 0.32), boot, 0, -0.83, -0.05, Math.PI / 2, 0, 0);
      add(g, new THREE.BoxGeometry(0.19, 0.04, 0.33), dark, 0, -0.9, -0.05);
      return g;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);
    const torso = new THREE.Group(); torso.position.y = 0.06; hips.add(torso);
    add(torso, new THREE.CapsuleGeometry(0.225, 0.3, 6, 14), suit, 0, 0.33, 0, 0, 0, 0, 1.08, 1, 0.82);
    add(torso, new THREE.CapsuleGeometry(0.15, 0.12, 4, 10), acc, 0, 0.38, -0.12, 0, 0, 0, 1, 1, 0.55);
    add(torso, new THREE.TorusGeometry(0.205, 0.035, 6, 20), strap, 0, 0.07, 0, Math.PI / 2, 0, 0, 1.08, 0.82, 1);
    add(torso, new THREE.BoxGeometry(0.09, 0.07, 0.04), mat(0xd8b24a, { metal: 0.8, rough: 0.3 }), 0, 0.07, -0.19);
    // backpack
    const packM = mat(dk(sk.accent), { rough: 0.6 });
    add(torso, new THREE.BoxGeometry(0.3, 0.34, 0.13), packM, 0, 0.37, 0.24);
    add(torso, new THREE.CapsuleGeometry(0.065, 0.17, 4, 10), packM, 0, 0.54, 0.24, 0, 0, Math.PI / 2);
    add(torso, new THREE.BoxGeometry(0.24, 0.12, 0.05), acc, 0, 0.3, 0.31);
    add(torso, new THREE.BoxGeometry(0.08, 0.05, 0.02), mat(0xd8b24a, { metal: 0.8, rough: 0.3 }), 0, 0.3, 0.34);
    for (const sx of [-1, 1]) add(torso, new THREE.BoxGeometry(0.05, 0.42, 0.04), strap, sx * 0.11, 0.38, -0.17, 0.15, 0, 0);
    // shoulder pads
    for (const sx of [-1, 1]) add(torso, new THREE.SphereGeometry(0.1, 10, 8), acc, sx * 0.27, 0.53, 0, 0, 0, 0, 1.1, 0.8, 1.1);
    const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
    add(head, new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), skin, 0, -0.14, 0);
    add(head, new THREE.SphereGeometry(0.21, 20, 16), skin, 0, 0.02, 0, 0, 0, 0, 1, 1.05, 1);
    // hair: cap, fringe and back
    add(head, new THREE.SphereGeometry(0.225, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM, 0, 0.04, 0.01, -0.15, 0, 0, 1, 1.05, 1.04);
    add(head, new THREE.CapsuleGeometry(0.06, 0.2, 4, 8), hairM, -0.06, 0.15, -0.17, 0, 0, 1.2, 1, 1, 0.8);
    add(head, new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), hairM, 0.08, 0.16, -0.17, 0, 0, -1.0, 1, 1, 0.8);
    add(head, new THREE.SphereGeometry(0.2, 14, 10), hairM, 0, -0.02, 0.07, 0, 0, 0, 1.05, 0.95, 0.9);
    // face
    for (const sx of [-1, 1]) {
      add(head, new THREE.SphereGeometry(0.042, 10, 8), white, sx * 0.075, 0.03, -0.18, 0, 0, 0, 1, 1.2, 0.6);
      add(head, new THREE.SphereGeometry(0.025, 8, 6), eye, sx * 0.075, 0.025, -0.205, 0, 0, 0, 1, 1.2, 0.6);
      add(head, new THREE.BoxGeometry(0.07, 0.015, 0.02), hairM, sx * 0.078, 0.095, -0.195, 0, 0, sx * -0.15);
    }
    add(head, new THREE.BoxGeometry(0.06, 0.014, 0.02), mat(0x7a3a2a), 0, -0.07, -0.2);
    // ear-piece visor gadget
    add(head, new THREE.BoxGeometry(0.04, 0.08, 0.06), visor, 0.21, 0.02, -0.02);
    const mkArm = sx => {
      const g = new THREE.Group(); g.position.set(sx * 0.31, 0.52, 0); torso.add(g);
      add(g, new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), suit, 0, -0.16, 0);
      add(g, new THREE.CapsuleGeometry(0.066, 0.2, 4, 8), skin, 0, -0.42, 0);
      add(g, new THREE.SphereGeometry(0.08, 10, 8), acc, 0, -0.58, 0, 0, 0, 0, 1, 1.1, 1);
      add(g, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10), acc, 0, -0.32, 0);
      return g;
    };
    const armL = mkArm(-1), armR = mkArm(1);
    const gunMount = new THREE.Group(); gunMount.position.set(0.27, 0.38, -0.36); torso.add(gunMount);
    // glider
    const glider = new THREE.Group();
    const wingG = new THREE.BufferGeometry();
    wingG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.2, -2.2, 0, 0.9, 0, 0.25, 0.4, 0, 0, -1.2, 0, 0.25, 0.4, 2.2, 0, 0.9], 3));
    wingG.computeVertexNormals();
    const wingM = new THREE.MeshStandardMaterial({ color: sk.accent, side: THREE.DoubleSide, roughness: 0.5 });
    const wing = new THREE.Mesh(wingG, wingM); wing.castShadow = true;
    glider.add(wing);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.27, 1.6), mat(sk.suit));
    stripe.position.set(0, 0.12, -0.4); glider.add(stripe);
    const strutM = mat(0x333333);
    for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), strutM); st.position.set(sx * 0.35, -0.65, 0.05); st.rotation.z = sx * 0.4; glider.add(st); }
    glider.position.y = 2.6; glider.visible = false;
    root.add(glider);
    for (const g of [hips, torso, head, armL, armR, legL, legR]) bake(g);
    return { root, hips, torso, head, armL, armR, legL, legR, gunMount, glider, walk: 0 };
  }

  // ---------- weapons ----------
  function gun(w, r) {
    const g = new THREE.Group();
    const st = WEAPONS[w];
    const rc = RARITY[r] ? RARITY[r].glow : 0xffffff;
    const body = mat(st.mythic ? 0x3a2e12 : 0x2b2f35, { rough: 0.45, metal: 0.5 });
    const body2 = mat(0x4a5058, { rough: 0.5, metal: 0.4 });
    const wood = mat(0x7a4b28, { rough: 0.7 });
    const accent = mat(rc, { rough: 0.35, metal: 0.2, emissive: rc, ei: 0.45 });
    const gold = mat(0xffcf40, { rough: 0.3, metal: 0.8, emissive: 0x553300, ei: 0.6 });
    const B = (m, sx, sy, sz, x, y, z, rx = 0) => { const me = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); me.position.set(x, y, z); me.rotation.x = rx; me.castShadow = true; g.add(me); return me; };
    const C = (m, rt, rb, len, x, y, z, seg = 10) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m); me.rotation.x = Math.PI / 2; me.position.set(x, y, z); me.castShadow = true; g.add(me); return me; };
    let muzzle = -0.6;
    const cls = w;
    if (cls === 'ar' || cls === 'burst' || cls === 'heavyar' || cls === 'scoped' || cls === 'tempest') {
      const thick = cls === 'heavyar' ? 1.25 : 1;
      B(body, 0.08 * thick, 0.12 * thick, 0.5, 0, 0, -0.15);
      B(body2, 0.07, 0.06, 0.2, 0, 0.08, -0.18);
      C(body, 0.02, 0.02, 0.3, 0, 0.01, -0.55);
      B(body, 0.06, 0.18, 0.08, 0, -0.12, -0.16, 0.25);
      B(cls === 'burst' ? body2 : body, 0.06, 0.1, 0.22, 0, -0.02, 0.18);
      B(body2, 0.05, 0.12, 0.05, 0, -0.1, 0.02, -0.2);
      B(st.mythic ? gold : accent, 0.085 * thick, 0.025, 0.36, 0, 0.035, -0.14);
      B(accent, 0.062, 0.02, 0.18, 0, -0.02, 0.18);
      if (cls === 'scoped') { C(body2, 0.035, 0.035, 0.26, 0, 0.14, -0.15); C(accent, 0.04, 0.04, 0.02, 0, 0.14, -0.28); }
      else B(body, 0.03, 0.04, 0.04, 0, 0.09, -0.32);
      if (st.mythic) { B(gold, 0.09, 0.03, 0.12, 0, -0.07, -0.4); }
      muzzle = -0.72;
    } else if (cls === 'pump' || cls === 'tac' || cls === 'drum' || cls === 'dragon') {
      B(body, 0.075, 0.11, 0.42, 0, 0, -0.1);
      C(body2, 0.028, 0.028, 0.5, 0, 0.03, -0.5);
      if (cls !== 'drum') C(body, 0.02, 0.02, 0.48, 0, -0.03, -0.48);
      B(cls === 'pump' || cls === 'dragon' ? wood : body2, 0.07, 0.07, 0.16, 0, -0.03, -0.42);
      B(cls === 'tac' ? body2 : wood, 0.065, 0.11, 0.26, 0, -0.04, 0.22);
      if (cls === 'drum') C(body2, 0.08, 0.08, 0.08, 0, -0.1, -0.12, 14);
      B(st.mythic ? gold : accent, 0.08, 0.025, 0.3, 0, 0.065, -0.08);
      if (st.mythic) { B(gold, 0.08, 0.08, 0.04, 0, 0.03, -0.74); }
      muzzle = -0.76;
    } else if (cls === 'smg' || cls === 'stinger') {
      B(body, 0.075, 0.11, 0.34, 0, 0, -0.08);
      C(body2, 0.022, 0.022, 0.14, 0, 0.01, -0.32);
      B(body, 0.05, 0.2, 0.06, 0, -0.14, -0.06, cls === 'stinger' ? 0.1 : 0);
      B(body2, 0.05, 0.08, 0.16, 0, 0, 0.16);
      B(accent, 0.08, 0.025, 0.22, 0, 0.065, -0.08);
      if (cls === 'stinger') B(accent, 0.02, 0.1, 0.02, 0, -0.08, -0.22);
      muzzle = -0.4;
    } else if (cls === 'pistol' || cls === 'hcannon') {
      const s = cls === 'hcannon' ? 1.3 : 1;
      B(body, 0.05 * s, 0.07 * s, 0.24 * s, 0, 0, -0.06);
      B(body2, 0.045 * s, 0.14 * s, 0.07 * s, 0, -0.09 * s, 0.03, 0.25);
      B(accent, 0.052 * s, 0.02, 0.18 * s, 0, 0.042 * s, -0.06);
      muzzle = -0.2 * s;
    } else if (cls === 'hunting' || cls === 'bolt' || cls === 'heavysniper' || cls === 'skybreaker') {
      const L = cls === 'heavysniper' ? 1.2 : 1;
      B(cls === 'hunting' ? wood : body, 0.075, 0.1, 0.7 * L, 0, 0, -0.12);
      C(body2, 0.022 * L, 0.022 * L, 0.55 * L, 0, 0.03, -0.72 * L);
      B(cls === 'hunting' ? wood : body2, 0.065, 0.13, 0.26, 0, -0.04, 0.34);
      if (cls !== 'hunting') { C(body, 0.04 * L, 0.045 * L, 0.32, 0, 0.12, -0.12); C(accent, 0.048 * L, 0.048 * L, 0.02, 0, 0.12, -0.29); }
      if (cls === 'heavysniper') B(body2, 0.08, 0.06, 0.1, 0, 0.03, -1.05);
      B(st.mythic ? gold : accent, 0.08, 0.025, 0.4, 0, 0.055, -0.12);
      B(body2, 0.02, 0.02, 0.08, 0.06, 0.04, 0.04);
      muzzle = -1.0 * L;
    } else if (cls === 'rocket') {
      C(body2, 0.1, 0.1, 1.1, 0, 0.05, -0.15, 12);
      C(accent, 0.11, 0.11, 0.08, 0, 0.05, -0.68, 12);
      C(accent, 0.11, 0.11, 0.06, 0, 0.05, 0.38, 12);
      B(body, 0.05, 0.16, 0.06, 0, -0.1, -0.05, 0.2);
      B(body, 0.04, 0.08, 0.1, 0.1, 0.13, -0.2);
      muzzle = -0.72;
    } else if (cls === 'gl') {
      C(body, 0.07, 0.07, 0.6, 0, 0.03, -0.25, 12);
      C(body2, 0.11, 0.11, 0.18, 0, -0.01, -0.02, 6);
      B(accent, 0.12, 0.03, 0.22, 0, 0.11, -0.02);
      B(body, 0.05, 0.15, 0.06, 0, -0.12, 0.08, 0.2);
      B(body2, 0.06, 0.1, 0.2, 0, -0.02, 0.24);
      muzzle = -0.56;
    } else if (cls === 'minigun') {
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; C(body2, 0.022, 0.022, 0.7, Math.cos(a) * 0.06, 0.02 + Math.sin(a) * 0.06, -0.45, 6); }
      C(accent, 0.1, 0.1, 0.05, 0, 0.02, -0.75, 10);
      B(body, 0.16, 0.18, 0.36, 0, 0, 0.05);
      B(accent, 0.17, 0.04, 0.2, 0, 0.1, 0.05);
      B(body2, 0.05, 0.12, 0.08, 0, 0.14, -0.05);
      muzzle = -0.82;
    }
    g.userData.muzzle = muzzle;
    bake(g, true);
    return g;
  }
  function pickaxe() {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.9, 6), mat(0x6b4426));
    h.position.set(0, 0.25, 0); g.add(h);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), mat(0xa9b4bf, { metal: 0.7, rough: 0.3 }));
    head.position.set(0, 0.68, 0); g.add(head);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), mat(0xa9b4bf, { metal: 0.7, rough: 0.3 }));
    tip.rotation.z = -Math.PI / 2; tip.position.set(0.38, 0.68, 0); g.add(tip);
    const tip2 = tip.clone(); tip2.rotation.z = Math.PI / 2; tip2.position.x = -0.38; g.add(tip2);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), mat(0x2f6fd6));
    wrap.position.y = -0.1; g.add(wrap);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
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
  function ammoBox(a) {
    const g = new THREE.Group();
    const col = new THREE.Color(AMMO[a].color).getHex();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), mat(0x3d4a2f, { rough: 0.6 }));
    g.add(b);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.23), mat(col, { emissive: col, ei: 0.4 }));
    s.position.y = 0.02; g.add(s);
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

  function blimp() {
    const g = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat(0x2f7fe0, { rough: 0.45 }));
    env.scale.set(7.5, 7.5, 22); env.castShadow = true; g.add(env);
    const band = new THREE.Mesh(new THREE.SphereGeometry(1.01, 32, 20, 0, Math.PI * 2, Math.PI * 0.44, Math.PI * 0.12), mat(0xffc531, { rough: 0.4 }));
    band.scale.set(7.5, 7.5, 22); g.add(band);
    const bandR = new THREE.Mesh(new THREE.TorusGeometry(7.45, 0.5, 8, 40), mat(0xffc531));
    bandR.position.z = -6; g.add(bandR);
    const bandR2 = bandR.clone(); bandR2.position.z = 6; bandR2.scale.setScalar(0.96); g.add(bandR2);
    const finM = mat(0xff5a3a, { rough: 0.5 });
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 5), finM);
      const a = i * Math.PI / 2;
      f.position.set(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 18); f.rotation.z = a; f.castShadow = true; g.add(f);
    }
    const gon = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 10), mat(0xf2f2f2, { rough: 0.5 })); gon.position.set(0, -8.4, 0); gon.castShadow = true; g.add(gon);
    const win = new THREE.Mesh(new THREE.BoxGeometry(4.05, 0.7, 8.6), mat(0x223040, { emissive: 0xffd080, ei: 0.5 })); win.position.set(0, -8.1, 0); g.add(win);
    const prop = new THREE.Group(); prop.position.set(0, -8.4, 5.6); g.add(prop);
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.1), mat(0x333333)); b.rotation.z = i * Math.PI / 3 * 2; prop.add(b); }
    g.userData.prop = prop;
    return g;
  }

  function pad() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.14, 24), mat(0x2c2f36)); base.position.y = 0.07; base.castShadow = true; g.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 24), mat(0x48e0ff, { emissive: 0x1890c0, ei: 0.9 })); top.position.y = 0.17; g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.05, 6, 30), mat(0xffd23a, { emissive: 0x806000, ei: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; g.add(ring);
    return g;
  }

  return { mat, merge, bake, propGeos, avatar, gun, pickaxe, item, ammoBox, matsIcon, chest, ammoCrate, blimp, pad, T, TRS };
})();
