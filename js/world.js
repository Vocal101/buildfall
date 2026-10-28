'use strict';
// Deterministic world generation from a seed: terrain, points of interest, prebuilt houses, props and loot spots.

const World = (() => {

  function makeTerrain(size, res, fn) {
    const n = res + 1, cell = size / res, half = size / 2;
    const hts = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) hts[iz * n + ix] = fn(-half + ix * cell, -half + iz * cell);
    const T = { size, res, n, cell, half, hts };
    T.h = (x, z) => {
      let fx = (x + half) / cell, fz = (z + half) / cell;
      if (fx < 0) fx = 0; else if (fx > res - 0.0001) fx = res - 0.0001;
      if (fz < 0) fz = 0; else if (fz > res - 0.0001) fz = res - 0.0001;
      const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
      const i = iz * n + ix;
      const a = hts[i], b = hts[i + 1], c = hts[i + n], d = hts[i + n + 1];
      // split the quad along its diagonal to match the rendered triangles
      if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
      return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
    };
    T.set = (ix, iz, v) => { hts[iz * n + ix] = v; };
    T.get = (ix, iz) => hts[iz * n + ix];
    return T;
  }

  // ---------- prebuilt structures ----------
  // Wall edit masks store REMOVED tiles; tile index = row * 3 + col, row 0 = bottom.
  const DOOR = (1 << 1) | (1 << 4);
  const WINDOW = 1 << 4;
  const WIDE_WINDOW = (1 << 3) | (1 << 4) | (1 << 5);

  function houseBuilder(W) {
    const pieces = W.pieces;
    const used = new Set();
    const addP = p => {
      const k = Build.keyOf(p);
      if (used.has(k)) return;
      used.add(k);
      p.world = true; p.owner = 0;
      pieces.push(p);
    };
    const floor = (gx, gy, gz, mat) => addP({ type: 'floor', gx, gy, gz, mat, mask: 0 });
    const wall = (axis, gx, gy, gz, mat, mask = 0) => addP({ type: 'wall', axis, gx, gy, gz, mat, mask });
    const ramp = (gx, gy, gz, dir, mat) => addP({ type: 'ramp', gx, gy, gz, dir, mat, mask: 0 });
    const cone = (gx, gy, gz, mat) => addP({ type: 'cone', gx, gy, gz, mat, mask: 0 });
    return { floor, wall, ramp, cone, used };
  }

  // A rectangular building w x d cells, `stories` tall. Returns interior spots for loot.
  function building(B, R, ox, oz, L, w, d, stories, style) {
    const spots = [];
    const wm = style.wall, fm = style.floor, rm = style.roof;
    const doorSide = R.int(0, 3);
    const doorIdx = R.int(0, (doorSide % 2 === 0 ? w : d) - 1);
    const rampCells = [];
    for (let s = 0; s < stories; s++) {
      const lv = L + s;
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
        const hole = rampCells.some(c => c[0] === ox + i && c[1] === oz + j && c[2] === lv - 1);
        if (!hole) B.floor(ox + i, lv, oz + j, s === 0 ? fm : style.upper);
      }
      for (let i = 0; i < w; i++) {
        for (const side of [0, 2]) {
          const gz = side === 0 ? oz : oz + d;
          let mask = 0;
          if (s === 0 && side === doorSide && i === doorIdx) mask = DOOR;
          else if (R.chance(style.windows)) mask = R.chance(0.3) ? WIDE_WINDOW : WINDOW;
          B.wall('z', ox + i, lv, gz, wm, mask);
        }
      }
      for (let j = 0; j < d; j++) {
        for (const side of [1, 3]) {
          const gx = side === 3 ? ox : ox + w;
          let mask = 0;
          if (s === 0 && side === doorSide && j === doorIdx) mask = DOOR;
          else if (R.chance(style.windows)) mask = R.chance(0.3) ? WIDE_WINDOW : WINDOW;
          B.wall('x', gx, lv, oz + j, wm, mask);
        }
      }
      // interior stairs to the next story
      if (s < stories - 1 && d >= 2) {
        const ci = (s % 2 === 0) ? 0 : w - 1;
        const up = (s % 2 === 0);
        const rz = up ? oz : oz + d - 1;
        B.ramp(ox + ci, lv, rz, up ? 0 : 2, style.stairs);
        rampCells.push([ox + ci, rz, lv]);
      }
      // loot spots on this story (avoid ramp cell)
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
        if (rampCells.some(c => c[0] === ox + i && c[1] === oz + j && (c[2] === lv || c[2] === lv - 1))) continue;
        spots.push({ x: (ox + i + 0.5) * S, y: lv * S + 0.15, z: (oz + j + 0.5) * S, story: s });
      }
    }
    const top = L + stories;
    if (style.flat) {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) B.floor(ox + i, top, oz + j, rm);
    } else {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) B.cone(ox + i, top, oz + j, rm);
    }
    return spots;
  }

  const STYLES = {
    cottage: { wall: 0, floor: 0, upper: 0, roof: 0, stairs: 0, windows: 0.45, flat: false },
    brick: { wall: 1, floor: 0, upper: 0, roof: 0, stairs: 0, windows: 0.4, flat: false },
    townhouse: { wall: 1, floor: 1, upper: 0, roof: 1, stairs: 0, windows: 0.5, flat: true },
    warehouse: { wall: 2, floor: 2, upper: 2, roof: 2, stairs: 2, windows: 0.2, flat: true },
    keep: { wall: 1, floor: 1, upper: 1, roof: 1, stairs: 1, windows: 0.3, flat: true },
  };

  function genBR(seed) {
    const R = U.rng(seed);
    const N = U.noise2(seed), N2 = U.noise2(seed + 7), N3 = U.noise2(seed + 13);
    const size = 800, res = 200;
    const islandR = 335;
    const rawH = (x, z) => {
      let d = Math.hypot(x, z) / islandR;
      d += N.fbm(x * 0.005 + 11, z * 0.005 - 4, 3) * 0.22;
      const land = U.smooth(1.0, 0.8, d);
      const hills = N.fbm(x * 0.0042, z * 0.0042, 5) * 0.5 + 0.5;
      const mtnMask = U.smooth(0.45, 0.75, N3.fbm(x * 0.0022 + 3, z * 0.0022 - 9, 2) * 0.5 + 0.5);
      const ridge = N2.ridge(x * 0.0065, z * 0.0065);
      const m = ridge * ridge * 52 * mtnMask;
      return land * (2.5 + hills * 17 + m) - (1 - land) * 12;
    };
    const T = makeTerrain(size, res, rawH);
    const W = { seed, mode: 'br', T, props: [], pieces: [], loot: [], chests: [], ammoBoxes: [], pois: [], roads: [], islandR };

    // ---- POIs ----
    const names = POI_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = R.int(0, i); [names[i], names[j]] = [names[j], names[i]]; }
    for (let tries = 0; tries < 600 && W.pois.length < 10; tries++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 255;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = T.h(x, z);
      if (h < 3.5 || h > 34) continue;
      if (W.pois.some(p => U.dist2(p.x, p.z, x, z) < 118)) continue;
      const r = R.range(34, 46);
      const cx = Math.round(x / S), cz = Math.round(z / S);
      const kinds = ['town', 'town', 'town', 'industrial', 'keep'];
      W.pois.push({ name: names[W.pois.length], x: cx * S, z: cz * S, cx, cz, r, kind: kinds[W.pois.length % kinds.length], level: Math.max(1, Math.round(h / S)) });
    }
    // flatten plateaus
    for (const p of W.pois) {
      const ph = p.level * S;
      const reach = p.r + 34;
      for (let iz = 0; iz < T.n; iz++) for (let ix = 0; ix < T.n; ix++) {
        const x = -T.half + ix * T.cell, z = -T.half + iz * T.cell;
        const dd = U.dist2(x, z, p.x, p.z);
        if (dd > reach) continue;
        const w = U.smooth(reach, p.r + 6, dd);
        T.set(ix, iz, U.lerp(T.get(ix, iz), ph, w));
      }
      p.y = ph;
    }
    // roads (minimum spanning tree between POIs)
    const inTree = [0];
    while (inTree.length < W.pois.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < W.pois.length; j++) {
        if (inTree.includes(j)) continue;
        const d = U.dist2(W.pois[i].x, W.pois[i].z, W.pois[j].x, W.pois[j].z);
        if (!best || d < best.d) best = { i, j, d };
      }
      if (!best) break;
      inTree.push(best.j);
      W.roads.push([W.pois[best.i].x, W.pois[best.i].z, W.pois[best.j].x, W.pois[best.j].z]);
    }

    // ---- buildings ----
    const B = houseBuilder(W);
    const spots = [];
    let propId = 1;
    const addProp = (t, x, z, s, rot, extra = {}) => {
      const y = T.h(x, z);
      const def = PROP_DEFS[t];
      const p = { id: propId++, t, x, y, z, s, rot, hp: Math.round(def.hp * s), max: Math.round(def.hp * s), mat: def.mat, alive: true, ...extra };
      W.props.push(p);
      return p;
    };
    for (const poi of W.pois) {
      const occ = new Set();
      const free = (x0, z0, w, d) => {
        for (let i = -1; i <= w; i++) for (let j = -1; j <= d; j++) if (occ.has((x0 + i) + ',' + (z0 + j))) return false;
        return true;
      };
      const mark = (x0, z0, w, d) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) occ.add((x0 + i) + ',' + (z0 + j)); };
      const rc = Math.floor(poi.r / S) - 1;
      let plan;
      if (poi.kind === 'industrial') plan = [['warehouse', 4, 3, 1], ['warehouse', 3, 3, 1], ['warehouse', 3, 2, 2], ['brick', 2, 2, 1], ['townhouse', 2, 3, 2]];
      else if (poi.kind === 'keep') plan = [['keep', 2, 2, 4], ['townhouse', 2, 3, 2], ['brick', 2, 2, 2], ['cottage', 2, 2, 1], ['cottage', 2, 3, 1]];
      else plan = [['townhouse', 2, 3, 2], ['brick', 2, 2, 2], ['cottage', 2, 2, 1], ['cottage', 3, 2, 1], ['brick', 2, 3, 1], ['townhouse', 3, 2, 2], ['cottage', 2, 2, 2]];
      for (const [style, w0, d0, st] of plan) {
        const rot = R.chance(0.5);
        const w = rot ? d0 : w0, d = rot ? w0 : d0;
        for (let t = 0; t < 40; t++) {
          const x0 = poi.cx + R.int(-rc, rc - w), z0 = poi.cz + R.int(-rc, rc - d);
          const ccx = (x0 + w / 2) * S, ccz = (z0 + d / 2) * S;
          if (U.dist2(ccx, ccz, poi.x, poi.z) > poi.r - Math.max(w, d) * S * 0.5) continue;
          if (!free(x0, z0, w, d)) continue;
          mark(x0, z0, w, d);
          const sp = building(B, R, x0, z0, poi.level, w, d, st, STYLES[style]);
          spots.push({ poi, list: sp, style, x0, z0, w, d, stories: st });
          break;
        }
      }
      // yard props
      for (let i = 0; i < 9; i++) {
        const a = R() * Math.PI * 2, rr = R.range(4, poi.r + 6);
        const x = poi.x + Math.cos(a) * rr, z = poi.z + Math.sin(a) * rr;
        const cx = Math.floor(x / S), cz = Math.floor(z / S);
        if (!free(cx, cz, 1, 1)) continue;
        occ.add(cx + ',' + cz);
        const kind = poi.kind === 'industrial' ? R.pick(['container', 'container', 'car', 'crate']) : R.pick(['car', 'crate', 'crate', 'car']);
        addProp(kind, x, z, 1, R.chance(0.5) ? 0 : Math.PI / 2);
      }
      // ammo boxes outside
      for (let i = 0; i < 2; i++) {
        const a = R() * Math.PI * 2, rr = R.range(6, poi.r);
        const x = poi.x + Math.cos(a) * rr, z = poi.z + Math.sin(a) * rr;
        const cx = Math.floor(x / S), cz = Math.floor(z / S);
        if (!free(cx, cz, 1, 1)) continue;
        W.ammoBoxes.push({ id: W.ammoBoxes.length + 1, x, y: T.h(x, z), z, rot: R() * 6.28, open: false });
      }
      poi.occ = occ;
    }

    // chests and floor loot inside buildings
    let lootId = 1;
    for (const b of spots) {
      const list = b.list.slice();
      for (let i = list.length - 1; i > 0; i--) { const j = R.int(0, i); [list[i], list[j]] = [list[j], list[i]]; }
      const nChest = Math.min(list.length, b.stories >= 2 ? 2 : 1);
      for (let i = 0; i < nChest; i++) {
        const s = list.shift();
        const vault = b.style === 'keep' && s.story === b.stories - 1;
        W.chests.push({ id: W.chests.length + 1, x: s.x + R.range(-0.6, 0.6), y: s.y, z: s.z + R.range(-0.6, 0.6), rot: R.int(0, 3) * Math.PI / 2, open: false, vault });
      }
      const nLoot = Math.min(list.length, R.int(1, 3));
      for (let i = 0; i < nLoot; i++) {
        const s = list.shift();
        for (const it of rollFloorLoot(R)) W.loot.push({ id: lootId++, x: s.x + R.range(-1, 1), y: s.y, z: s.z + R.range(-1, 1), it });
      }
    }

    // ---- nature ----
    const nearPOI = (x, z, pad) => W.pois.some(p => U.dist2(x, z, p.x, p.z) < p.r + pad);
    const nearRoad = (x, z) => W.roads.some(r => segDist(x, z, r) < 5);
    for (let i = 0; i < 2600; i++) {
      const x = R.range(-islandR, islandR), z = R.range(-islandR, islandR);
      const h = T.h(x, z);
      if (h < 2.6) continue;
      const dens = N.fbm(x * 0.012 + 50, z * 0.012, 3);
      if (dens < -0.05 + R() * 0.25) continue;
      if (nearPOI(x, z, 4) || nearRoad(x, z)) continue;
      const slope = Math.abs(T.h(x + 2, z) - T.h(x - 2, z)) + Math.abs(T.h(x, z + 2) - T.h(x, z - 2));
      if (slope > 6) continue;
      const t = h > 20 || N2(x * 0.01, z * 0.01) > 0.05 ? 'pine' : 'oak';
      addProp(t, x, z, R.range(0.8, 1.35), R() * 6.28);
    }
    for (let i = 0; i < 380; i++) {
      const x = R.range(-islandR, islandR), z = R.range(-islandR, islandR);
      const h = T.h(x, z);
      if (h < 1.2) continue;
      if (nearPOI(x, z, 3) || nearRoad(x, z)) continue;
      const big = R.chance(0.15);
      addProp('rock', x, z, big ? R.range(1.8, 2.8) : R.range(0.7, 1.4), R() * 6.28);
    }
    // a few lone outdoor chests near trees and rocks
    for (let i = 0; i < 14; i++) {
      const x = R.range(-280, 280), z = R.range(-280, 280);
      if (T.h(x, z) < 3 || nearPOI(x, z, 10)) continue;
      W.chests.push({ id: W.chests.length + 1, x, y: T.h(x, z), z, rot: R() * 6.28, open: false, vault: false });
    }
    // floor loot along roads
    for (const r of W.roads) {
      const len = Math.hypot(r[2] - r[0], r[3] - r[1]);
      for (let t = 30; t < len - 30; t += R.range(35, 60)) {
        const f = t / len;
        const x = U.lerp(r[0], r[2], f) + R.range(-8, 8), z = U.lerp(r[1], r[3], f) + R.range(-8, 8);
        const h = T.h(x, z);
        if (h < 1.5) continue;
        for (const it of rollFloorLoot(R)) W.loot.push({ id: lootId++, x, y: h, z, it });
      }
    }
    // decorative bushes (no collision)
    W.bushes = [];
    for (let i = 0; i < 900; i++) {
      const x = R.range(-islandR, islandR), z = R.range(-islandR, islandR);
      const h = T.h(x, z);
      if (h < 2.5 || nearPOI(x, z, -2)) continue;
      W.bushes.push({ x, y: h, z, s: R.range(0.6, 1.3), rot: R() * 6.28 });
    }
    W.nextLoot = lootId;
    W.nextProp = propId;
    // bus path
    const ang = R() * Math.PI * 2, off = R.range(-70, 70);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const nx = -dz, nz = dx;
    W.bus = { ax: -dx * 420 + nx * off, az: -dz * 420 + nz * off, bx: dx * 420 + nx * off, bz: dz * 420 + nz * off, y: 150, speed: 30 };
    W.bus.len = Math.hypot(W.bus.bx - W.bus.ax, W.bus.bz - W.bus.az);
    return W;
  }

  function segDist(x, z, r) {
    const vx = r[2] - r[0], vz = r[3] - r[1];
    const l2 = vx * vx + vz * vz;
    let t = ((x - r[0]) * vx + (z - r[1]) * vz) / l2;
    t = U.clamp(t, 0, 1);
    return U.dist2(x, z, r[0] + vx * t, r[1] + vz * t);
  }

  function genDuel(seed) {
    const R = U.rng(seed);
    const N = U.noise2(seed);
    const base = 8;
    const T = makeTerrain(480, 120, (x, z) => {
      const d = Math.hypot(x, z);
      const rim = U.smooth(96, 150, d);
      return base + rim * (14 + N.fbm(x * 0.01, z * 0.01, 4) * 18) + U.smooth(150, 230, d) * 10;
    });
    const W = { seed, mode: 'duel', T, props: [], pieces: [], loot: [], chests: [], ammoBoxes: [], pois: [{ name: 'Proving Grounds', x: 0, z: 0, r: 60, kind: 'arena', level: 2, y: base }], roads: [], bushes: [], islandR: 200 };
    let propId = 1;
    for (let i = 0; i < 520; i++) {
      const a = R() * Math.PI * 2, rr = R.range(112, 200);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const t = R.chance(0.7) ? 'pine' : (R.chance(0.6) ? 'oak' : 'rock');
      const s = t === 'rock' ? R.range(1.5, 3) : R.range(0.9, 1.5);
      W.props.push({ id: propId++, t, x, y: T.h(x, z), z, s, rot: R() * 6.28, hp: Math.round(PROP_DEFS[t].hp * s), max: Math.round(PROP_DEFS[t].hp * s), mat: PROP_DEFS[t].mat, alive: true });
    }
    for (let i = 0; i < 260; i++) {
      const a = R() * Math.PI * 2, rr = R.range(70, 110);
      W.bushes.push({ x: Math.cos(a) * rr, y: T.h(Math.cos(a) * rr, Math.sin(a) * rr), z: Math.sin(a) * rr, s: R.range(0.6, 1.2), rot: R() * 6.28 });
    }
    W.spawns = [{ x: -26, z: 2, yaw: -Math.PI / 2 }, { x: 26, z: -2, yaw: Math.PI / 2 }];
    W.nextLoot = 1; W.nextProp = propId;
    W.bus = null;
    return W;
  }

  // ---------- loot rolls ----------
  function pickWeighted(R, entries) {
    let tot = 0;
    for (const e of entries) tot += e[1];
    let x = R() * tot;
    for (const e of entries) { x -= e[1]; if (x <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }
  function rollRarity(R, table) { return pickWeighted(R, table.map((w, i) => [i, w])); }
  function rollWeapon(R, table) {
    let r = rollRarity(R, table);
    if (r === 5) {
      const w = R.pick(['tempest', 'dragon', 'skybreaker']);
      return { w, r: 5, mag: WEAPONS[w].mag };
    }
    const opts = WEAPON_IDS.filter(id => !WEAPONS[id].mythic && WEAPONS[id].weight > 0);
    let w = pickWeighted(R, opts.map(id => [id, WEAPONS[id].weight]));
    const rs = WEAPONS[w].rar;
    if (!rs.includes(r)) r = rs.reduce((best, v) => Math.abs(v - r) < Math.abs(best - r) ? v : best, rs[0]);
    return { w, r, mag: WEAPONS[w].mag };
  }
  function rollItem(R) {
    const c = pickWeighted(R, Object.entries(ITEM_WEIGHTS));
    const n = c === 'bandage' ? 5 : c === 'mini' ? 3 : c === 'nade' ? 3 : 1;
    return { c, n };
  }
  function ammoFor(w) { return { a: WEAPONS[w].ammo, n: AMMO[WEAPONS[w].ammo].pickup }; }
  function rollFloorLoot(R) {
    const x = R();
    if (x < 0.58) { const w = rollWeapon(R, FLOOR_RARITY); return [w, ammoFor(w.w)]; }
    if (x < 0.85) return [rollItem(R)];
    const a = R.pick(Object.keys(AMMO));
    return [{ a, n: AMMO[a].pickup }];
  }
  function rollChest(R, vault) {
    const w = rollWeapon(R, vault ? VAULT_RARITY : CHEST_RARITY);
    const out = [w, ammoFor(w.w), rollItem(R), { m: R.int(0, 2), n: 30 }];
    if (vault) out.push(rollWeapon(R, VAULT_RARITY), rollItem(R));
    return out;
  }
  function rollAmmoBox(R) {
    const a = R.pick(Object.keys(AMMO)), b = R.pick(Object.keys(AMMO));
    return [{ a, n: AMMO[a].pickup }, { a: b, n: AMMO[b].pickup }];
  }

  return { genBR, genDuel, rollFloorLoot, rollChest, rollAmmoBox, rollWeapon, rollItem, ammoFor, DOOR, WINDOW, segDist };
})();

// Props: harvestable world objects. col: collision shape for movement; hit: bullet shape.
const PROP_DEFS = {
  pine: { hp: 300, mat: 0, yield: 9, col: { k: 'cyl', r: 0.42, h: 3.5 }, hit: { k: 'cyl', r: 1.1, h: 9.5 } },
  oak: { hp: 380, mat: 0, yield: 10, col: { k: 'cyl', r: 0.5, h: 3.2 }, hit: { k: 'cyl', r: 1.6, h: 7.5 } },
  rock: { hp: 420, mat: 1, yield: 9, col: { k: 'cyl', r: 1.2, h: 1.35 }, hit: { k: 'cyl', r: 1.3, h: 1.5 } },
  crate: { hp: 150, mat: 0, yield: 6, col: { k: 'box', w: 1.5, h: 1.5, d: 1.5 }, hit: { k: 'box', w: 1.5, h: 1.5, d: 1.5 } },
  car: { hp: 420, mat: 2, yield: 11, col: { k: 'box', w: 2.0, h: 1.45, d: 4.3 }, hit: { k: 'box', w: 2.0, h: 1.45, d: 4.3 } },
  container: { hp: 900, mat: 2, yield: 13, col: { k: 'box', w: 2.6, h: 2.8, d: 6.4 }, hit: { k: 'box', w: 2.6, h: 2.8, d: 6.4 } },
};
