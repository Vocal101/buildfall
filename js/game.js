'use strict';
// Shared match state (identical on host and clients) and inventory helpers.

const Inv = {
  make() { return { s: [null, null, null, null, null], ammo: { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 }, mats: [0, 0, 0] }; },
  clone(inv) { return JSON.parse(JSON.stringify(inv)); },
  held(p) { return p.slot > 0 ? p.inv.s[p.slot - 1] : null; },
  // shared state changes, applied by the host and predicted by clients
  consumeShot(p, slot) {
    const it = p.inv.s[slot - 1];
    if (!isWeapon(it)) return false;
    const st = WEAPONS[it.w];
    if (st.mag === 0) { if (p.inv.ammo[st.ammo] <= 0) return false; p.inv.ammo[st.ammo]--; return true; }
    if (it.mag <= 0) return false;
    it.mag--;
    return true;
  },
  reload(p, slot, one) {
    const it = p.inv.s[slot - 1];
    if (!isWeapon(it)) return 0;
    const st = WEAPONS[it.w];
    if (st.mag === 0) return 0;
    const need = one ? Math.min(1, st.mag - it.mag) : st.mag - it.mag;
    const take = Math.min(need, p.inv.ammo[st.ammo]);
    if (take <= 0) return 0;
    it.mag += take;
    p.inv.ammo[st.ammo] -= take;
    return take;
  },
  canUse(p, it) {
    if (!isItem(it)) return false;
    const d = ITEMS[it.c];
    if (d.throw || d.trap) return true;
    if (d.heal) return p.hp < d.max;
    if (d.shield) return p.sh < d.max;
    if (d.regen) return p.hp < 100 || p.sh < 100;
    if (d.full) return p.hp < 100 || p.sh < 100;
    return false;
  },
  takeOne(p, slot) {
    const it = p.inv.s[slot - 1];
    if (!isItem(it) || it.n <= 0) return null;
    it.n--;
    const c = it.c;
    if (it.n <= 0) p.inv.s[slot - 1] = null;
    return c;
  },
};

class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.W = cfg.mode === 'duel' ? World.genDuel(cfg.seed) : World.genBR(cfg.seed);
    this.T = this.W.T;
    this.structs = new Build.Structs(this.T);
    for (const wp of this.W.pieces) {
      const p = { ...wp };
      p.max = MATS[p.mat].hp; p.hp = p.max; p.grow = 0;
      this.structs.add(p);
    }
    this.props = new PropIndex(this.W.props);
    this.loot = new Map();
    for (const l of this.W.loot) this.loot.set(l.id, { ...l, it: { ...l.it } });
    this.chests = new Map(this.W.chests.map(c => [c.id, { ...c }]));
    this.aboxes = new Map(this.W.ammoBoxes.map(c => [c.id, { ...c }]));
    this.players = new Map();
    this.pads = [];
    this.proj = new Map();
    this.time = 0;
    this.phase = cfg.mode === 'duel' ? 'countdown' : 'bus';
    this.storm = null;
    this.duel = cfg.mode === 'duel' ? { scores: {}, round: 1, state: 'countdown', t: 3, to: cfg.rounds || 5 } : null;
    this.listeners = [];
    for (const pd of cfg.players) this.addPlayer(pd);
  }
  addPlayer(pd) {
    const p = {
      id: pd.id, name: pd.name, skin: pd.skin || 0, human: !!pd.human, diff: pd.diff !== undefined ? pd.diff : 1,
      x: 0, y: 150, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
      state: this.mode === 'duel' ? 'ground' : 'bus', onGround: false,
      hp: 100, sh: 0, alive: true, kills: 0, slot: 0, inv: Inv.make(), tp: 0, place: 0,
      flags: 0, held: '', rx: 0, ry: 150, rz: 0, ryaw: 0, dmgDealt: 0,
    };
    this.players.set(p.id, p);
    return p;
  }
  on(fn) { this.listeners.push(fn); }
  fx(ev) { for (const f of this.listeners) f(ev, this); }
  alivePlayers() { const a = []; for (const p of this.players.values()) if (p.alive) a.push(p); return a; }
  aliveCount() { let n = 0; for (const p of this.players.values()) if (p.alive) n++; return n; }
  busPos(t) {
    const b = this.W.bus;
    if (!b) return null;
    const f = U.clamp((t * b.speed) / b.len, 0, 1);
    return { x: U.lerp(b.ax, b.bx, f), y: b.y, z: U.lerp(b.az, b.bz, f), f, yaw: U.yawTo(b.bx - b.ax, b.bz - b.az) };
  }
  // client-side growth of pieces being built (also run on host)
  update(dt) {
    for (const p of this.growing || []) {
      if (!this.structs.map.has(p.k)) continue;
      if (p.grow > 0) {
        const add = Math.min(p.grow, p.growRate * dt);
        p.hp += add; p.grow -= add;
      }
    }
    if (this.growing) this.growing = this.growing.filter(p => p.grow > 0 && this.structs.map.has(p.k));
  }
  apply(ev) {
    switch (ev.t) {
      case 'sAdd': {
        const p = { ...ev.p };
        if (this.structs.map.has(Build.keyOf(p))) {
          // a predicted piece already sits in this slot: adopt the authoritative data
          const q = this.structs.get(Build.keyOf(p));
          Object.assign(q, { owner: p.owner, mat: p.mat, hp: p.hp, max: p.max, grow: p.grow, growRate: p.growRate, pending: false, dir: p.dir !== undefined ? p.dir : q.dir });
          this.structs.refresh(q);
          if (q.grow > 0) (this.growing || (this.growing = [])).push(q);
          this.fx({ t: 'sAdopt', p: q });
          return;
        }
        this.structs.add(p);
        p.born = this.time;
        if (p.grow > 0) (this.growing || (this.growing = [])).push(p);
        break;
      }
      case 'sRem': this.structs.remove(ev.k); break;
      case 'sHp': { const p = this.structs.get(ev.k); if (p) { p.hp = ev.hp; if (ev.g !== undefined) p.grow = ev.g; } break; }
      case 'sEdit': {
        const p = this.structs.get(ev.k);
        if (p) { p.mask = ev.mask; if (ev.dir !== undefined) p.dir = ev.dir; this.structs.refresh(p); }
        break;
      }
      case 'sClear': for (const k of ev.ks) this.structs.remove(k); break;
      case 'pHp': { const p = this.props.byId.get(ev.id); if (p) p.hp = ev.hp; break; }
      case 'pRem': { const p = this.props.byId.get(ev.id); if (p) p.alive = false; break; }
      case 'lAdd': this.loot.set(ev.l.id, ev.l); break;
      case 'lRem': this.loot.delete(ev.id); break;
      case 'lClear': this.loot.clear(); break;
      case 'chest': { const c = this.chests.get(ev.id); if (c) c.open = true; break; }
      case 'abox': { const c = this.aboxes.get(ev.id); if (c) c.open = true; break; }
      case 'pad': this.pads.push(ev.pad); break;
      case 'padClear': this.pads = []; break;
      case 'prSpawn': this.proj.set(ev.id, { ...ev, x: ev.o[0], y: ev.o[1], z: ev.o[2], vx: ev.v[0], vy: ev.v[1], vz: ev.v[2], age: 0 }); break;
      case 'prEnd': this.proj.delete(ev.id); break;
      case 'prUpd': {
        const pr = this.proj.get(ev.id);
        if (pr && !this.host) { pr.x = ev.o[0]; pr.y = ev.o[1]; pr.z = ev.o[2]; pr.vx = ev.v[0]; pr.vy = ev.v[1]; pr.vz = ev.v[2]; pr.grav = ev.g; }
        break;
      }
      case 'elim': { const p = this.players.get(ev.id); if (p) { p.alive = false; p.state = 'dead'; p.place = ev.place; } break; }
      case 'kill': { const k = this.players.get(ev.k); if (k) k.kills = ev.kills; break; }
      case 'phase': this.phase = ev.phase; break;
      case 'duel': this.duel = { ...this.duel, ...ev.d }; break;
      case 'revive': { const p = this.players.get(ev.id); if (p) { p.alive = true; p.state = 'ground'; } break; }
    }
    this.fx(ev);
  }
}
