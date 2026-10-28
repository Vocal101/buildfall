'use strict';
// Authoritative match simulation. Runs on the host (or offline). Clients only mirror its events.

const ST_CODE = { bus: 0, sky: 1, glide: 2, ground: 3, dead: 4 };
const ST_NAME = ['bus', 'sky', 'glide', 'ground', 'dead'];
const FL = { ADS: 1, BUILD: 2, FIRE: 4, RELOAD: 8, HEAL: 16, EMOTE: 32, SPRINT: 64, EDIT: 128, SWIM: 256, CROUCH: 512, AIR: 1024 };

class Host {
  constructor(G) {
    this.G = G;
    this.R = U.rng((G.cfg.seed ^ 0x51ed27) >>> 0);
    this.out = [];
    this.lootId = 1000000;
    this.projId = 1;
    this.padId = 1;
    this.dirtyHp = new Map();
    this.stormAcc = 0;
    this.busStart = 3;
    this.ended = false;
    G.host = this;
    if (G.mode === 'br') this.setupBR(); else this.setupDuel(true);
  }

  emit(ev) { this.G.apply(ev); this.out.push(ev); }
  drain() { const o = this.out; this.out = []; return o; }
  msg(text, to, kind) { this.emit({ t: 'msg', text, to, kind }); }

  // ---------- setup ----------
  setupBR() {
    const G = this.G;
    const bp = G.busPos(0);
    for (const p of G.players.values()) {
      p.state = 'bus'; p.x = bp.x; p.y = bp.y; p.z = bp.z; p.hp = 100; p.sh = 0;
      p.inv = Inv.make();
    }
    G.storm = { i: -1, st: 'pre', t: 0, cx: 0, cz: 0, r: 900, fx: 0, fz: 0, fr: 900, tx: 0, tz: 0, tr: 900, dps: 1 };
    G.phase = 'bus';
  }
  duelLoadout(p) {
    const inv = Inv.make();
    inv.s = [
      { w: 'ar', r: 4, mag: WEAPONS.ar.mag },
      { w: 'pump', r: 4, mag: WEAPONS.pump.mag },
      { w: 'smg', r: 4, mag: WEAPONS.smg.mag },
      { c: 'nade', n: 3 },
      { c: 'mini', n: 6 },
    ];
    for (const a in inv.ammo) inv.ammo[a] = 999;
    const m = this.G.cfg.mats || 999;
    inv.mats = [m, m, m];
    p.inv = inv; p.invDirty = true;
  }
  setupDuel(first) {
    const G = this.G;
    const ks = [];
    for (const p of G.structs.map.values()) if (!p.world) ks.push(p.k);
    if (ks.length) this.emit({ t: 'sClear', ks });
    if (G.loot.size) this.emit({ t: 'lClear' });
    if (G.pads.length) this.emit({ t: 'padClear' });
    const ids = [...G.players.keys()];
    const swap = (G.duel.round % 2) === 0;
    ids.forEach((id, i) => {
      const p = G.players.get(id);
      const sp = G.W.spawns[(i + (swap ? 1 : 0)) % 2];
      p.x = sp.x; p.z = sp.z; p.y = G.T.h(sp.x, sp.z) + 0.05; p.vx = p.vy = p.vz = 0;
      p.yaw = sp.yaw; p.pitch = 0;
      p.hp = 100; p.sh = 100; p.regen = 0;
      p.state = 'ground'; p.onGround = true;
      if (!p.alive) this.emit({ t: 'revive', id });
      p.alive = true;
      p.tp++;
      p.slot = 1;
      this.duelLoadout(p);
      if (first) G.duel.scores[id] = 0;
    });
    G.storm = { i: 0, st: 'wait', t: 40, cx: 0, cz: 0, r: 92, fx: 0, fz: 0, fr: 92, tx: 0, tz: 0, tr: 0, dps: 4, shrink: 75 };
    this.emit({ t: 'duel', d: { state: 'countdown', t: 3.5, round: G.duel.round, scores: { ...G.duel.scores } } });
  }

  // ---------- main tick ----------
  tick(dt) {
    const G = this.G;
    if (this.ended) { G.time += dt; return; }
    G.time += dt;
    if (G.mode === 'br') this.tickBR(dt); else this.tickDuel(dt);
    this.tickStorm(dt);
    for (const p of G.players.values()) {
      if (!p.alive) continue;
      if (!p.human) Bots.update(this, p, dt);
      if (!p.human && p.state !== 'bus' && p.state !== 'dead') {
        const frozen = G.duel && G.duel.state !== 'fight';
        const ev = Phys.step(G, p, frozen ? { yaw: p.yaw } : p.inp || { yaw: p.yaw }, dt);
        if (ev.fall) this.damagePlayer(p, ev.fall, null, { fall: true });
        if (ev.landed) p.landT = G.time;
      }
      if (p.regen > 0) {
        const add = Math.min(p.regen, 10 * dt);
        p.regen -= add;
        if (p.hp < 100) p.hp = Math.min(100, p.hp + add); else p.sh = Math.min(100, p.sh + add);
      }
      if (p.y < -40 && p.alive) this.damagePlayer(p, 999, null, { storm: true });
    }
    this.tickProjectiles(dt);
    G.update(dt);
    for (const [k, hp] of this.dirtyHp) {
      const p = G.structs.get(k);
      if (p) this.out.push({ t: 'sHp', k, hp: Math.round(p.hp), g: Math.round(p.grow) });
    }
    this.dirtyHp.clear();
  }

  tickBR(dt) {
    const G = this.G;
    if (G.phase !== 'bus') return;
    const tb = G.time - this.busStart;
    const bp = G.busPos(Math.max(0, tb));
    let inBus = 0;
    for (const p of G.players.values()) {
      if (p.state !== 'bus') continue;
      p.x = bp.x; p.y = bp.y - 3; p.z = bp.z;
      inBus++;
      if (bp.f >= 0.985) this.jumpBus(p);
    }
    if (tb > 0 && inBus === 0) {
      this.emit({ t: 'phase', phase: 'play' });
      this.startStormPhase(0);
    }
  }

  jumpBus(p) {
    const G = this.G;
    if (p.state !== 'bus') return;
    const tb = G.time - this.busStart;
    if (tb < 1) return;
    const bp = G.busPos(tb);
    p.state = 'sky'; p.x = bp.x; p.y = bp.y - 4; p.z = bp.z;
    const sp = G.W.bus.speed;
    p.vx = Math.cos(Math.atan2(G.W.bus.bz - G.W.bus.az, G.W.bus.bx - G.W.bus.ax)) * sp * 0.4;
    p.vz = Math.sin(Math.atan2(G.W.bus.bz - G.W.bus.az, G.W.bus.bx - G.W.bus.ax)) * sp * 0.4;
    p.vy = -5; p.tp++;
  }

  tickDuel(dt) {
    const G = this.G, D = G.duel;
    if (D.state === 'countdown') {
      D.t -= dt;
      if (D.t <= 0) this.emit({ t: 'duel', d: { state: 'fight', t: 0 } });
    } else if (D.state === 'roundEnd') {
      D.t -= dt;
      if (D.t <= 0) {
        G.duel.round++;
        this.setupDuel(false);
      }
    }
  }

  // ---------- storm ----------
  pickCircle(cx, cz, r, nr) {
    const G = this.G;
    for (let i = 0; i < 60; i++) {
      const a = this.R() * Math.PI * 2, d = Math.sqrt(this.R()) * Math.max(0, r - nr);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.hypot(x, z) > G.W.islandR - nr * 0.6 - 20) continue;
      if (G.T.h(x, z) < 2) continue;
      return [x, z];
    }
    return [cx, cz];
  }
  startStormPhase(i) {
    const G = this.G, s = G.storm;
    const P = STORM_PHASES[i];
    let cx = s.cx, cz = s.cz, r = s.r;
    if (i === 0) {
      const [x, z] = this.pickCircle(0, 0, 150, 0);
      s.cx = x; s.cz = z; s.r = 380;
      cx = x; cz = z; r = 380;
    }
    const [tx, tz] = this.pickCircle(cx, cz, r, P.r);
    Object.assign(s, { i, st: 'wait', t: P.wait, tx, tz, tr: P.r, dps: i === 0 ? 1 : STORM_PHASES[i - 1].dps, shrink: P.shrink });
    this.emit({ t: 'storm', i, st: 'wait', time: P.wait });
  }
  tickStorm(dt) {
    const G = this.G, s = G.storm;
    if (!s || s.st === 'pre' || s.st === 'done') { this.stormDamage(dt); return; }
    if (G.duel && G.duel.state !== 'fight') return;
    s.t -= dt;
    if (s.st === 'wait') {
      if (s.t <= 0) {
        s.st = 'shrink'; s.t = s.shrink; s.fx = s.cx; s.fz = s.cz; s.fr = s.r;
        s.dps = G.mode === 'duel' ? 6 : STORM_PHASES[s.i].dps;
        this.emit({ t: 'storm', i: s.i, st: 'shrink', time: s.shrink });
      }
    } else if (s.st === 'shrink') {
      const f = U.clamp(1 - s.t / s.shrink, 0, 1);
      s.cx = U.lerp(s.fx, s.tx, f); s.cz = U.lerp(s.fz, s.tz, f); s.r = U.lerp(s.fr, s.tr, f);
      if (s.t <= 0) {
        s.cx = s.tx; s.cz = s.tz; s.r = s.tr;
        if (G.mode === 'br' && s.i + 1 < STORM_PHASES.length) this.startStormPhase(s.i + 1);
        else s.st = 'done';
      }
    }
    this.stormDamage(dt);
  }
  stormDamage(dt) {
    const G = this.G, s = G.storm;
    if (!s || s.st === 'pre') return;
    this.stormAcc += dt;
    if (this.stormAcc < 1) return;
    this.stormAcc -= 1;
    if (G.duel && G.duel.state !== 'fight') return;
    for (const p of G.players.values()) {
      if (!p.alive || p.state === 'bus') continue;
      if (Math.hypot(p.x - s.cx, p.z - s.cz) > s.r) this.damagePlayer(p, s.dps, null, { storm: true });
    }
  }

  // ---------- damage ----------
  damagePlayer(v, amt, att, o = {}) {
    const G = this.G;
    if (!v.alive || !(amt > 0)) return;
    if (G.duel && G.duel.state !== 'fight') return;
    if (v.state === 'bus') return;
    amt = Math.round(amt);
    let toSh = 0, toHp = amt;
    if (!o.storm && !o.fall) { toSh = Math.min(v.sh, amt); toHp = amt - toSh; }
    v.sh -= toSh; v.hp -= toHp;
    v.lastHurt = G.time;
    if (att) { v.lastAttacker = att.id; v.lastAttackT = G.time; att.dmgDealt += amt; }
    if (att && att !== v) this.out.push({ t: 'hit', to: att.id, dmg: amt, head: !!o.head, sh: toSh > 0 && toHp === 0, p: [U.r1(v.x), U.r1(v.y + (o.head ? 1.75 : 1.2)), U.r1(v.z)], v: v.id });
    this.out.push({ t: 'dmg', to: v.id, amt, from: att ? [U.r1(att.x), U.r1(att.z)] : null, storm: !!o.storm });
    G.fx({ t: 'hit', to: att ? att.id : -1, dmg: amt, head: !!o.head, sh: toSh > 0 && toHp === 0, p: [v.x, v.y + (o.head ? 1.75 : 1.2), v.z], v: v.id, local: true });
    G.fx({ t: 'dmg', to: v.id, amt, from: att ? [att.x, att.z] : null, storm: !!o.storm, local: true });
    if (v.bot) Bots.onHurt(this, v, att);
    if (v.hp <= 0) {
      v.hp = 0;
      if (!att && v.lastAttacker && G.time - v.lastAttackT < 8) att = G.players.get(v.lastAttacker);
      this.eliminate(v, att, o);
    }
  }
  eliminate(v, att, o = {}) {
    const G = this.G;
    if (!v.alive) return;
    const place = G.aliveCount();
    v.alive = false; v.state = 'dead';
    if (att && att !== v) att.kills++;
    this.emit({ t: 'elim', id: v.id, place });
    this.emit({ t: 'kill', k: att && att !== v ? att.id : -1, v: v.id, w: o.w || (o.storm ? 'storm' : o.fall ? 'fall' : o.explode ? 'boom' : ''), head: !!o.head, kills: att ? att.kills : 0 });
    if (G.mode === 'br') {
      this.dropInventory(v);
      const alive = G.alivePlayers();
      if (alive.length <= 1) this.endMatch(alive[0] || att || v);
    } else {
      const alive = G.alivePlayers();
      const winner = alive[0];
      if (winner) {
        G.duel.scores[winner.id] = (G.duel.scores[winner.id] || 0) + 1;
        const done = G.duel.scores[winner.id] >= G.duel.to;
        this.emit({ t: 'duel', d: { state: done ? 'over' : 'roundEnd', t: 3.5, scores: { ...G.duel.scores }, last: winner.id } });
        if (done) this.endMatch(winner);
      } else {
        this.emit({ t: 'duel', d: { state: 'roundEnd', t: 3.5, scores: { ...G.duel.scores }, last: -1 } });
      }
    }
  }
  endMatch(winner) {
    if (this.ended) return;
    this.ended = true;
    const G = this.G;
    if (winner) winner.place = 1;
    const standings = [...G.players.values()].map(p => ({ id: p.id, name: p.name, place: p.alive ? 1 : p.place, kills: p.kills, dmg: p.dmgDealt, human: p.human }));
    standings.sort((a, b) => a.place - b.place);
    this.emit({ t: 'end', winner: winner ? winner.id : -1, standings, scores: G.duel ? { ...G.duel.scores } : null });
    this.emit({ t: 'phase', phase: 'end' });
  }
  dropLoot(it, x, y, z) {
    const G = this.G;
    const sup = Phys.supportBelow(G, x, y + 1.2, z, 60);
    const l = { id: this.lootId++, x: U.r2(x), y: U.r2(sup ? sup.y : G.T.h(x, z)), z: U.r2(z), it };
    this.emit({ t: 'lAdd', l });
    return l;
  }
  dropInventory(v) {
    const list = [];
    for (const it of v.inv.s) if (it) list.push(it);
    for (const a in v.inv.ammo) if (v.inv.ammo[a] > 0) list.push({ a, n: v.inv.ammo[a] });
    v.inv.mats.forEach((n, m) => { if (n > 0) list.push({ m, n: Math.min(n, MAX_MATS) }); });
    list.forEach((it, i) => {
      const a = i / list.length * Math.PI * 2, r = 1.2 + (i % 3) * 0.5;
      this.dropLoot(it, v.x + Math.cos(a) * r, v.y, v.z + Math.sin(a) * r);
    });
    v.inv = Inv.make();
  }
  damagePiece(p, dmg, att) {
    if (!p || dmg <= 0) return;
    p.hp -= dmg;
    if (p.hp <= 0) this.destroyPiece(p, 'destroy');
    else this.dirtyHp.set(p.k, true);
  }
  destroyPiece(p, why) {
    const G = this.G;
    if (!G.structs.map.has(p.k)) return;
    const neigh = G.structs.neighbors(p);
    this.dirtyHp.delete(p.k);
    this.emit({ t: 'sRem', k: p.k, why, mat: p.mat, type: p.type });
    const doomed = G.structs.unsupportedAfter(neigh);
    for (const q of doomed) {
      if (!G.structs.map.has(q.k)) continue;
      this.dirtyHp.delete(q.k);
      this.emit({ t: 'sRem', k: q.k, why: 'collapse', mat: q.mat, type: q.type });
    }
  }
  damageProp(pr, dmg) {
    if (!pr.alive) return;
    pr.hp -= dmg;
    if (pr.hp <= 0) this.emit({ t: 'pRem', id: pr.id });
    else this.out.push({ t: 'pHp', id: pr.id, hp: Math.round(pr.hp) });
  }
  explode(x, y, z, radius, dmg, struct, owner, w) {
    const G = this.G;
    this.emit({ t: 'boom', p: [U.r1(x), U.r1(y), U.r1(z)], r: radius });
    const att = G.players.get(owner);
    for (const v of G.players.values()) {
      if (!v.alive || v.state === 'bus') continue;
      const d = Math.hypot(v.x - x, v.y + 1 - y, v.z - z);
      if (d > radius) continue;
      const o = { x, y, z };
      const dir = { x: v.x - x, y: v.y + 1 - y, z: v.z - z };
      const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dir.x /= l; dir.y /= l; dir.z /= l;
      const block = G.structs.raycast(o, dir, Math.max(0, l - 0.4));
      if (block && block.t > 0.35) continue;
      this.damagePlayer(v, dmg * (1 - 0.5 * d / radius), att, { explode: true, w });
    }
    G.structs.forRect(x - radius, z - radius, x + radius, z + radius, p => {
      const b = p.box;
      const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d < radius + 1.5) this._boomQ = (this._boomQ || []).concat([[p, struct * (d < radius ? 1 : 0.5)]]);
    });
    for (const [p, dm] of this._boomQ || []) this.damagePiece(p, dm, att);
    this._boomQ = null;
    G.props.forRect(x - radius, z - radius, x + radius, z + radius, pr => {
      if (Math.hypot(pr.x - x, pr.z - z) < radius + 1) this.damageProp(pr, struct * 0.6);
    });
  }

  // ---------- projectiles ----------
  spawnProj(owner, kind, o, v, extra) {
    const id = this.projId++;
    const ev = { t: 'prSpawn', id, kind, owner, o: o.map(U.r2), v: v.map(U.r2), ...extra };
    this.emit(ev);
    const pr = this.G.proj.get(id);
    Object.assign(pr, extra, { owner, kind });
    return pr;
  }
  tickProjectiles(dt) {
    const G = this.G;
    const players = G.alivePlayers();
    for (const pr of [...G.proj.values()]) {
      pr.age += dt;
      pr.vy -= (pr.grav || 0) * dt;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz);
      const owner = G.players.get(pr.owner);
      const fuseOut = pr.fuse && pr.age >= pr.fuse;
      let hit = null, d = { x: 0, y: -1, z: 0 };
      if (sp > 1e-4 && !pr.rest) {
        d = { x: pr.vx / sp, y: pr.vy / sp, z: pr.vz / sp };
        hit = Phys.ray(G, { x: pr.x, y: pr.y, z: pr.z }, d, sp * dt, { players, ignore: pr.age < 0.2 ? owner : null });
      }
      if (hit && !(hit.kind === 'player' && hit.player === owner && pr.age < 0.2)) {
        if (pr.kind === 'bullet') {
          if (hit.kind === 'player') {
            const st = weaponStats(pr.w, pr.r);
            this.damagePlayer(hit.player, st.dmg * (hit.head ? st.head : 1), owner, { head: hit.head, w: pr.w });
          } else if (hit.kind === 'piece') this.damagePiece(hit.piece, pr.struct, owner);
          else if (hit.kind === 'prop') this.damageProp(hit.prop, pr.struct * 0.5);
          this.emit({ t: 'prEnd', id: pr.id, p: [U.r2(hit.p.x), U.r2(hit.p.y), U.r2(hit.p.z)], kind: pr.kind, hk: hit.kind });
          continue;
        }
        if (pr.bounce && hit.kind !== 'player') {
          const n = hit.n;
          const dot = pr.vx * n.x + pr.vy * n.y + pr.vz * n.z;
          pr.vx = (pr.vx - 2 * dot * n.x) * 0.45; pr.vy = (pr.vy - 2 * dot * n.y) * 0.45; pr.vz = (pr.vz - 2 * dot * n.z) * 0.45;
          pr.x = hit.p.x + n.x * 0.08; pr.y = hit.p.y + n.y * 0.08; pr.z = hit.p.z + n.z * 0.08;
          if (Math.hypot(pr.vx, pr.vy, pr.vz) < 1.2) { pr.vx = pr.vy = pr.vz = 0; pr.grav = 0; pr.rest = true; }
          this.emit({ t: 'prUpd', id: pr.id, o: [U.r2(pr.x), U.r2(pr.y), U.r2(pr.z)], v: [U.r2(pr.vx), U.r2(pr.vy), U.r2(pr.vz)], g: pr.grav });
          if (!fuseOut) continue;
        } else {
          this.emit({ t: 'prEnd', id: pr.id, p: [U.r2(hit.p.x), U.r2(hit.p.y), U.r2(hit.p.z)], kind: pr.kind });
          this.explode(hit.p.x - d.x * 0.3, hit.p.y - d.y * 0.3, hit.p.z - d.z * 0.3, pr.radius, pr.dmg, pr.struct, pr.owner, pr.w);
          continue;
        }
      }
      if (!pr.rest) { pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; }
      if (fuseOut || pr.age > (pr.life || 4)) {
        this.emit({ t: 'prEnd', id: pr.id, p: [U.r2(pr.x), U.r2(pr.y), U.r2(pr.z)], kind: pr.kind });
        if (pr.radius) this.explode(pr.x, pr.y, pr.z, pr.radius, pr.dmg, pr.struct, pr.owner, pr.w);
      }
    }
  }

  // ---------- client state & actions ----------
  handleState(pid, s) {
    const p = this.G.players.get(pid);
    if (!p || !p.alive || p.bot) return;
    if (s.tp !== p.tp) return;
    const st = ST_NAME[s.st];
    if (p.state === 'bus' || st === 'bus' || st === 'dead') return;
    const D = this.G.duel;
    if (D && D.state === 'countdown') { p.yaw = s.yaw; p.pitch = s.pitch; return; }
    p.x = s.x; p.y = s.y; p.z = s.z; p.vx = s.vx; p.vy = s.vy; p.vz = s.vz;
    p.yaw = s.yaw; p.pitch = s.pitch; p.state = st; p.flags = s.f; p.onGround = !!s.g;
    if (s.sl >= 0 && s.sl <= 5) p.slot = s.sl;
    p.crouch = !!(s.f & FL.CROUCH);
  }

  handleAction(pid, a) {
    const G = this.G;
    const p = G.players.get(pid);
    if (!p) return;
    if (a.seq !== undefined) p.ack = a.seq;
    if (a.a === 'jump') { this.jumpBus(p); return; }
    if (!p.alive) return;
    const D = G.duel;
    const locked = D && D.state !== 'fight';
    switch (a.a) {
      case 'fire': if (!locked) this.actFire(p, a); break;
      case 'melee': if (!locked) this.actMelee(p, a); break;
      case 'build': if (!locked) this.actBuild(p, a); break;
      case 'edit': if (!locked) this.actEdit(p, a); break;
      case 'reload': if (Inv.reload(p, a.s, !!a.one)) p.invDirty = true; break;
      case 'pickup': this.actPickup(p, a); break;
      case 'open': this.actOpen(p, a); break;
      case 'use': this.actUse(p, a); break;
      case 'throw': if (!locked) this.actThrow(p, a); break;
      case 'pad': if (!locked) this.actPad(p, a); break;
      case 'drop': this.actDrop(p, a); break;
      case 'fall': this.damagePlayer(p, Math.min(150, a.dmg | 0), null, { fall: true }); break;
      case 'emote': this.emit({ t: 'emote', id: p.id }); break;
    }
    if (a.seq !== undefined) p.invDirty = true;
  }

  eye(p) { return { x: p.x, y: p.y + (p.crouch ? 1.2 : PH.EYE), z: p.z }; }
  safeOrigin(p, o) {
    const e = this.eye(p);
    if (!o || Math.hypot(o[0] - e.x, o[1] - e.y, o[2] - e.z) > 3.5) return e;
    return { x: o[0], y: o[1], z: o[2] };
  }

  actFire(p, a) {
    const G = this.G;
    if (p.state !== 'ground') return;
    const it = p.inv.s[a.s - 1];
    if (!isWeapon(it)) return;
    const st = weaponStats(it.w, it.r);
    const gap = st.burst ? st.burstGap : 1 / st.rate;
    if (G.time - (p.lastFire || -9) < gap * 0.6) return;
    if (!Inv.consumeShot(p, a.s)) return;
    p.lastFire = G.time;
    p.invDirty = true;
    const o = this.safeOrigin(p, a.o);
    const dirs = (a.d || []).slice(0, st.pellets || 1);
    if (!dirs.length) return;
    if (st.proj) {
      const d = norm(dirs[0]);
      const pj = st.proj;
      if (st.cls === 'sniper') {
        this.spawnProj(p.id, 'bullet', [o.x, o.y, o.z], [d.x * pj.speed, d.y * pj.speed, d.z * pj.speed], { w: it.w, r: it.r, grav: pj.grav, struct: st.struct || st.dmg, life: 3 });
      } else {
        this.spawnProj(p.id, st.id === 'gl' ? 'gl' : 'rocket', [o.x + d.x * 0.8, o.y + d.y * 0.8, o.z + d.z * 0.8], [d.x * pj.speed, d.y * pj.speed, d.z * pj.speed], { w: it.w, r: it.r, grav: pj.grav, radius: pj.radius, dmg: st.dmg, struct: pj.struct, bounce: !!pj.bounce, fuse: pj.fuse || 0, life: pj.life || 6 });
      }
      this.emit({ t: 'shot', pid: p.id, w: it.w, o: [U.r2(o.x), U.r2(o.y), U.r2(o.z)], e: [] });
      return;
    }
    const players = G.alivePlayers();
    const hits = new Map();
    const ends = [];
    for (const dd of dirs) {
      const d = norm(dd);
      const h = Phys.ray(G, o, d, st.range, { players, ignore: p });
      if (!h) { ends.push([U.r1(o.x + d.x * st.range), U.r1(o.y + d.y * st.range), U.r1(o.z + d.z * st.range)]); continue; }
      ends.push([U.r2(h.p.x), U.r2(h.p.y), U.r2(h.p.z), h.kind === 'player' ? 1 : h.kind === 'terrain' ? 2 : 3]);
      const fo = falloff(st, h.t);
      if (h.kind === 'player') {
        const cur = hits.get(h.player) || { dmg: 0, head: false };
        cur.dmg += st.dmg * fo * (h.head ? st.head : 1);
        cur.head = cur.head || h.head;
        hits.set(h.player, cur);
      } else if (h.kind === 'piece') this.damagePiece(h.piece, (st.struct || st.dmg), p);
      else if (h.kind === 'prop') this.damageProp(h.prop, (st.struct || st.dmg) * 0.5);
    }
    this.emit({ t: 'shot', pid: p.id, w: it.w, o: [U.r2(o.x), U.r2(o.y), U.r2(o.z)], e: ends });
    for (const [v, h] of hits) this.damagePlayer(v, h.dmg, p, { head: h.head, w: it.w });
  }

  actMelee(p, a) {
    const G = this.G;
    if (G.time - (p.lastMelee || -9) < (1 / PICKAXE.rate) * 0.6) return;
    p.lastMelee = G.time;
    const o = this.safeOrigin(p, a.o);
    const d = norm(a.d);
    const h = Phys.ray(G, o, d, PICKAXE.range + 0.6, { players: G.alivePlayers(), ignore: p });
    if (!h) return;
    const crit = !!a.crit;
    if (h.kind === 'player') { this.damagePlayer(h.player, PICKAXE.dmg, p, { w: 'pick' }); }
    else if (h.kind === 'piece') {
      const pc = h.piece;
      this.damagePiece(pc, crit ? PICKAXE.struct * 2 : PICKAXE.struct, p);
      if (pc.world) this.giveMats(p, pc.mat, crit ? 10 : 5);
    } else if (h.kind === 'prop') {
      const pr = h.prop;
      const def = PROP_DEFS[pr.t];
      this.damageProp(pr, crit ? PICKAXE.struct * 2 : PICKAXE.struct);
      this.giveMats(p, def.mat, Math.round(def.yield * (crit ? 1.5 : 1)));
    }
    this.emit({ t: 'melee', pid: p.id, p: [U.r2(h.p.x), U.r2(h.p.y), U.r2(h.p.z)], n: [U.r2(h.n.x), U.r2(h.n.y), U.r2(h.n.z)], k: h.kind, crit, mat: h.piece ? h.piece.mat : h.prop ? PROP_DEFS[h.prop.t].mat : -1 });
  }
  giveMats(p, m, n) {
    const before = p.inv.mats[m];
    p.inv.mats[m] = Math.min(MAX_MATS, before + n);
    if (p.inv.mats[m] !== before) { p.invDirty = true; this.out.push({ t: 'mats', to: p.id, m, n: p.inv.mats[m] - before }); this.G.fx({ t: 'mats', to: p.id, m, n: p.inv.mats[m] - before, local: true }); }
  }

  actBuild(p, a) {
    const G = this.G;
    if (p.state !== 'ground') return;
    const m = a.m | 0;
    const desc = { type: a.t, gx: a.gx | 0, gy: a.gy | 0, gz: a.gz | 0, axis: a.ax, dir: a.dir | 0, mat: m };
    const key = Build.keyOf(desc);
    const reject = () => this.out.push({ t: 'sRej', k: key, to: p.id });
    if (!['wall', 'floor', 'ramp', 'cone'].includes(desc.type) || m < 0 || m > 2) return reject();
    if (desc.type !== 'wall') delete desc.axis;
    if (desc.type !== 'ramp') delete desc.dir;
    if (p.inv.mats[m] < BUILD_COST) return reject();
    const b = Build.aabb(desc);
    const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    if (Math.hypot(cx - p.x, cy - p.y - 1, cz - p.z) > 13) return reject();
    if (G.structs.check(desc)) return reject();
    p.inv.mats[m] -= BUILD_COST;
    p.invDirty = true;
    const max = MATS[m].hp;
    const start = Math.round(max * 0.3);
    this.emit({ t: 'sAdd', p: { ...desc, owner: p.id, hp: start, max, grow: max - start, growRate: (max - start) / MATS[m].time, mask: 0 } });
  }
  actEdit(p, a) {
    const G = this.G;
    const pc = G.structs.get(a.k);
    if (!pc) return;
    if (!pc.world && pc.owner !== p.id) return;
    const b = pc.box;
    if (Math.hypot((b[0] + b[3]) / 2 - p.x, (b[1] + b[4]) / 2 - p.y - 1, (b[2] + b[5]) / 2 - p.z) > 11) return;
    const mask = a.mask | 0;
    if (pc.type !== 'ramp' && !Build.validMask(pc.type, mask)) return;
    const ev = { t: 'sEdit', k: pc.k, mask: pc.type === 'ramp' ? 0 : mask };
    if (pc.type === 'ramp' && a.dir !== undefined) ev.dir = a.dir & 3;
    this.emit(ev);
  }

  actPickup(p, a) {
    const G = this.G;
    const l = G.loot.get(a.id);
    if (!l) return;
    if (Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z) > 4) return;
    const it = l.it;
    if (it.a) {
      const room = MAX_AMMO - p.inv.ammo[it.a];
      if (room <= 0) return;
      const take = Math.min(room, it.n);
      p.inv.ammo[it.a] += take;
      this.emit({ t: 'lRem', id: l.id, by: p.id });
      if (take < it.n) this.dropLoot({ a: it.a, n: it.n - take }, l.x, l.y, l.z);
      p.invDirty = true;
      return;
    }
    if (it.m !== undefined) {
      const room = MAX_MATS - p.inv.mats[it.m];
      if (room <= 0) return;
      const take = Math.min(room, it.n);
      p.inv.mats[it.m] += take;
      this.emit({ t: 'lRem', id: l.id, by: p.id });
      if (take < it.n) this.dropLoot({ m: it.m, n: it.n - take }, l.x, l.y, l.z);
      p.invDirty = true;
      return;
    }
    const s = p.inv.s;
    if (isItem(it)) {
      let left = it.n;
      const stack = ITEMS[it.c].stack;
      for (let i = 0; i < 5 && left > 0; i++) {
        if (s[i] && s[i].c === it.c && s[i].n < stack) { const t = Math.min(stack - s[i].n, left); s[i].n += t; left -= t; }
      }
      if (left > 0) {
        const e = s.indexOf(null);
        if (e >= 0) { s[e] = { c: it.c, n: left }; left = 0; }
      }
      if (left > 0 && left === it.n) {
        if (!this.swapOut(p, l)) return;
        s[p.slot - 1] = { c: it.c, n: left }; left = 0;
      }
      this.emit({ t: 'lRem', id: l.id, by: p.id });
      if (left > 0) this.dropLoot({ c: it.c, n: left }, l.x, l.y, l.z);
      p.invDirty = true;
      return;
    }
    if (isWeapon(it)) {
      let e = s.indexOf(null);
      if (e < 0) {
        if (!this.swapOut(p, l)) return;
        e = p.slot - 1;
      }
      s[e] = { w: it.w, r: it.r, mag: it.mag };
      this.emit({ t: 'lRem', id: l.id, by: p.id });
      p.invDirty = true;
    }
  }
  swapOut(p, l) {
    if (p.slot < 1) { this.out.push({ t: 'msg', to: p.id, text: 'Inventory full — select a slot to swap', kind: 'warn' }); this.G.fx({ t: 'msg', to: p.id, text: 'Inventory full — select a slot to swap', kind: 'warn', local: true }); return false; }
    const cur = p.inv.s[p.slot - 1];
    if (cur) this.dropLoot(cur, p.x + U.fwdX(p.yaw) * 0.8, p.y, p.z + U.fwdZ(p.yaw) * 0.8);
    p.inv.s[p.slot - 1] = null;
    return true;
  }
  actOpen(p, a) {
    const G = this.G;
    const map = a.kind === 'abox' ? G.aboxes : G.chests;
    const c = map.get(a.id);
    if (!c || c.open) return;
    if (Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) > 4) return;
    this.emit({ t: a.kind === 'abox' ? 'abox' : 'chest', id: c.id, vault: !!c.vault });
    const list = a.kind === 'abox' ? World.rollAmmoBox(this.R) : World.rollChest(this.R, c.vault);
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    list.forEach((it, i) => {
      const spread = (i - (list.length - 1) / 2) * 0.9;
      this.dropLoot(it, c.x + fx * 1.3 + fz * spread, c.y + 0.3, c.z + fz * 1.3 - fx * spread);
    });
  }
  actUse(p, a) {
    const it = p.inv.s[a.s - 1];
    if (!isItem(it)) return;
    const d = ITEMS[it.c];
    if (d.throw || d.trap) return;
    if (!Inv.canUse(p, it)) return;
    Inv.takeOne(p, a.s);
    if (d.heal) p.hp = Math.min(d.max, p.hp + d.heal);
    if (d.shield) p.sh = Math.min(d.max, p.sh + d.shield);
    if (d.regen) p.regen = (p.regen || 0) + d.regen;
    if (d.full) { p.hp = 100; p.sh = 100; }
    p.invDirty = true;
    this.emit({ t: 'used', id: p.id, c: it.c });
  }
  actThrow(p, a) {
    const it = p.inv.s[a.s - 1];
    if (!isItem(it) || !ITEMS[it.c].throw) return;
    if (this.G.time - (p.lastThrow || -9) < 0.6) return;
    p.lastThrow = this.G.time;
    Inv.takeOne(p, a.s);
    p.invDirty = true;
    const o = this.safeOrigin(p, a.o);
    const d = ITEMS[it.c];
    const v = a.v.map(x => U.clamp(x, -40, 40));
    this.spawnProj(p.id, 'nade', [o.x, o.y, o.z], v, { radius: d.radius, dmg: d.dmg, struct: d.struct, bounce: true, fuse: d.fuse, grav: 22, life: d.fuse + 0.1 });
  }
  actPad(p, a) {
    const G = this.G;
    const it = p.inv.s[a.s - 1];
    if (!isItem(it) || !ITEMS[it.c].trap) return;
    const x = a.x, z = a.z;
    if (Math.hypot(x - p.x, z - p.z) > 6) return;
    const sup = Phys.supportBelow(G, x, a.y + 1.5, z, 5);
    if (!sup) return;
    if (G.pads.some(q => Math.abs(q.x - x) < 2.4 && Math.abs(q.z - z) < 2.4)) return;
    Inv.takeOne(p, a.s);
    p.invDirty = true;
    this.emit({ t: 'pad', pad: { id: this.padId++, x: U.r2(x), z: U.r2(z), box: [U.r2(x - 1.1), U.r2(sup.y), U.r2(z - 1.1), U.r2(x + 1.1), U.r2(sup.y + 0.22), U.r2(z + 1.1)] } });
  }
  actDrop(p, a) {
    const it = p.inv.s[a.s - 1];
    if (!it) return;
    p.inv.s[a.s - 1] = null;
    p.invDirty = true;
    this.dropLoot(it, p.x + U.fwdX(p.yaw) * 1.2, p.y, p.z + U.fwdZ(p.yaw) * 1.2);
  }

  // ---------- network snapshot ----------
  snapshot() {
    const G = this.G;
    const pl = [];
    for (const p of G.players.values()) {
      const fl = (p.flags | 0) & ~FL.AIR | (p.onGround ? 0 : FL.AIR);
      pl.push([p.id, U.r2(p.x), U.r2(p.y), U.r2(p.z), U.r2(p.yaw), U.r2(p.pitch), ST_CODE[p.state] || 0, Math.round(p.hp), Math.round(p.sh), fl, heldCode(p), p.alive ? 1 : 0, p.tp, p.kills, p.slot]);
    }
    const s = G.storm;
    const storm = s ? [U.r1(s.cx), U.r1(s.cz), U.r1(s.r), U.r1(s.tx), U.r1(s.tz), U.r1(s.tr), s.i, s.st, U.r1(s.t), s.dps, s.shrink || 0] : null;
    const D = G.duel;
    return { t: 'snap', time: U.r2(G.time), pl, storm, duel: D ? { state: D.state, t: U.r1(D.t) } : null };
  }
}

function heldCode(p) {
  if (p.slot === 0) return 'pick';
  const it = p.inv.s[p.slot - 1];
  if (!it) return '';
  if (isWeapon(it)) return 'w:' + it.w + ':' + it.r;
  return 'c:' + it.c;
}
function norm(d) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { x: d[0] / l, y: d[1] / l, z: d[2] / l };
}
function falloff(st, dist) {
  if (!st.falloff) return 1;
  const f = st.falloff;
  if (dist <= f[0][0]) return f[0][1];
  for (let i = 1; i < f.length; i++) {
    if (dist <= f[i][0]) {
      const t = (dist - f[i - 1][0]) / (f[i][0] - f[i - 1][0]);
      return U.lerp(f[i - 1][1], f[i][1], t);
    }
  }
  return f[f.length - 1][1];
}
