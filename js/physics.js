'use strict';
// Player movement, collision against terrain/builds/props, and world ray casts.

const PH = {
  R: 0.36, H: 1.85, EYE: 1.62, STEP: 0.55,
  G: 22, JUMP: 7.4, RUN: 6.0, SPRINT: 7.9, ADS: 3.4, BACK: 0.85, AIRCTL: 0.55,
  SKY_FALL: 30, SKY_DIVE: 46, SKY_H: 16, GLIDE_FALL: 6.5, GLIDE_H: 15, AUTO_GLIDE: 55,
  SWIM: 3.2,
};

class PropIndex {
  constructor(props) {
    this.cs = 16;
    this.cells = new Map();
    this.byId = new Map();
    for (const p of props) this.add(p);
  }
  add(p) {
    const def = PROP_DEFS[p.t];
    const c = def.col, h = def.hit;
    const s = p.s;
    if (c.k === 'cyl') p.col = { k: 'cyl', x: p.x, z: p.z, r: c.r * s, y0: p.y - 0.5, y1: p.y + c.h * s };
    else {
      const sw = Math.abs(Math.sin(p.rot)) > 0.5;
      const w = (sw ? c.d : c.w) / 2, d = (sw ? c.w : c.d) / 2;
      p.col = { k: 'box', b: [p.x - w, p.y - 0.3, p.z - d, p.x + w, p.y + c.h, p.z + d] };
    }
    if (h.k === 'cyl') p.hitc = { k: 'cyl', x: p.x, z: p.z, r: h.r * s, y0: p.y - 0.5, y1: p.y + h.h * s };
    else p.hitc = p.col;
    this.byId.set(p.id, p);
    const k = Math.floor(p.x / this.cs) + ',' + Math.floor(p.z / this.cs);
    let a = this.cells.get(k);
    if (!a) { a = []; this.cells.set(k, a); }
    a.push(p);
  }
  forRect(minx, minz, maxx, maxz, fn) {
    const cs = this.cs;
    const x0 = Math.floor((minx - 4) / cs), x1 = Math.floor((maxx + 4) / cs);
    const z0 = Math.floor((minz - 4) / cs), z1 = Math.floor((maxz + 4) / cs);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const a = this.cells.get(x + ',' + z);
      if (a) for (const p of a) if (p.alive && fn(p) === true) return;
    }
  }
  raycast(o, d, maxT) {
    let best = null;
    const seen = new Set();
    Build.ddaCols(o.x, o.z, d.x, d.z, maxT + 8, this.cs, (cx, cz, tIn) => {
      if (best && tIn > best.t + 8) return true;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = this.cells.get((cx + ox) + ',' + (cz + oz));
        if (!a) continue;
        for (const p of a) {
          if (!p.alive || seen.has(p.id)) continue;
          seen.add(p.id);
          const h = rayShape(p.hitc, o, d, best ? best.t : maxT);
          if (h && (!best || h.t < best.t)) { best = h; best.prop = p; }
        }
      }
      return false;
    });
    return best;
  }
}

function rayShape(c, o, d, maxT) {
  if (c.k === 'box') return Build.rayBox(o, d, c.b, maxT);
  // vertical capped cylinder
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  let best = null;
  if (a > 1e-9) {
    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t = (-b - sq) / (2 * a);
      if (t >= 0 && t <= maxT) {
        const y = o.y + d.y * t;
        if (y >= c.y0 && y <= c.y1) {
          const nx = (ox + d.x * t) / c.r, nz = (oz + d.z * t) / c.r;
          best = { t, n: { x: nx, y: 0, z: nz } };
        }
      } else if (cc < 0) {
        const y = o.y;
        if (y >= c.y0 && y <= c.y1) best = { t: 0, n: { x: -d.x, y: -d.y, z: -d.z } };
      }
    }
  }
  if (Math.abs(d.y) > 1e-9) {
    for (const cy of [c.y1, c.y0]) {
      const t = (cy - o.y) / d.y;
      if (t < 0 || t > maxT || (best && t >= best.t)) continue;
      const x = ox + d.x * t, z = oz + d.z * t;
      if (x * x + z * z <= c.r * c.r) best = { t, n: { x: 0, y: cy === c.y1 ? 1 : -1, z: 0 } };
    }
  }
  return best;
}

const Phys = (() => {
  // Gather nearby collision data once per move step.
  function gather(G, x, z, r) {
    const boxes = [], surf = [], cyls = [];
    G.structs.forRect(x - r, z - r, x + r, z + r, p => {
      if (p.type === 'wall' || p.type === 'floor') { for (const b of p.cb) boxes.push(b); }
      else surf.push(p);
    });
    G.props.forRect(x - r, z - r, x + r, z + r, p => {
      if (p.col.k === 'box') boxes.push(p.col.b); else cyls.push(p.col);
    });
    if (G.pads) for (const pd of G.pads) if (Math.abs(pd.x - x) < r && Math.abs(pd.z - z) < r) boxes.push(pd.box);
    return { boxes, surf, cyls };
  }

  function overlapsXZ(b, x, z, R) { return x + R > b[0] && x - R < b[3] && z + R > b[2] && z - R < b[5]; }

  // Highest standable surface under (x, z) that is at most `maxY`.
  function groundAt(G, C, x, z, maxY, R) {
    let gy = G.T.h(x, z), piece = null;
    // sample terrain under the footprint so we don't sink into slopes
    for (const b of C.boxes) {
      if (!overlapsXZ(b, x, z, R - 0.04)) continue;
      if (b[4] <= maxY && b[4] > gy) { gy = b[4]; piece = b; }
    }
    for (const p of C.surf) {
      // sample center and footprint corners on ramps/roofs, take highest valid
      let hs = Build.surfaceAt(p, x, z);
      if (hs === null) {
        const pts = [[x + R * 0.7, z], [x - R * 0.7, z], [x, z + R * 0.7], [x, z - R * 0.7]];
        for (const q of pts) { const v = Build.surfaceAt(p, q[0], q[1]); if (v !== null && (hs === null || v > hs)) hs = v; }
      }
      if (hs !== null && hs <= maxY && hs > gy) { gy = hs; piece = p; }
    }
    for (const c of C.cyls) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + R * 0.5) ** 2 && c.y1 <= maxY && c.y1 > gy) { gy = c.y1; piece = c; }
    }
    return { y: gy, piece };
  }

  function blocked(G, C, x, y, z, R, H, step) {
    const lo = y + step, hi = y + H;
    for (const b of C.boxes) {
      if (!overlapsXZ(b, x, z, R)) continue;
      if (b[4] > lo && b[1] < hi) return true;
    }
    for (const p of C.surf) {
      const hs = Build.surfaceAt(p, x, z);
      if (hs === null) continue;
      if (hs > lo && hs - WALL_T < hi) return true;
    }
    for (const c of C.cyls) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + R) ** 2 && c.y1 > lo && c.y0 < hi) return true;
    }
    return false;
  }

  function ceilingAt(G, C, x, z, headY, R) {
    let cy = Infinity;
    for (const b of C.boxes) {
      if (!overlapsXZ(b, x, z, R - 0.05)) continue;
      if (b[1] >= headY - 0.05 && b[1] < cy) cy = b[1];
    }
    for (const p of C.surf) {
      const hs = Build.surfaceAt(p, x, z);
      if (hs === null) continue;
      const under = hs - WALL_T;
      if (under >= headY - 0.05 && under < cy) cy = under;
    }
    return cy;
  }

  // Support beneath a point (used by build targeting), searching `depth` meters down.
  function supportBelow(G, x, y, z, depth) {
    const C = gather(G, x, z, 1.5);
    const g = groundAt(G, C, x, z, y + 0.2, PH.R);
    if (y - g.y > depth) return null;
    return { y: g.y, piece: g.piece && g.piece.type ? g.piece : null };
  }

  // inp: {mx, mz, yaw, jump, sprint, ads, crouch}. Mutates p. Returns events {landed, fall}.
  function step(G, p, inp, dt) {
    const out = {};
    if (p.state === 'bus' || p.state === 'dead' || p.state === 'spec') return out;
    const yaw = inp.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = inp.mx || 0, mz = inp.mz || 0;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const T = G.T;

    if (p.state === 'sky' || p.state === 'glide') {
      const gnd = T.h(p.x, p.z);
      const sky = p.state === 'sky';
      const hs = sky ? PH.SKY_H : PH.GLIDE_H;
      const tvx = wx * hs, tvz = wz * hs;
      const k = Math.min(1, dt * (sky ? 2.2 : 1.6));
      p.vx += (tvx - p.vx) * k; p.vz += (tvz - p.vz) * k;
      let fall = sky ? (mz > 0.3 ? PH.SKY_DIVE : PH.SKY_FALL) : PH.GLIDE_FALL;
      if (!sky && mz < -0.3) fall *= 0.8;
      p.vy += (-fall - p.vy) * Math.min(1, dt * 3);
      const C = gather(G, p.x, p.z, 4);
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      const lim = G.T.half - 5;
      p.x = U.clamp(p.x, -lim, lim); p.z = U.clamp(p.z, -lim, lim);
      if (sky && (p.y - gnd < PH.AUTO_GLIDE || (inp.jump && p.y - gnd < 220))) { p.state = 'glide'; out.glide = true; }
      const g = groundAt(G, C, p.x, p.z, p.y + 1.5, PH.R);
      if (p.y <= g.y) {
        p.y = g.y; p.vy = 0; p.state = 'ground'; p.onGround = true; p.peakY = p.y; out.landed = true;
      }
      return out;
    }

    // ---- on foot ----
    const swim = p.y < WATER_Y - 1.1 && T.h(p.x, p.z) < WATER_Y - 1.1;
    let speed = inp.ads ? PH.ADS : (inp.sprint && mz > 0.2 && !inp.firing ? PH.SPRINT : PH.RUN);
    if (mz < -0.1) speed *= PH.BACK;
    if (swim) speed = PH.SWIM;
    if (p.slow) speed *= p.slow;
    const tvx = wx * speed, tvz = wz * speed;
    const accel = p.onGround || swim ? 14 : 14 * PH.AIRCTL;
    const k = Math.min(1, dt * accel);
    p.vx += (tvx - p.vx) * k; p.vz += (tvz - p.vz) * k;

    if (swim) {
      p.vy = (WATER_Y - 1.0 - p.y) * 4;
      if (inp.jump) p.vy = 2;
    } else {
      if (p.onGround && inp.jump) { p.vy = PH.JUMP; p.onGround = false; out.jumped = true; }
      p.vy -= PH.G * dt;
      if (p.vy < -55) p.vy = -55;
    }

    const R = PH.R, H = PH.H;
    const C = gather(G, p.x, p.z, 3 + Math.hypot(p.vx, p.vz) * dt);
    const step = p.onGround ? PH.STEP : 0.25;

    // separate axis moves
    const nx = p.x + p.vx * dt;
    if (!blocked(G, C, nx, p.y, p.z, R, H, step)) p.x = nx; else p.vx = 0;
    const nz = p.z + p.vz * dt;
    if (!blocked(G, C, p.x, p.y, nz, R, H, step)) p.z = nz; else p.vz = 0;
    // if pushed into geometry (e.g. a wall was built on us), nudge out
    if (blocked(G, C, p.x, p.y, p.z, R * 0.8, H * 0.95, step)) {
      let freed = false;
      for (let r = 0.15; r <= 2.0 && !freed; r += 0.15) {
        for (let a = 0; a < 8; a++) {
          const tx = p.x + Math.cos(a * Math.PI / 4) * r, tz = p.z + Math.sin(a * Math.PI / 4) * r;
          if (!blocked(G, C, tx, p.y, tz, R, H, step)) { p.x = tx; p.z = tz; freed = true; break; }
        }
      }
      if (!freed) p.y += 0.1;
    }

    const lim = G.T.half - 5;
    p.x = U.clamp(p.x, -lim, lim); p.z = U.clamp(p.z, -lim, lim);

    // vertical
    const wasGround = p.onGround;
    const g = groundAt(G, C, p.x, p.z, p.y + step, R);
    let ny = p.y + p.vy * dt;
    if (p.vy > 0) {
      const cy = ceilingAt(G, C, p.x, p.z, p.y + H, R);
      if (ny + H > cy) { ny = cy - H; p.vy = 0; }
    }
    if (ny <= g.y) {
      ny = g.y;
      if (!wasGround) {
        out.landed = true;
        const drop = (p.peakY !== undefined ? p.peakY : ny) - ny;
        if (drop > 9.5) out.fall = Math.round((drop - 9.5) * 7.5);
      }
      p.vy = 0; p.onGround = true; p.groundRef = g.piece;
    } else if (wasGround && p.vy <= 0 && p.y - g.y < 0.65) {
      ny = g.y; p.vy = 0; p.onGround = true; p.groundRef = g.piece; // stick to ramps going down
    } else {
      if (wasGround) p.peakY = p.y;
      p.onGround = false;
    }
    p.y = ny;
    if (!p.onGround) p.peakY = Math.max(p.peakY !== undefined ? p.peakY : p.y, p.y);
    else p.peakY = p.y;
    if (swim) { p.onGround = false; p.peakY = p.y; }
    p.swim = swim;
    // bounce pads
    if (G.pads && p.onGround) {
      for (const pd of G.pads) {
        if (Math.abs(pd.x - p.x) < 1.6 && Math.abs(pd.z - p.z) < 1.6 && Math.abs(p.y - pd.box[4]) < 0.3) {
          p.vy = 26; p.onGround = false; p.launched = true; p.peakY = -1e9; out.bounce = true;
        }
      }
    }
    if (p.launched && !p.onGround && p.vy < 0 && inp.jump) { p.state = 'glide'; p.launched = false; p.vx *= 0.5; p.vz *= 0.5; }
    if (p.onGround) p.launched = false;
    if (p.launched) p.peakY = p.y;
    return out;
  }

  // ---------- world ray ----------
  // Returns nearest hit among terrain, builds, props and (optionally) players.
  function ray(G, o, d, maxT, opt = {}) {
    let best = null;
    const sh = G.structs.raycast(o, d, maxT, opt.skipPiece);
    if (sh) best = { t: sh.t, n: sh.n, piece: sh.piece, kind: 'piece' };
    const ph = G.props.raycast(o, d, best ? best.t : maxT);
    if (ph && (!best || ph.t < best.t)) best = { t: ph.t, n: ph.n, prop: ph.prop, kind: 'prop' };
    const th = rayTerrain(G.T, o, d, best ? best.t : maxT);
    if (th !== null && (!best || th < best.t)) best = { t: th, n: { x: 0, y: 1, z: 0 }, kind: 'terrain' };
    if (opt.players) {
      for (const p of opt.players) {
        if (p === opt.ignore || !p.alive || p.state === 'bus') continue;
        const h = rayPlayer(p, o, d, best ? best.t : maxT);
        if (h && (!best || h.t < best.t)) best = { t: h.t, n: h.n, player: p, head: h.head, kind: 'player' };
      }
    }
    if (best) best.p = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }

  function rayTerrain(T, o, d, maxT) {
    let t = 0, prev = o.y - T.h(o.x, o.z);
    if (prev < 0) return 0;
    const stepL = 1.5;
    while (t < maxT) {
      const nt = Math.min(maxT, t + stepL);
      const x = o.x + d.x * nt, y = o.y + d.y * nt, z = o.z + d.z * nt;
      const diff = y - T.h(x, z);
      if (diff < 0) {
        let a = t, b = nt;
        for (let i = 0; i < 10; i++) {
          const m = (a + b) / 2;
          const dm = o.y + d.y * m - T.h(o.x + d.x * m, o.z + d.z * m);
          if (dm < 0) b = m; else a = m;
        }
        return a;
      }
      if (y > 160 && d.y > 0) return null;
      t = nt; prev = diff;
    }
    return null;
  }

  // hitboxes: body box + head sphere
  function rayPlayer(p, o, d, maxT) {
    const cx = p.x, cz = p.z;
    // quick reject
    const tx = cx - o.x, ty = p.y + 1 - o.y, tz = cz - o.z;
    const tp = tx * d.x + ty * d.y + tz * d.z;
    if (tp < -2 || tp > maxT + 2) return null;
    const qx = tx - d.x * tp, qy = ty - d.y * tp, qz = tz - d.z * tp;
    if (qx * qx + qy * qy + qz * qz > 2.2 * 2.2) return null;
    let best = null;
    const hy = p.y + (p.crouch ? 1.2 : 1.6);
    const hx = cx - o.x, hyy = hy - o.y, hz = cz - o.z;
    const b = hx * d.x + hyy * d.y + hz * d.z;
    const c = hx * hx + hyy * hyy + hz * hz - 0.27 * 0.27;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = b - Math.sqrt(disc);
      if (t >= 0 && t <= maxT) best = { t, head: true, n: { x: -d.x, y: -d.y, z: -d.z } };
    }
    const top = p.y + (p.crouch ? 1.0 : 1.38);
    const bb = [cx - 0.38, p.y, cz - 0.38, cx + 0.38, top, cz + 0.38];
    const h = Build.rayBox(o, d, bb, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) best = { t: h.t, head: false, n: h.n };
    return best;
  }

  return { step, ray, rayTerrain, rayPlayer, supportBelow, gather, groundAt, blocked };
})();
