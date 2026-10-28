'use strict';
// Building grid: pieces, slots, collision shapes, ray tests, support and placement targeting.
//
// Grid cell is S x S x S. Every piece lives in a unique slot, so two pieces can never overlap:
//   wall  'z' : plane z = gz*S, spanning x in [gx*S, gx*S+S]       key Zgx,gy,gz
//   wall  'x' : plane x = gx*S, spanning z in [gz*S, gz*S+S]       key Xgx,gy,gz
//   floor     : plane y = gy*S across cell (gx, gz)                 key Fgx,gy,gz
//   ramp/cone : the volume of cell (gx, gy, gz); they share a slot  key Vgx,gy,gz
// Ramp dir: 0 rises toward +z, 1 toward +x, 2 toward -z, 3 toward -x.

const Build = (() => {
  const HT = WALL_T / 2;
  const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
  const FULL = { wall: 511, floor: 15, cone: 15, ramp: 0 };

  function keyOf(p) {
    if (p.type === 'wall') return (p.axis === 'x' ? 'X' : 'Z') + p.gx + ',' + p.gy + ',' + p.gz;
    if (p.type === 'floor') return 'F' + p.gx + ',' + p.gy + ',' + p.gz;
    return 'V' + p.gx + ',' + p.gy + ',' + p.gz;
  }

  function aabb(p) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    switch (p.type) {
      case 'wall': return p.axis === 'z' ? [x0, y0, z0 - HT, x0 + S, y0 + S, z0 + HT] : [x0 - HT, y0, z0, x0 + HT, y0 + S, z0 + S];
      case 'floor': return [x0, y0 - HT, z0, x0 + S, y0 + HT, z0 + S];
      case 'ramp': return [x0, y0 - HT, z0, x0 + S, y0 + S + HT, z0 + S];
      default: return [x0, y0 - HT, z0, x0 + S, y0 + HT + CONE_H, z0 + S];
    }
  }

  // Collision boxes for walls and floors, merged along rows so edited pieces stay cheap.
  function boxes(p) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    const out = [];
    if (p.type === 'wall') {
      const t = S / 3;
      for (let r = 0; r < 3; r++) {
        let c = 0;
        while (c < 3) {
          if (p.mask & (1 << (r * 3 + c))) { c++; continue; }
          let e = c;
          while (e + 1 < 3 && !(p.mask & (1 << (r * 3 + e + 1)))) e++;
          const a = c * t, b = (e + 1) * t;
          if (p.axis === 'z') out.push([x0 + a, y0 + r * t, z0 - HT, x0 + b, y0 + (r + 1) * t, z0 + HT]);
          else out.push([x0 - HT, y0 + r * t, z0 + a, x0 + HT, y0 + (r + 1) * t, z0 + b]);
          c = e + 1;
        }
      }
    } else if (p.type === 'floor') {
      const h = S / 2;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        if (p.mask & (1 << (j * 2 + i))) continue;
        out.push([x0 + i * h, y0 - HT, z0 + j * h, x0 + (i + 1) * h, y0 + HT, z0 + (j + 1) * h]);
      }
    }
    return out;
  }

  // ramp: mid-plane height y = y0 + u, where u = a*x + b*z + c ranges 0..S across the cell
  function rampCoef(p) {
    const x0 = p.gx * S, z0 = p.gz * S;
    switch (p.dir) {
      case 0: return [0, 1, -z0];
      case 1: return [1, 0, -x0];
      case 2: return [0, -1, z0 + S];
      default: return [-1, 0, x0 + S];
    }
  }

  // Top walking surface of a ramp or roof at (x, z), or null.
  function surfaceAt(p, x, z) {
    const x0 = p.gx * S, z0 = p.gz * S;
    if (x < x0 || x > x0 + S || z < z0 || z > z0 + S) return null;
    const y0 = p.gy * S;
    if (p.type === 'ramp') {
      const [a, b, c] = rampCoef(p);
      return y0 + HT + U.clamp(a * x + b * z + c, 0, S);
    }
    if (p.type === 'cone') {
      const i = x < x0 + S / 2 ? 0 : 1, j = z < z0 + S / 2 ? 0 : 1;
      if (p.mask & (1 << (j * 2 + i))) return null;
      const m = Math.max(Math.abs(x - x0 - S / 2), Math.abs(z - z0 - S / 2));
      return y0 + HT + CONE_H * (1 - m / (S / 2));
    }
    return null;
  }

  // ---------- ray tests ----------
  function rayBox(o, d, b, maxT) {
    let t0 = 0, t1 = maxT, n = 0;
    for (let a = 0; a < 3; a++) {
      const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
      const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
      const lo = b[a], hi = b[a + 3];
      if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return null; continue; }
      let ta = (lo - oa) / da, tb = (hi - oa) / da;
      let na = -(a + 1);
      if (ta > tb) { const s = ta; ta = tb; tb = s; na = a + 1; }
      if (ta > t0) { t0 = ta; n = na; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    if (n === 0) return { t: 0, n: { x: -d.x, y: -d.y, z: -d.z } }; // started inside
    const ax = Math.abs(n) - 1, sg = n > 0 ? 1 : -1;
    return { t: t0, n: { x: ax === 0 ? sg : 0, y: ax === 1 ? sg : 0, z: ax === 2 ? sg : 0 } };
  }
  function rayTri(o, d, a, b, c, maxT) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) return null;
    const inv = 1 / det;
    const tx = o.x - a[0], ty = o.y - a[1], tz = o.z - a[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return null;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < 0 || t > maxT) return null;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * d.x + ny * d.y + nz * d.z > 0) { nx = -nx; ny = -ny; nz = -nz; }
    return { t, n: { x: nx, y: ny, z: nz } };
  }
  function coneTris(p) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    const cx = x0 + S / 2, cz = z0 + S / 2;
    const A = [cx, y0 + CONE_H, cz];
    const tris = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      if (p.mask & (1 << (j * 2 + i))) continue;
      const C = [x0 + i * S, y0, z0 + j * S];
      tris.push([C, [cx, y0, z0 + j * S], A], [C, A, [x0 + i * S, y0, cz]]);
    }
    return tris;
  }
  function rayPiece(p, o, d, maxT) {
    if (!rayBox(o, d, p.box, maxT)) return null;
    let best = null;
    if (p.type === 'wall' || p.type === 'floor') {
      for (const b of p.cb) { const h = rayBox(o, d, b, maxT); if (h && (!best || h.t < best.t)) best = h; }
    } else if (p.type === 'ramp') {
      const [a, b, c] = rampCoef(p);
      const y0 = p.gy * S;
      const den = d.y - a * d.x - b * d.z;
      if (Math.abs(den) > 1e-9) {
        const t = (y0 + a * o.x + b * o.z + c - o.y) / den;
        if (t >= 0 && t <= maxT) {
          const x = o.x + d.x * t, z = o.z + d.z * t;
          const x0 = p.gx * S, z0 = p.gz * S;
          if (x >= x0 - 0.01 && x <= x0 + S + 0.01 && z >= z0 - 0.01 && z <= z0 + S + 0.01) {
            let nx = -a, ny = 1, nz = -b;
            const l = Math.hypot(nx, ny, nz);
            nx /= l; ny /= l; nz /= l;
            if (nx * d.x + ny * d.y + nz * d.z > 0) { nx = -nx; ny = -ny; nz = -nz; }
            best = { t, n: { x: nx, y: ny, z: nz } };
          }
        }
      }
    } else {
      for (const tr of p.tris) { const h = rayTri(o, d, tr[0], tr[1], tr[2], maxT); if (h && (!best || h.t < best.t)) best = h; }
    }
    return best;
  }

  // ---------- structure store ----------
  class Structs {
    constructor(T) {
      this.T = T;
      this.map = new Map();
      this.cols = new Map();
      this.stamp = 1;
    }
    colKeys(p) {
      if (p.type === 'wall') {
        if (p.axis === 'z') return [p.gx + ',' + (p.gz - 1), p.gx + ',' + p.gz];
        return [(p.gx - 1) + ',' + p.gz, p.gx + ',' + p.gz];
      }
      return [p.gx + ',' + p.gz];
    }
    refresh(p) {
      p.box = aabb(p);
      p.cb = boxes(p);
      p.tris = p.type === 'cone' ? coneTris(p) : null;
    }
    add(p) {
      p.k = keyOf(p);
      if (this.map.has(p.k)) return null;
      if (p.mask === undefined) p.mask = 0;
      this.refresh(p);
      this.map.set(p.k, p);
      for (const c of this.colKeys(p)) {
        let s = this.cols.get(c);
        if (!s) { s = new Set(); this.cols.set(c, s); }
        s.add(p);
      }
      return p;
    }
    remove(k) {
      const p = this.map.get(k);
      if (!p) return null;
      this.map.delete(k);
      for (const c of this.colKeys(p)) {
        const s = this.cols.get(c);
        if (s) { s.delete(p); if (!s.size) this.cols.delete(c); }
      }
      return p;
    }
    get(k) { return this.map.get(k); }
    // iterate unique pieces whose columns intersect the XZ rectangle
    forRect(minx, minz, maxx, maxz, fn) {
      const st = ++this.stamp;
      const cx0 = Math.floor(minx / S), cx1 = Math.floor(maxx / S);
      const cz0 = Math.floor(minz / S), cz1 = Math.floor(maxz / S);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const s = this.cols.get(cx + ',' + cz);
        if (!s) continue;
        for (const p of s) { if (p._s === st) continue; p._s = st; if (fn(p) === true) return; }
      }
    }
    raycast(o, d, maxT, skip) {
      let best = null;
      const st = ++this.stamp;
      ddaCols(o.x, o.z, d.x, d.z, maxT, S, (cx, cz, tIn) => {
        if (best && tIn > best.t + 0.5) return true;
        const s = this.cols.get(cx + ',' + cz);
        if (!s) return false;
        for (const p of s) {
          if (p._s === st) continue;
          p._s = st;
          if (skip && skip(p)) continue;
          const h = rayPiece(p, o, d, best ? best.t : maxT);
          if (h && (!best || h.t < best.t)) { best = h; best.piece = p; }
        }
        return false;
      });
      return best;
    }
    grounded(p) {
      const T = this.T, b = p.box;
      const pts = [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]], [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2]];
      let hmax = -1e9;
      for (const q of pts) hmax = Math.max(hmax, T.h(q[0], q[1]));
      return b[1] <= hmax + 0.35;
    }
    connected(a, b) {
      const A = a.box, B = b.box;
      let pos = 0;
      for (let i = 0; i < 3; i++) {
        const ov = Math.min(A[i + 3], B[i + 3]) - Math.max(A[i], B[i]);
        if (ov < -0.06) return false;
        if (ov > 0.06) pos++;
      }
      return pos >= 2;
    }
    neighbors(p) {
      const out = [], b = p.box;
      this.forRect(b[0] - 0.2, b[2] - 0.2, b[3] + 0.2, b[5] + 0.2, q => { if (q !== p && this.connected(p, q)) out.push(q); });
      return out;
    }
    supported(p) { return this.grounded(p) || this.neighbors(p).length > 0; }
    // After a piece is removed, find neighbor groups that lost their connection to the ground.
    unsupportedAfter(neigh) {
      const doomed = [];
      const seen = new Set();
      for (const n of neigh) {
        if (seen.has(n.k) || !this.map.has(n.k)) continue;
        const comp = [];
        const queue = [n];
        const local = new Set([n.k]);
        let ok = false;
        while (queue.length) {
          const q = queue.pop();
          comp.push(q);
          if (q.world || this.grounded(q) || comp.length > 2500) { ok = true; break; }
          for (const m of this.neighbors(q)) if (!local.has(m.k)) { local.add(m.k); queue.push(m); }
        }
        for (const k of local) seen.add(k);
        if (!ok) for (const q of comp) doomed.push(q);
        if (!ok) for (const k of local) { const q = this.map.get(k); if (q && !comp.includes(q)) doomed.push(q); }
      }
      return doomed;
    }
    // Validate a placement descriptor; returns '' if fine or a reason.
    check(desc) {
      if (desc.gy < -3 || desc.gy > 45) return 'Too high';
      const p = { ...desc, mask: 0 };
      const k = keyOf(p);
      if (this.map.has(k)) return 'Occupied';
      p.k = k;
      this.refresh(p);
      if (!this.grounded(p)) {
        let any = false;
        const b = p.box;
        this.forRect(b[0] - 0.2, b[2] - 0.2, b[3] + 0.2, b[5] + 0.2, q => { if (this.connected(p, q)) { any = true; return true; } });
        if (!any) return 'No support';
      }
      return '';
    }
  }

  // Grid traversal over XZ columns of size cs along a normalized 3D direction.
  function ddaCols(ox, oz, dx, dz, maxT, cs, fn) {
    let cx = Math.floor(ox / cs), cz = Math.floor(oz / cs);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tdx = adx > 1e-9 ? cs / adx : Infinity, tdz = adz > 1e-9 ? cs / adz : Infinity;
    let tmx = adx > 1e-9 ? ((dx > 0 ? (cx + 1) * cs - ox : ox - cx * cs) / adx) : Infinity;
    let tmz = adz > 1e-9 ? ((dz > 0 ? (cz + 1) * cs - oz : oz - cz * cs) / adz) : Infinity;
    let t = 0, guard = 0;
    while (t <= maxT && guard++ < 2000) {
      if (fn(cx, cz, t)) return;
      if (tmx < tmz) { t = tmx; tmx += tdx; cx += sx; } else { t = tmz; tmz += tdz; cz += sz; }
    }
  }

  // ---------- placement targeting ----------
  function cardinal(yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
    return fz > 0 ? 0 : 2;
  }
  function wallOnEdge(cx, cz, d, gy) {
    if (d === 0) return { type: 'wall', axis: 'z', gx: cx, gy, gz: cz + 1 };
    if (d === 2) return { type: 'wall', axis: 'z', gx: cx, gy, gz: cz };
    if (d === 1) return { type: 'wall', axis: 'x', gx: cx + 1, gy, gz: cz };
    return { type: 'wall', axis: 'x', gx: cx, gy, gz: cz };
  }
  // sup: {y, piece} support under the player's feet (or null)
  function target(type, pl, yaw, pitch, rot, sup) {
    const d = cardinal(yaw);
    const cx = Math.floor(pl.x / S), cz = Math.floor(pl.z / S);
    const feet = sup ? sup.y : pl.y;
    let H = feet - HT;
    const sp = sup && sup.piece;
    if (sp && sp.type === 'ramp' && type !== 'cone') {
      if (sp.dir === d) H = (sp.gy + 1) * S;
      else if (sp.dir === ((d + 2) & 3)) H = sp.gy * S;
    }
    const L = Math.floor((H + 0.6) / S);
    if (type === 'wall') {
      let gy = L;
      if (pitch > 0.62) gy = L + 1;
      else if (pitch < -0.92) gy = L - 1;
      return wallOnEdge(cx, cz, d, gy);
    }
    if (type === 'floor') {
      if (pitch > 0.55) return { type, gx: cx, gy: L + 1, gz: cz };
      if (pitch < -0.95) return { type, gx: cx, gy: Math.floor((feet - HT + 0.6) / S), gz: cz };
      return { type, gx: cx + DX[d], gy: L, gz: cz + DZ[d] };
    }
    if (type === 'ramp') {
      const dir = (d + rot) & 3;
      if (pitch > 0.8) return { type, gx: cx + DX[d], gy: L + 1, gz: cz + DZ[d], dir };
      if (pitch < -0.95) return { type, gx: cx, gy: Math.floor((feet - HT + 0.6) / S) - (sp && sp.type === 'ramp' ? 0 : 0), gz: cz, dir };
      return { type, gx: cx + DX[d], gy: L, gz: cz + DZ[d], dir };
    }
    // cone
    const L2 = Math.floor((feet - HT + 0.6) / S);
    if (pitch < -0.6) return { type: 'cone', gx: cx + DX[d], gy: L2, gz: cz + DZ[d] };
    return { type: 'cone', gx: cx, gy: L2 + 1, gz: cz };
  }

  // ---------- editing ----------
  // Tile layout for edit mode. Returns {cols, rows, idx(hitPoint) -> tile index or -1}
  function editGrid(p) {
    if (p.type === 'wall') return { cols: 3, rows: 3 };
    return { cols: 2, rows: 2 };
  }
  // Ray vs the piece's edit plane -> tile index.
  function editTileAt(p, o, d) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    let t, u, v;
    if (p.type === 'wall') {
      if (p.axis === 'z') {
        if (Math.abs(d.z) < 1e-6) return -1;
        t = (z0 - o.z) / d.z; if (t < 0) return -1;
        u = (o.x + d.x * t - x0) / S; v = (o.y + d.y * t - y0) / S;
      } else {
        if (Math.abs(d.x) < 1e-6) return -1;
        t = (x0 - o.x) / d.x; if (t < 0) return -1;
        u = (o.z + d.z * t - z0) / S; v = (o.y + d.y * t - y0) / S;
      }
      if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return -1;
      const c = U.clamp(Math.floor(u * 3), 0, 2), r = U.clamp(Math.floor(v * 3), 0, 2);
      return r * 3 + c;
    }
    let py = y0;
    if (p.type === 'cone') py = y0 + CONE_H * 0.5;
    if (p.type === 'ramp') {
      const [a, b, c] = rampCoef(p);
      const den = d.y - a * d.x - b * d.z;
      if (Math.abs(den) < 1e-6) return -1;
      t = (y0 + a * o.x + b * o.z + c - o.y) / den;
    } else {
      if (Math.abs(d.y) < 1e-6) return -1;
      t = (py - o.y) / d.y;
    }
    if (t < 0) return -1;
    u = (o.x + d.x * t - x0) / S; v = (o.z + d.z * t - z0) / S;
    if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return -1;
    const i = U.clamp(Math.floor(u * 2), 0, 1), j = U.clamp(Math.floor(v * 2), 0, 1);
    return j * 2 + i;
  }
  // World-space center of an edit tile (for drawing the overlay).
  function tileCenter(p, idx) {
    const x0 = p.gx * S, y0 = p.gy * S, z0 = p.gz * S;
    if (p.type === 'wall') {
      const c = idx % 3, r = (idx / 3) | 0, t = S / 3;
      if (p.axis === 'z') return { x: x0 + (c + 0.5) * t, y: y0 + (r + 0.5) * t, z: z0 };
      return { x: x0, y: y0 + (r + 0.5) * t, z: z0 + (c + 0.5) * t };
    }
    const i = idx % 2, j = (idx / 2) | 0, h = S / 2;
    const x = x0 + (i + 0.5) * h, z = z0 + (j + 0.5) * h;
    if (p.type === 'floor') return { x, y: y0 + HT + 0.02, z };
    const sy = surfaceAt({ ...p, mask: 0 }, x, z);
    return { x, y: (sy !== null ? sy : y0) + 0.05, z };
  }
  // Ramp edit: drag direction between two tiles -> ramp dir
  function rampDirFromDrag(a, b) {
    const ai = a % 2, aj = (a / 2) | 0, bi = b % 2, bj = (b / 2) | 0;
    const di = bi - ai, dj = bj - aj;
    if (di === 0 && dj === 0) return -1;
    if (Math.abs(di) >= Math.abs(dj)) return di > 0 ? 1 : 3;
    return dj > 0 ? 0 : 2;
  }
  function validMask(type, mask) {
    if (type === 'ramp') return true;
    return (mask & FULL[type]) !== FULL[type];
  }

  return { keyOf, aabb, boxes, surfaceAt, rayBox, rayPiece, Structs, ddaCols, cardinal, target, editGrid, editTileAt, tileCenter, rampDirFromDrag, validMask, rampCoef, coneTris, DX, DZ, FULL };
})();
