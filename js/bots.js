'use strict';
// CPU opponents. They run only on the host and act through the same action handlers as players.

const Bots = (() => {
  const DIFF = [
    { react: 0.6, aim: 0.085, turn: 4.5, build: 0.25, buildCd: 0.55, strafe: 0.5, jump: 0.05, sight: 80, heal: 0.6 },
    { react: 0.34, aim: 0.048, turn: 7, build: 0.6, buildCd: 0.3, strafe: 0.8, jump: 0.12, sight: 110, heal: 0.8 },
    { react: 0.17, aim: 0.024, turn: 11, build: 0.95, buildCd: 0.14, strafe: 1, jump: 0.2, sight: 140, heal: 1 },
  ];

  function init(H, p) {
    const R = H.R;
    p.bot = {
      think: R() * 0.2, goal: null, goalKind: '', target: null, seenT: -9, reactT: 0,
      aimOX: 0, aimOY: 0, aimT: 0, strafe: 1, strafeT: 0, stuckT: 0, lastX: p.x, lastZ: p.z, unstickT: 0, unstickDir: 0,
      reload: 0, healT: 0, healSlot: 0, buildT: 0, boxT: -9, threat: null, threatT: -9, switchT: 0,
      dropAt: null, landTarget: null, wantSlot: 1, fireHeld: false, burstLeft: 0, burstT: 0, spin: 0, harvestT: 0,
      nextShotT: 0, wanderT: 0,
    };
    p.inp = { mx: 0, mz: 0, yaw: p.yaw, jump: false, sprint: false, ads: false };
    if (H.G.mode === 'br') chooseDrop(H, p);
  }

  function chooseDrop(H, p) {
    const G = H.G, R = H.R;
    let tx, tz;
    if (G.W.pois.length && R() < 0.8) {
      const poi = R.pick(G.W.pois);
      const a = R() * Math.PI * 2, r = R() * poi.r;
      tx = poi.x + Math.cos(a) * r; tz = poi.z + Math.sin(a) * r;
    } else {
      for (let i = 0; i < 30; i++) {
        tx = R.range(-260, 260); tz = R.range(-260, 260);
        if (G.T.h(tx, tz) > 3) break;
      }
    }
    p.bot.landTarget = { x: tx, z: tz };
    // jump when the bus is near its closest point to the target
    const b = G.W.bus;
    const vx = b.bx - b.ax, vz = b.bz - b.az;
    const t = U.clamp(((tx - b.ax) * vx + (tz - b.az) * vz) / (vx * vx + vz * vz), 0.05, 0.95);
    p.bot.dropAt = U.clamp(t + R.range(-0.08, 0.04), 0.04, 0.95);
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  function los(G, a, b) {
    const o = { x: a.x, y: a.y + PH.EYE, z: a.z };
    const dx = b.x - o.x, dy = b.y + 1.2 - o.y, dz = b.z - o.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 0.5) return true;
    const d = { x: dx / l, y: dy / l, z: dz / l };
    const h = Phys.ray(G, o, d, l - 0.4);
    return !h;
  }

  function weaponScore(it, d) {
    if (!isWeapon(it)) return -1;
    const c = WEAPONS[it.w].cls;
    const r = it.r * 0.4;
    if (it.w === 'rocket' || it.w === 'gl') return (d > 12 && d < 70 ? 2.5 : 0.5) + r;
    if (d < 12) return ({ shotgun: 6, smg: 4.5, pistol: 3, ar: 3.5, sniper: 0.5 }[c] || 1) + r;
    if (d < 30) return ({ smg: 5, ar: 4.8, pistol: 3.5, shotgun: 1.5, sniper: 1.5 }[c] || 1) + r;
    if (d < 110) return ({ ar: 6, sniper: 4.5, smg: 3, pistol: 2.5, shotgun: 0.2 }[c] || 1) + r;
    return ({ sniper: 6, ar: 4.5, smg: 1.5, pistol: 1, shotgun: 0 }[c] || 1) + r;
  }
  function hasAmmo(p, it) {
    const st = WEAPONS[it.w];
    return (st.mag > 0 && it.mag > 0) || p.inv.ammo[st.ammo] > 0;
  }
  function bestSlot(p, d) {
    let best = -1, bs = 0;
    p.inv.s.forEach((it, i) => {
      if (!isWeapon(it) || !hasAmmo(p, it)) return;
      const s = weaponScore(it, d);
      if (s > bs) { bs = s; best = i + 1; }
    });
    return best;
  }
  function weaponCount(p) { return p.inv.s.filter(isWeapon).length; }

  function onHurt(H, p, att) {
    if (!p.bot || !att || att === p) return;
    p.bot.threat = att.id;
    p.bot.threatT = H.G.time;
    if (!p.bot.target) { p.bot.target = att.id; p.bot.seenT = H.G.time; p.bot.reactT = H.G.time + DIFF[p.diff].react * 0.7; }
  }

  function steerTo(p, x, z, run) {
    const dx = x - p.x, dz = z - p.z;
    p.bot.wantYaw = U.yawTo(dx, dz);
    p.inp.mx = 0; p.inp.mz = run ? 1 : 0;
  }

  function tryBuild(H, p, type, yaw, pitch, rot = 0) {
    const G = H.G;
    const m = [0, 1, 2].find(i => p.inv.mats[i] >= BUILD_COST);
    if (m === undefined) return false;
    const sup = Phys.supportBelow(G, p.x, p.y + 0.1, p.z, 3.5);
    const t = Build.target(type, p, yaw, pitch, rot, sup);
    if (G.structs.check({ ...t, mat: m })) return false;
    H.handleAction(p.id, { a: 'build', t: t.type, gx: t.gx, gy: t.gy, gz: t.gz, ax: t.axis, dir: t.dir, m });
    return true;
  }
  function boxUp(H, p) {
    const base = Math.round(p.yaw / (Math.PI / 2)) * (Math.PI / 2);
    let n = 0;
    for (let i = 0; i < 4; i++) if (tryBuild(H, p, 'wall', base + i * Math.PI / 2, 0)) n++;
    if (tryBuild(H, p, 'cone', p.yaw, 0)) n++;
    return n;
  }

  function aimAt(p, tx, ty, tz, D, dt, H) {
    const B = p.bot;
    const ex = p.x, ey = p.y + PH.EYE, ez = p.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const hd = Math.hypot(dx, dz);
    B.aimT += dt;
    if (B.aimT > 0.4) {
      B.aimT = 0;
      const err = D.aim * (1 + Math.max(0, 1.2 - (H.G.time - B.seenT) * 0.5));
      B.aimOX = (H.R() - 0.5) * 2 * err;
      B.aimOY = (H.R() - 0.5) * 2 * err * 0.6;
    }
    B.wantYaw = U.yawTo(dx, dz) + B.aimOX;
    B.wantPitch = Math.atan2(dy, hd) + B.aimOY;
  }

  function turn(p, D, dt) {
    const B = p.bot;
    if (B.wantYaw !== undefined) {
      const d = U.wrapAngle(B.wantYaw - p.yaw);
      const mx = D.turn * dt;
      p.yaw = U.wrapAngle(p.yaw + U.clamp(d, -mx, mx));
    }
    if (B.wantPitch !== undefined) {
      const d = B.wantPitch - p.pitch;
      const mx = D.turn * 0.8 * dt;
      p.pitch = U.clamp(p.pitch + U.clamp(d, -mx, mx), -1.4, 1.4);
    }
    p.inp.yaw = p.yaw;
  }

  function fire(H, p, D, distT) {
    const G = H.G, B = p.bot;
    const it = p.inv.s[p.slot - 1];
    if (!isWeapon(it) || B.reload > 0) return;
    const st = weaponStats(it.w, it.r);
    if (st.mag > 0 && it.mag <= 0) { startReload(p, st); return; }
    if (G.time < B.nextShotT) return;
    if (st.spin && (B.spin += 1 / 60) < st.spin) return;
    const ads = distT > 18 && st.cls !== 'shotgun';
    const sp = st.spread[ads ? 1 : 0] * (p.onGround ? 1 : 1.6) + (st.bloom || 0) * 2;
    const n = st.pellets || 1;
    const dirs = [];
    const base = U.dirFromYawPitch(p.yaw, p.pitch);
    for (let i = 0; i < n; i++) {
      const a = H.R() * Math.PI * 2, r = Math.sqrt(H.R()) * sp;
      const y2 = p.yaw + Math.cos(a) * r, p2 = p.pitch + Math.sin(a) * r;
      const d = n > 1 || sp > 0 ? U.dirFromYawPitch(y2, p2) : base;
      dirs.push([d.x, d.y, d.z]);
    }
    H.handleAction(p.id, { a: 'fire', s: p.slot, o: [p.x, p.y + PH.EYE, p.z], d: dirs });
    p.flags |= FL.FIRE;
    p.fireT = G.time;
    // pacing: bots shoot slower than max rate at range, like a human tapping
    let gap = st.burst ? st.burstGap : 1 / st.rate;
    if (st.burst) {
      B.burstLeft = (B.burstLeft || st.burst) - 1;
      if (B.burstLeft <= 0) { B.burstLeft = st.burst; gap = 1 / st.rate; }
    }
    if (distT > 40 && st.auto) gap *= 1.6 + H.R();
    B.nextShotT = G.time + gap * (1.02 + H.R() * 0.15) + (p.diff === 0 ? 0.08 : 0);
  }
  function startReload(p, st) {
    const B = p.bot;
    if (B.reload > 0) return;
    const it = p.inv.s[p.slot - 1];
    if (!it || p.inv.ammo[st.ammo] <= 0) return;
    B.reload = st.shellReload ? st.shellReload : st.reload;
    B.reloadSlot = p.slot;
  }

  function update(H, p, dt) {
    if (!p.bot) init(H, p);
    const G = H.G, B = p.bot, D = DIFF[p.diff] || DIFF[1];
    p.flags &= ~(FL.FIRE | FL.ADS | FL.SPRINT);
    if (p.state === 'bus') {
      const tb = G.time - H.busStart;
      const bp = G.busPos(Math.max(0, tb));
      if (tb > 1.5 && bp.f >= B.dropAt) H.jumpBus(p);
      return;
    }
    if (p.state === 'sky' || p.state === 'glide') {
      const t = B.landTarget || { x: 0, z: 0 };
      steerTo(p, t.x, t.z, dist(p, t) > 6);
      if (dist(p, t) < 30 && p.state === 'sky') p.inp.mz = 0.6;
      turn(p, { turn: 6 }, dt);
      return;
    }
    // ---- on foot ----
    B.think -= dt;
    if (B.reload > 0) {
      B.reload -= dt;
      if (B.reload <= 0) {
        const it = p.inv.s[B.reloadSlot - 1];
        if (isWeapon(it)) {
          const st = WEAPONS[it.w];
          H.handleAction(p.id, { a: 'reload', s: B.reloadSlot, one: !!st.shellReload });
          if (st.shellReload && it.mag < st.mag && p.inv.ammo[st.ammo] > 0) B.reload = weaponStats(it.w, it.r).shellReload;
        }
        if (B.reload <= 0) B.reload = 0;
      }
    }
    if (B.think <= 0) { B.think = 0.12 + H.R() * 0.06; think(H, p, D); }

    const tgt = B.target ? G.players.get(B.target) : null;
    p.inp.jump = false;
    if (tgt && tgt.alive && G.time >= B.reactT) {
      const d = dist(p, tgt);
      aimAt(p, tgt.x, tgt.y + (d < 25 && p.diff === 2 && H.R() < 0.02 ? 1.6 : 1.15), tgt.z, D, dt, H);
      turn(p, D, dt);
      if (B.visible) {
        const ey = Math.abs(U.wrapAngle(B.wantYaw - p.yaw)) + Math.abs(B.wantPitch - p.pitch);
        if (ey < 0.12 + (d < 8 ? 0.2 : 0)) fire(H, p, D, d);
        p.flags |= (d > 18 ? FL.ADS : 0);
      }
      // movement: strafe and keep preferred range
      B.strafeT -= dt;
      if (B.strafeT <= 0) { B.strafe = H.R() < 0.5 ? -1 : 1; B.strafeT = 0.5 + H.R() * 0.9; }
      const it = p.inv.s[p.slot - 1];
      const cls = isWeapon(it) ? WEAPONS[it.w].cls : 'ar';
      const pref = cls === 'shotgun' ? 5 : cls === 'smg' ? 12 : cls === 'sniper' ? 70 : 28;
      p.inp.mx = B.strafe * D.strafe;
      p.inp.mz = d > pref * 1.4 ? 1 : d < pref * 0.6 ? -0.7 : 0;
      if (!B.visible) { p.inp.mz = 1; p.inp.mx = 0; B.wantYaw = U.yawTo(tgt.x - p.x, tgt.z - p.z); }
      if (p.onGround && H.R() < D.jump * dt * 10) p.inp.jump = true;
    } else {
      if (B.goal) {
        steerTo(p, B.goal.x, B.goal.z, true);
        p.inp.sprint = true;
        p.flags |= FL.SPRINT;
        B.wantPitch = 0;
      } else { p.inp.mz = 0; p.inp.mx = 0; }
      turn(p, D, dt);
    }
    // stuck handling
    B.stuckT += dt;
    if (B.stuckT > 0.9) {
      const moved = Math.hypot(p.x - B.lastX, p.z - B.lastZ);
      const trying = Math.abs(p.inp.mz) + Math.abs(p.inp.mx) > 0.3;
      if (trying && moved < 0.6) {
        B.unstickT = 0.9; B.unstickDir = H.R() < 0.5 ? -1 : 1;
        if (p.onGround) p.inp.jump = true;
        // chop through whatever blocks us
        const d = U.dirFromYawPitch(p.yaw, -0.05);
        const o = { x: p.x, y: p.y + 1.0, z: p.z };
        const h = Phys.ray(G, o, d, 2.2);
        if (h && (h.kind === 'piece' || h.kind === 'prop')) { B.chop = 1.2; B.chopSlot = p.slot; }
      }
      B.stuckT = 0; B.lastX = p.x; B.lastZ = p.z;
    }
    if (B.chop > 0) {
      B.chop -= dt;
      p.slot = 0;
      const d = U.dirFromYawPitch(p.yaw, -0.05);
      H.handleAction(p.id, { a: 'melee', o: [p.x, p.y + 1.1, p.z], d: [d.x, d.y, d.z] });
      if (B.chop <= 0) p.slot = Math.max(1, B.chopSlot || 1);
    }
    if (B.unstickT > 0) { B.unstickT -= dt; p.inp.mx = B.unstickDir; p.inp.mz = 0.4; }
    // healing
    if (B.healT > 0) {
      B.healT -= dt;
      p.flags |= FL.HEAL;
      p.inp.mx *= 0.3; p.inp.mz *= 0.3;
      if (B.healT <= 0) { H.handleAction(p.id, { a: 'use', s: B.healSlot }); p.flags &= ~FL.HEAL; }
    }
    if (!p.onGround) p.inp.sprint = false;
  }

  function think(H, p, D) {
    const G = H.G, B = p.bot, R = H.R;
    // --- target acquisition ---
    let best = null, bd = D.sight;
    for (const q of G.players.values()) {
      if (q === p || !q.alive || q.state === 'bus' || q.state === 'sky') continue;
      const d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    const threat = B.threat && G.time - B.threatT < 4 ? G.players.get(B.threat) : null;
    if (threat && threat.alive && dist(p, threat) < D.sight * 1.3) best = threat;
    if (G.mode === 'duel') best = [...G.players.values()].find(q => q !== p && q.alive) || null;
    if (best) {
      const vis = los(G, p, best);
      if (best.id !== B.target && vis) { B.target = best.id; B.reactT = G.time + D.react; B.seenT = G.time; }
      if (best.id === B.target) { B.visible = vis; if (vis) B.lastSeenT = G.time; }
      if (!vis && G.time - (B.lastSeenT || 0) > 6 && G.mode !== 'duel') B.target = null;
    } else { B.target = null; B.visible = false; }

    const tgt = B.target ? G.players.get(B.target) : null;
    const dT = tgt ? dist(p, tgt) : 999;
    const health = p.hp + p.sh;

    // --- weapon choice ---
    if (B.healT <= 0 && !(B.chop > 0)) {
      const want = bestSlot(p, tgt ? dT : 60);
      if (want > 0 && want !== p.slot && G.time > B.switchT) { p.slot = want; B.switchT = G.time + 0.35; B.reload = 0; B.spin = 0; }
      if (want < 0 && p.slot !== 0) p.slot = 0;
      const it = p.inv.s[p.slot - 1];
      if (isWeapon(it)) {
        const st = weaponStats(it.w, it.r);
        if (st.mag > 0 && it.mag < st.mag && (!B.visible || it.mag === 0) && B.reload <= 0 && p.inv.ammo[st.ammo] > 0) startReload(p, st);
      }
    }

    // --- building reactions ---
    const underFire = B.threat && G.time - B.threatT < 0.9;
    if (underFire && G.time > B.buildT && R() < D.build) {
      const att = G.players.get(B.threat);
      if (att) {
        const yaw = U.yawTo(att.x - p.x, att.z - p.z);
        B.buildT = G.time + D.buildCd;
        if (health < 90 && G.time - B.boxT > 6 && p.diff >= 1) { if (boxUp(H, p)) B.boxT = G.time; }
        else if (att.y > p.y + 2.5 || (R() < 0.4 && p.diff === 2)) { tryBuild(H, p, 'ramp', yaw, 0); tryBuild(H, p, 'wall', yaw, 0); }
        else tryBuild(H, p, 'wall', yaw, 0);
      }
    }
    // --- healing ---
    const canHeal = !B.visible && G.time - B.threatT > 2.5;
    if (B.healT <= 0 && canHeal && R() < D.heal) {
      let slot = -1;
      p.inv.s.forEach((it, i) => {
        if (slot >= 0 || !isItem(it)) return;
        const d = ITEMS[it.c];
        if (d.throw || d.trap) return;
        if (Inv.canUse(p, it) && (d.shield ? p.sh < d.max - 10 : d.heal ? p.hp < Math.min(80, d.max - 5) : health < 150)) slot = i + 1;
      });
      if (slot > 0) {
        if (G.time - B.boxT > 8 && p.diff >= 1 && B.target) { boxUp(H, p); B.boxT = G.time; }
        p.slot = slot; B.healSlot = slot; B.healT = ITEMS[p.inv.s[slot - 1].c].time;
      }
    }
    // --- throwables ---
    if (tgt && B.visible && dT > 8 && dT < 28 && R() < 0.04) {
      const ns = p.inv.s.findIndex(it => isItem(it) && ITEMS[it.c].throw);
      if (ns >= 0) {
        const yaw = U.yawTo(tgt.x - p.x, tgt.z - p.z);
        const sp = Math.min(24, dT * 0.95);
        H.handleAction(p.id, { a: 'throw', s: ns + 1, o: [p.x, p.y + PH.EYE, p.z], v: [U.fwdX(yaw) * sp, 7 + dT * 0.12, U.fwdZ(yaw) * sp] });
      }
    }
    if (G.mode === 'duel') { B.goal = tgt ? { x: tgt.x, z: tgt.z } : null; return; }

    // --- goals (out of combat) ---
    const s = G.storm;
    if (s && s.st !== 'pre') {
      const dCur = Math.hypot(p.x - s.cx, p.z - s.cz);
      const dNext = Math.hypot(p.x - s.tx, p.z - s.tz);
      if (dCur > s.r - 8 || (dNext > s.tr * 0.85 && (s.st === 'shrink' || s.t < 25))) {
        const a = Math.atan2(p.z - s.tz, p.x - s.tx);
        const rr = s.tr * 0.5;
        B.goal = { x: s.tx + Math.cos(a) * rr, z: s.tz + Math.sin(a) * rr };
        B.goalKind = 'storm';
        if (!B.visible) return;
      }
    }
    if (B.target && B.visible) return;
    // pick up anything we're standing next to
    let nearL = null, nd = 3.2;
    for (const l of G.loot.values()) {
      const d = Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z);
      if (d < nd && wantLoot(p, l)) { nd = d; nearL = l; }
    }
    if (nearL) {
      if (isWeapon(nearL.it) && weaponCount(p) >= 5) {
        let worst = 1, ws = 99;
        p.inv.s.forEach((it, i) => { if (isWeapon(it)) { const sc = it.r + weaponScore(it, 30) * 0.3; if (sc < ws) { ws = sc; worst = i + 1; } } });
        p.slot = worst;
      } else if (isItem(nearL.it) && !p.inv.s.includes(null)) {
        const ws = p.inv.s.findIndex(it => isWeapon(it) && it.r <= 1);
        if (ws >= 0) p.slot = ws + 1;
      }
      H.handleAction(p.id, { a: 'pickup', id: nearL.id });
    }
    for (const c of G.chests.values()) {
      if (!c.open && Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) < 3) H.handleAction(p.id, { a: 'open', id: c.id });
    }
    for (const c of G.aboxes.values()) {
      if (!c.open && Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) < 3) H.handleAction(p.id, { a: 'open', id: c.id, kind: 'abox' });
    }
    if (B.goalKind === 'storm' && B.goal && Math.hypot(p.x - B.goal.x, p.z - B.goal.z) > 6) return;
    // look for loot
    if (B.goal && B.goalKind !== 'wander' && Math.hypot(p.x - B.goal.x, p.z - B.goal.z) > 1.8 && G.time < B.goalUntil) return;
    let goal = null, gd = weaponCount(p) < 2 ? 70 : 38;
    for (const c of G.chests.values()) {
      if (c.open || Math.abs(c.y - p.y) > 9) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < gd) { gd = d; goal = { x: c.x, z: c.z }; }
    }
    for (const l of G.loot.values()) {
      if (!wantLoot(p, l) || Math.abs(l.y - p.y) > 9) continue;
      const d = Math.hypot(l.x - p.x, l.z - p.z) * (isWeapon(l.it) ? 0.8 : 1.2);
      if (d < gd) { gd = d; goal = { x: l.x, z: l.z }; }
    }
    if (goal) { B.goal = goal; B.goalKind = 'loot'; B.goalUntil = G.time + 12; return; }
    // harvest when low on materials
    if (p.inv.mats[0] + p.inv.mats[1] + p.inv.mats[2] < 120 && R() < 0.3) {
      let tree = null, td = 22;
      G.props.forRect(p.x - 22, p.z - 22, p.x + 22, p.z + 22, pr => { const d = Math.hypot(pr.x - p.x, pr.z - p.z); if (d < td) { td = d; tree = pr; } });
      if (tree) {
        if (td < 2.8) { p.slot = 0; B.wantYaw = U.yawTo(tree.x - p.x, tree.z - p.z); const d = U.dirFromYawPitch(B.wantYaw, -0.1); H.handleAction(p.id, { a: 'melee', o: [p.x, p.y + 1.2, p.z], d: [d.x, d.y, d.z], crit: R() < 0.3 }); B.goal = null; return; }
        B.goal = { x: tree.x, z: tree.z }; B.goalKind = 'harvest'; B.goalUntil = G.time + 6; return;
      }
    }
    // wander inside the safe zone
    B.wanderT -= 0.15;
    if (!B.goal || B.wanderT <= 0 || Math.hypot(p.x - B.goal.x, p.z - B.goal.z) < 3) {
      const cx = s && s.st !== 'pre' ? s.tx : 0, cz = s && s.st !== 'pre' ? s.tz : 0;
      const rr = s && s.st !== 'pre' ? s.tr * 0.8 : 220;
      let gx = cx, gz = cz;
      if (G.W.pois.length && R() < 0.5) {
        const poi = R.pick(G.W.pois);
        if (Math.hypot(poi.x - cx, poi.z - cz) < rr) { gx = poi.x; gz = poi.z; }
      } else {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * rr;
        gx = cx + Math.cos(a) * r; gz = cz + Math.sin(a) * r;
      }
      B.goal = { x: gx, z: gz }; B.goalKind = 'wander'; B.wanderT = 15 + R() * 15;
    }
  }

  function wantLoot(p, l) {
    const it = l.it;
    if (it.a) return p.inv.ammo[it.a] < 120 && p.inv.s.some(w => isWeapon(w) && WEAPONS[w.w].ammo === it.a);
    if (it.m !== undefined) return p.inv.mats[it.m] < 600;
    if (isItem(it)) {
      const have = p.inv.s.find(s => s && s.c === it.c);
      if (have) return have.n < ITEMS[it.c].stack;
      return p.inv.s.includes(null) || p.inv.s.some(w => isWeapon(w) && w.r <= 1 && weaponCount(p) > 3);
    }
    if (isWeapon(it)) {
      if (weaponCount(p) < 4 && p.inv.s.includes(null)) return !p.inv.s.some(w => isWeapon(w) && w.w === it.w && w.r >= it.r);
      return p.inv.s.some(w => isWeapon(w) && w.r < it.r - 0) && !p.inv.s.some(w => isWeapon(w) && w.w === it.w && w.r >= it.r);
    }
    return false;
  }

  return { update, onHurt, init };
})();
