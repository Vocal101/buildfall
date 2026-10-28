'use strict';
// Game loop, local player controller, camera, and the glue between sim, network, render and HUD.

const SETTINGS = (() => {
  const s = U.load('buildfall_settings_v1', {});
  const out = { ...DEFAULT_SETTINGS, ...s };
  out.br = { ...DEFAULT_SETTINGS.br, ...(s.br || {}) };
  out.duel = { ...DEFAULT_SETTINGS.duel, ...(s.duel || {}) };
  out.binds = { ...(s.binds || {}) };
  if (!out.name) out.name = 'Player' + Math.floor(100 + Math.random() * 900);
  return out;
})();
window.SETTINGS = SETTINGS;
function saveSettings() { U.store('buildfall_settings_v1', SETTINGS); }
const STATS = U.load('buildfall_stats_v1', { matches: 0, wins: 0, kills: 0, duels: 0, duelWins: 0, best: 0, builds: 0 });
function saveStats() { U.store('buildfall_stats_v1', STATS); }

const Main = (() => {
  const STEP = 1 / 60;
  let G = null, host = null, me = null, online = false;
  let state = 'menu';
  let acc = 0, last = performance.now(), fpsT = 0, fpsN = 0;
  let seq = 0, netT = 0, snapT = 0, stT = 0;
  let paused = false;
  let menuGame = null, menuAvatar = null, menuT = 0;
  let prev = { x: 0, y: 0, z: 0 };
  let camY = null, shake = 0;
  const pending = new Map();

  const ctl = {
    mode: 'combat', piece: 'wall', mat: 0, rot: 0, yaw: 0, pitch: 0,
    ads: false, scoped: false, spreadPx: 0, bloom: 0, recoil: 0,
    fireCd: 0, burstLeft: 0, burstT: 0, spin: 0, reloadT: 0, reloadMax: 1, reloadSlot: 0,
    useT: 0, useMax: 1, useName: '', useSlot: 0, meleeCd: 0, buildCd: 0,
    edit: null, prompt: null, aimPiece: null, mapOpen: false, emoteT: 0,
    spectating: false, specTarget: null, weak: null, stepT: 0, lastPlacedKey: '',
    viewPlayer() { return ctl.spectating && ctl.specTarget ? { x: ctl.specTarget.rx, z: ctl.specTarget.rz } : { x: me ? me.rx : 0, z: me ? me.rz : 0 }; },
  };

  // ---------- boot ----------
  function boot() {
    const canvas = document.getElementById('game');
    Input.init(canvas);
    Input.setBinds(SETTINGS.binds);
    Render.init(canvas);
    Render.setQuality(SETTINGS.quality, SETTINGS.shadows);
    Sfx.setVolume(SETTINGS.volume);
    Hud.init();
    canvas.addEventListener('click', () => { if (state === 'game' && !paused) Input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (state === 'game' && !document.pointerLockElement && !ctl.mapOpen && G && G.phase !== 'end') openPause();
    });
    document.addEventListener('keydown', e => {
      if (e.code === 'Escape' && state === 'game' && paused && !document.querySelector('.bind .key.listening')) { e.preventDefault(); resume(); }
    });
    loadMenuWorld();
    Menus.init();
    requestAnimationFrame(loop);
    if (location.search.includes('dev')) setupDev();
  }

  function loadMenuWorld() {
    menuGame = new Game({ mode: 'br', seed: 20261028, players: [] });
    Render.load(menuGame);
    window.LOCAL_ID = -1;
    placeMenuAvatar();
  }
  function menuSpot() {
    const W = menuGame.W, T = menuGame.T;
    const poi = W.pois[0];
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      const x = poi.x + Math.cos(a) * (poi.r + 16), z = poi.z + Math.sin(a) * (poi.r + 16);
      const h = T.h(x, z);
      if (h < 3) continue;
      let clutter = 0;
      for (const pr of W.props) if (Math.abs(pr.x - x) < 14 && Math.abs(pr.z - z) < 14) clutter++;
      const flat = Math.abs(T.h(x + 4, z) - T.h(x - 4, z)) + Math.abs(T.h(x, z + 4) - T.h(x, z - 4));
      const score = clutter * 2 + flat * 3;
      if (!best || score < best.score) best = { x, z, y: h, a, score };
    }
    return best || { x: poi.x, z: poi.z, y: T.h(poi.x, poi.z), a: 0 };
  }
  function placeMenuAvatar() {
    if (menuAvatar) Render.scene.remove(menuAvatar.root);
    menuAvatar = Models.avatar(SETTINGS.skin);
    const sp = menuSpot();
    menuAvatar.spot = sp;
    menuAvatar.root.position.set(sp.x, sp.y, sp.z);
    const gun = Models.gun('ar', 4);
    menuAvatar.gunMount.add(gun);
    menuAvatar.armR.rotation.set(-1.2, 0, 0.1); menuAvatar.armL.rotation.set(-1.15, 0.6, 0);
    menuAvatar.gunMount.position.set(0.12, 0.3, -0.32);
    gun.rotation.set(0.3, 0.55, 0.5);
    menuAvatar.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    Render.scene.add(menuAvatar.root);
  }

  // ---------- match start ----------
  function startOffline(kind) {
    Sfx.resume();
    const seed = (Math.random() * 1e9) | 0;
    const players = [{ id: 1, name: SETTINGS.name, skin: SETTINGS.skin, human: true }];
    if (kind === 'br') {
      const n = U.clamp(SETTINGS.br.bots | 0, 1, 59);
      for (let i = 0; i < n; i++) players.push(botDef(100 + i, i, SETTINGS.br.diff));
    } else players.push(botDef(100, 0, SETTINGS.duel.diff));
    begin({ mode: kind, seed, players, you: 1, rounds: SETTINGS.duel.rounds, mats: SETTINGS.duel.mats }, true, false);
  }
  function botDef(id, i, diff) {
    const names = BOT_NAMES.slice();
    const R = U.rng(id * 977 + (Date.now() & 0xffff));
    const nm = names[(i * 7 + Math.floor(R() * names.length)) % names.length] + (R() < 0.5 ? '' : Math.floor(R() * 99));
    let d = diff;
    if (diff === 1 && R() < 0.25) d = R() < 0.5 ? 0 : 2;
    return { id, name: nm, skin: Math.floor(R() * SKINS.length), human: false, diff: d };
  }
  function startOnline(cfg, isHost) {
    Sfx.resume();
    begin(cfg, isHost, true);
  }

  function begin(cfg, isHost, isOnline) {
    end(true);
    online = isOnline;
    G = new Game(cfg);
    window.LOCAL_ID = cfg.you;
    host = isHost ? new Host(G) : null;
    me = G.players.get(cfg.you);
    for (const p of G.players.values()) { p.rx = p.x; p.ry = p.y; p.rz = p.z; p.ryaw = p.yaw; }
    G.on(onEvent);
    Render.load(G);
    Hud.start(G, me);
    Object.assign(ctl, { mode: 'combat', piece: 'wall', mat: 0, rot: 0, edit: null, spectating: false, specTarget: null, reloadT: 0, useT: 0, ads: false, scoped: false, mapOpen: false, weak: null, bloom: 0 });
    ctl.yaw = me.yaw; ctl.pitch = G.mode === 'br' ? -0.3 : 0;
    me.slot = G.mode === 'duel' ? 1 : 0;
    prev = { x: me.x, y: me.y, z: me.z };
    camY = null;
    pending.clear();
    seq = 0;
    state = 'game';
    paused = false;
    Input.setEnabled(true);
    Menus.hideAll();
    document.getElementById('hud').classList.remove('hidden');
    Input.lock();
    if (online) wireNet();
    STATS.matches++; saveStats();
    if (G.mode === 'br') Hud.centerMsg('Board the Battle Blimp!', 'round', 3);
  }

  function wireNet() {
    Net.onMsg = (pid, d) => {
      if (!G) return;
      if (host) {
        if (d.t === 'st') host.handleState(pid, d.s);
        else if (d.t === 'act') host.handleAction(pid, d.a);
        else if (d.t === 'left') {
          const p = G.players.get(pid);
          if (p && p.alive) { host.msg(p.name + ' left the match'); host.eliminate(p, null, {}); }
          if (G.mode === 'duel' && G.phase !== 'end') host.endMatch(me);
        }
      } else {
        if (d.t === 'snap') applySnap(d);
        else if (d.t === 'ev') for (const ev of d.l) G.apply(ev);
        else if (d.t === 'inv') { if (d.ack >= seq) { me.inv = d.inv; } }
      }
    };
    Net.onClose = why => { if (state === 'game') { Hud.toast(why, 'warn'); setTimeout(() => leave(), 1500); } };
  }

  function applySnap(s) {
    if (Math.abs(G.time - s.time) > 0.3) G.time = s.time; else G.time += (s.time - G.time) * 0.2;
    for (const a of s.pl) {
      const p = G.players.get(a[0]);
      if (!p) continue;
      const st = ST_NAME[a[6]];
      if (p === me) {
        p.hp = a[7]; p.sh = a[8]; p.kills = a[13];
        if (!a[11] && p.alive) { p.alive = false; p.state = 'dead'; }
        if (a[12] !== p.tp || st === 'bus' || (st === 'dead')) {
          if (a[12] !== p.tp) { p.x = a[1]; p.y = a[2]; p.z = a[3]; p.vx = p.vy = p.vz = 0; p.rx = p.x; p.ry = p.y; p.rz = p.z; prev = { x: p.x, y: p.y, z: p.z }; ctl.yaw = a[4]; camY = null; if (st === 'ground') p.slot = a[14]; }
          p.state = st; p.tp = a[12];
          if (st === 'ground' && !p.alive && a[11]) p.alive = true;
        }
        if (a[11] && !p.alive) { p.alive = true; p.state = st; }
        continue;
      }
      p.x = a[1]; p.y = a[2]; p.z = a[3]; p.yaw = a[4]; p.pitch = a[5]; p.state = st;
      p.hp = a[7]; p.sh = a[8]; p.flags = a[9]; p.held = a[10]; p.alive = !!a[11]; p.tp = a[12]; p.kills = a[13]; p.slot = a[14];
      p.onGround = !(p.flags & FL.AIR);
    }
    if (s.storm) {
      const v = s.storm;
      G.storm = G.storm || {};
      Object.assign(G.storm, { cx: v[0], cz: v[1], r: v[2], tx: v[3], tz: v[4], tr: v[5], i: v[6], st: v[7], t: v[8], dps: v[9], shrink: v[10] });
    }
    if (s.duel && G.duel) { G.duel.state = s.duel.state; G.duel.t = s.duel.t; }
  }

  // ---------- actions ----------
  function act(a) {
    if (host) host.handleAction(me.id, a);
    else { a.seq = ++seq; Net.toHost({ t: 'act', a }); }
  }

  // ---------- events (cosmetic + HUD) ----------
  function onEvent(ev) {
    Render.onEvent(ev);
    Hud.onEvent(ev);
    const lid = me ? me.id : -1;
    switch (ev.t) {
      case 'shot': {
        if (ev.pid === lid) break;
        const p = G.players.get(ev.pid);
        if (!p) break;
        p.fireAnim = 1;
        const mz = muzzleOf(p);
        const st = WEAPONS[ev.w];
        Sfx.play('shot', mz, { s: st ? st.sound : 'rifle' });
        FX.muzzle(mz, 0.6);
        for (const e of ev.e) {
          FX.tracer(mz, { x: e[0], y: e[1], z: e[2] }, 0xfff0b8, 0.05, 0.09);
          if (e[3]) FX.impact({ x: e[0], y: e[1], z: e[2] }, { x: 0, y: 1, z: 0 }, e[3] === 1 ? 'player' : e[3] === 2 ? 'terrain' : 'piece');
          // near-miss whiz
          if (me && me.alive) {
            const d = Math.hypot(e[0] - me.x, e[2] - me.z);
            if (d < 3 && e[3] !== 1) Sfx.play('whiz');
          }
        }
        break;
      }
      case 'melee': {
        if (ev.pid === lid) break;
        const p = G.players.get(ev.pid);
        if (p) p.swingT = G.time;
        const pos = { x: ev.p[0], y: ev.p[1], z: ev.p[2] };
        FX.harvest(pos, { x: ev.n[0], y: ev.n[1], z: ev.n[2] }, ev.mat, ev.crit);
        Sfx.play('pick', pos, { m: ev.mat });
        break;
      }
      case 'sAdd': {
        if (ev.p.owner === lid) STATS.builds++;
        if (ev.p.owner !== lid) { const b = Build.aabb(ev.p); Sfx.play('build', { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 }, { m: ev.p.mat }); }
        pending.delete(Build.keyOf(ev.p));
        break;
      }
      case 'sRej': {
        if (!host && pending.has(ev.k)) { pending.delete(ev.k); const p = G.structs.get(ev.k); if (p && p.pending) G.apply({ t: 'sRem', k: ev.k, why: 'rej' }); }
        break;
      }
      case 'sEdit': { const p = G.structs.get(ev.k); if (p && p.owner !== lid) { const b = p.box; Sfx.play('edit', { x: (b[0] + b[3]) / 2, y: b[1] + 1, z: (b[2] + b[5]) / 2 }); } break; }
      case 'lRem': if (ev.by === lid) Sfx.play('pickup'); break;
      case 'boom': FX.explosion({ x: ev.p[0], y: ev.p[1], z: ev.p[2] }, ev.r); if (me) { const d = Math.hypot(ev.p[0] - me.x, ev.p[1] - me.y, ev.p[2] - me.z); shake = Math.max(shake, U.clamp(1 - d / 40, 0, 1) * 0.6); } break;
      case 'prEnd': if (ev.kind === 'bullet') FX.impact({ x: ev.p[0], y: ev.p[1], z: ev.p[2] }, { x: 0, y: 1, z: 0 }, ev.hk || 'piece'); break;
      case 'prSpawn': if (ev.owner !== lid && ev.kind !== 'bullet') Sfx.play('shot', { x: ev.o[0], y: ev.o[1], z: ev.o[2] }, { s: ev.kind === 'nade' ? 'gl' : ev.kind }); break;
      case 'used': { const p = G.players.get(ev.id); if (p) Sfx.play(ITEMS[ev.c].shield || ev.c === 'splash' ? 'shield' : 'heal', p.id === lid ? null : p); break; }
      case 'emote': { const p = G.players.get(ev.id); if (p && p !== me) { p.flags |= FL.EMOTE; } break; }
      case 'hit': if (ev.to === lid && ev.sh === false && ev.v !== undefined) { const v = G.players.get(ev.v); if (v && v.sh <= 0 && ev.shBroke) Sfx.play('shieldBreak'); } break;
      case 'elim': {
        if (ev.id === lid) onLocalEliminated(ev.place);
        const v = G.players.get(ev.id);
        if (v) FX.dust({ x: v.rx, y: v.ry, z: v.rz }, 14);
        if (ctl.specTarget && ctl.specTarget.id === ev.id) setTimeout(() => pickSpectate(), 1500);
        break;
      }
      case 'end': onEnd(ev); break;
      case 'duel': if (ev.d.state === 'countdown') { ctl.spectating = false; ctl.edit = null; ctl.mode = 'combat'; me.slot = 1; ctl.reloadT = 0; ctl.useT = 0; Menus.hideBanner(); if (me.alive === false) me.alive = true; } break;
      case 'revive': if (ev.id === lid) { ctl.spectating = false; Menus.hideBanner(); } break;
    }
  }

  function muzzleOf(p) {
    const a = Render.avatar(p.id);
    if (a && a.heldMesh && a.root.visible) {
      a.root.updateMatrixWorld(true);
      const v = new THREE.Vector3(0, 0.03, a.heldMesh.userData.muzzle || -0.6);
      a.heldMesh.localToWorld(v);
      return { x: v.x, y: v.y, z: v.z };
    }
    return { x: p.rx, y: p.ry + 1.4, z: p.rz };
  }

  function onLocalEliminated(place) {
    ctl.edit = null; ctl.mode = 'combat';
    Render.ghost(null); Render.edit(null);
    if (G.mode === 'br') {
      Sfx.play('lose');
      let killer = null;
      if (me.lastAttacker) killer = G.players.get(me.lastAttacker);
      Menus.banner(`<div class="big">#${place}</div><div class="sub">ELIMINATED${killer ? ' BY ' + U.esc(killer.name.toUpperCase()) : ''}</div><div class="row"><b>${me.kills}</b> eliminations</div>`, [
        { label: 'Spectate', fn: () => { Menus.hideBanner(); pickSpectate(); Input.lock(); } },
        { label: 'Return to Menu', fn: leave, primary: true },
      ]);
      Input.unlock();
      STATS.kills += me.kills; if (place < STATS.best || !STATS.best) STATS.best = place; saveStats();
    } else {
      ctl.spectating = true;
      pickSpectate();
    }
  }
  function pickSpectate(next) {
    const alive = G.alivePlayers().filter(p => p !== me);
    if (!alive.length) { ctl.specTarget = null; return; }
    let t = null;
    if (!next && me.lastAttacker) t = alive.find(p => p.id === me.lastAttacker);
    if (!t) {
      const i = ctl.specTarget ? alive.indexOf(ctl.specTarget) : -1;
      t = alive[(i + 1) % alive.length];
    }
    ctl.specTarget = t; ctl.spectating = true;
  }
  function onEnd(ev) {
    Render.ghost(null); Render.edit(null);
    ctl.edit = null;
    const won = ev.winner === me.id;
    setTimeout(() => {
      Input.unlock();
      if (G.mode === 'br') {
        const myRow = ev.standings.find(s => s.id === me.id);
        if (won) { STATS.wins++; STATS.best = 1; STATS.kills += me.kills; }
        else if (me.alive) STATS.kills += me.kills;
        saveStats();
        Sfx.play(won ? 'win' : 'lose');
        const top = ev.standings.slice(0, 5).map(s => `<tr class="${s.id === me.id ? 'me' : ''}"><td>#${s.place}</td><td>${U.esc(s.name)}</td><td>${s.kills}</td><td>${s.dmg}</td></tr>`).join('');
        Menus.banner(`<div class="big ${won ? 'gold' : ''}">${won ? 'VICTORY!' : '#' + (myRow ? myRow.place : '?')}</div><div class="sub">${won ? 'LAST ONE STANDING' : 'MATCH OVER — ' + U.esc((G.players.get(ev.winner) || { name: '?' }).name) + ' WINS'}</div>
          <table class="stand"><tr><th>Place</th><th>Player</th><th>Elims</th><th>Damage</th></tr>${top}</table>`, [{ label: 'Return to Menu', fn: leave, primary: true }]);
      } else {
        STATS.duels++; if (won) STATS.duelWins++; saveStats();
        Sfx.play(won ? 'win' : 'lose');
        const ids = Object.keys(ev.scores || {});
        const mine = (ev.scores || {})[me.id] || 0;
        const opp = ids.filter(i => +i !== me.id).map(i => ev.scores[i])[0] || 0;
        const oppP = [...G.players.values()].find(p => p !== me);
        Menus.banner(`<div class="big ${won ? 'gold' : ''}">${won ? 'YOU WIN!' : 'DEFEAT'}</div><div class="sub">${mine} — ${opp} vs ${U.esc(oppP ? oppP.name : '')}</div>`, [
          ...(online ? [] : [{ label: 'Rematch', fn: () => { Menus.hideBanner(); startOffline('duel'); } }]),
          { label: 'Return to Menu', fn: leave, primary: true }]);
      }
    }, won ? 1800 : 2200);
  }

  function openPause() {
    if (paused) return;
    paused = true;
    ctl.edit = null; Render.edit(null);
    Menus.pause(online);
  }
  function resume() { paused = false; Menus.hideAll(); Input.lock(); }
  function leave() {
    end(false);
    Menus.show('main');
  }
  function end(keepMenu) {
    if (online) { Net.close(); online = false; }
    Input.unlock();
    Input.setEnabled(false);
    Hud.stop();
    Menus.hideBanner();
    G = null; host = null; me = null;
    state = 'menu';
    paused = false;
    if (!keepMenu) { Render.clearWorld(); loadMenuWorld(); }
  }

  // ---------- local controller ----------
  function heldItem() { return me.slot > 0 ? me.inv.s[me.slot - 1] : null; }
  function camRay() {
    const cam = Render.camera;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    return { o: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, d: { x: d.x, y: d.y, z: d.z } };
  }
  function eye() { return { x: me.x, y: me.y + PH.EYE, z: me.z }; }
  // aim point from the crosshair, skipping anything between camera and player
  function aimPoint(dir, maxT = 600) {
    const { o } = camRay();
    const skip = Math.max(0, (o.x - me.x) * -dir.x + (o.y - me.y - PH.EYE) * -dir.y + (o.z - me.z) * -dir.z) + 0.3;
    const so = { x: o.x + dir.x * skip, y: o.y + dir.y * skip, z: o.z + dir.z * skip };
    const h = Phys.ray(G, so, dir, maxT, { players: G.alivePlayers(), ignore: me });
    if (h) return { p: h.p, h };
    return { p: { x: so.x + dir.x * maxT, y: so.y + dir.y * maxT, z: so.z + dir.z * maxT }, h: null };
  }
  function selectSlot(i) {
    if (ctl.mode === 'edit') cancelEdit();
    if (me.slot !== i) { ctl.reloadT = 0; ctl.useT = 0; ctl.spin = 0; ctl.burstLeft = 0; ctl.fireCd = Math.max(ctl.fireCd, 0.15); }
    me.slot = i;
    ctl.mode = 'combat';
  }
  function cycleSlot(d) {
    let s = me.slot;
    for (let k = 0; k < 6; k++) {
      s = (s + d + 6) % 6;
      if (s === 0 || me.inv.s[s - 1]) break;
    }
    selectSlot(s);
  }

  function controller(dt) {
    const frozen = G.duel && G.duel.state === 'countdown';
    // look
    const [mx, my] = Input.mouse();
    let sens = SETTINGS.sens;
    if (ctl.scoped) sens *= SETTINGS.scopeSens; else if (ctl.ads) sens *= SETTINGS.adsSens;
    else if (ctl.mode === 'build') sens *= SETTINGS.buildSens; else if (ctl.mode === 'edit') sens *= SETTINGS.editSens;
    ctl.yaw -= mx * 0.0022 * sens;
    ctl.pitch -= my * 0.0022 * sens * (SETTINGS.invertY ? -1 : 1);
    ctl.pitch = U.clamp(ctl.pitch, -1.48, 1.48);
    ctl.yaw = U.wrapAngle(ctl.yaw);
    if (ctl.recoil > 0) { const r = Math.min(ctl.recoil, dt * 0.35); ctl.recoil -= r; ctl.pitch -= r * 0.6; }

    if (Input.hit('map')) { ctl.mapOpen = !ctl.mapOpen; }
    if (!me.alive) {
      if (ctl.spectating && Input.hit('fire')) pickSpectate(true);
      return;
    }
    if (me.state === 'bus') {
      if (Input.hit('jump')) act({ a: 'jump' });
      return;
    }
    const ground = me.state === 'ground';

    // mode switches
    if (ground && !frozen) {
      if (Input.hit('pickaxe')) selectSlot(0);
      for (let i = 1; i <= 5; i++) if (Input.hit('slot' + i)) selectSlot(i);
      if (ctl.mode === 'combat') { if (Input.hit('nextSlot')) cycleSlot(1); if (Input.hit('prevSlot')) cycleSlot(-1); }
      if (Input.hit('buildMode')) { if (ctl.mode === 'combat') enterBuild(ctl.piece); else if (ctl.mode === 'build') ctl.mode = 'combat'; else cancelEdit(); }
      for (const pc of ['wall', 'floor', 'ramp', 'cone']) if (Input.hit(pc)) { if (ctl.mode === 'edit') confirmEdit(); enterBuild(pc); }
      if (Input.hit('edit')) { if (ctl.mode === 'edit') confirmEdit(); else startEdit(); }
    }
    if (!ground && ctl.mode !== 'combat') { cancelEdit(); ctl.mode = 'combat'; }
    // movement input
    const inp = { yaw: ctl.yaw, mx: 0, mz: 0, jump: false, sprint: false, ads: false };
    if (!frozen && !ctl.mapOpen) {
      inp.mz = (Input.held('forward') ? 1 : 0) - (Input.held('back') ? 1 : 0);
      inp.mx = (Input.held('right') ? 1 : 0) - (Input.held('left') ? 1 : 0);
      inp.jump = Input.held('jump');
      inp.sprint = SETTINGS.autoSprint ? !Input.held('sprint') : Input.held('sprint');
    }
    if (inp.mx || inp.mz || inp.jump) ctl.emoteT = 0;
    ctl.ads = false;
    if (ctl.mode === 'combat' && ground && !frozen) combat(dt, inp);
    else { ctl.scoped = false; ctl.burstLeft = 0; }
    if (ctl.mode === 'build' && !frozen) building(dt);
    else Render.ghost(null);
    if (ctl.mode === 'edit') editing(dt);
    else Render.edit(null);
    inp.ads = ctl.ads;
    inp.firing = ctl.fireCd > 0.0 && ctl.mode === 'combat' && me.slot > 0;
    if (ctl.useT > 0) inp.sprint = false;
    me.slow = ctl.useT > 0 ? 0.75 : 1;
    if (Input.hit('emote') && ground && ctl.mode === 'combat') { ctl.emoteT = 4; act({ a: 'emote' }); }
    if (ctl.emoteT > 0) ctl.emoteT -= dt;
    interaction(ground && !frozen);
    ctl.inp = inp;
  }

  function physicsStep(dt) {
    const inp = ctl.inp || { yaw: ctl.yaw };
    if (!me.alive || me.state === 'bus') return;
    if (G.duel && G.duel.state === 'countdown') return;
    const wasState = me.state;
    const ev = Phys.step(G, me, inp, dt);
    if (ev.jumped) Sfx.play('jump');
    if (ev.landed) { Sfx.play('land'); FX.dust({ x: me.x, y: me.y, z: me.z }, wasState === 'glide' ? 14 : 6); }
    if (ev.glide) Sfx.play('glide');
    if (ev.bounce) Sfx.play('bounce', me);
    if (ev.fall) act({ a: 'fall', dmg: ev.fall });
    // footsteps
    const sp = Math.hypot(me.vx, me.vz);
    if (me.onGround && sp > 2) {
      ctl.stepT -= dt * sp / 5.5;
      if (ctl.stepT <= 0) { ctl.stepT = 0.34; Sfx.play('step', { x: me.x, y: me.y, z: me.z }, { hard: !!me.groundRef }); }
    }
  }

  function flags() {
    let f = 0;
    if (ctl.ads) f |= FL.ADS;
    if (ctl.mode === 'build') f |= FL.BUILD;
    if (ctl.mode === 'edit') f |= FL.EDIT;
    if (ctl.reloadT > 0) f |= FL.RELOAD;
    if (ctl.useT > 0) f |= FL.HEAL;
    if (ctl.emoteT > 0) f |= FL.EMOTE;
    if (me.swim) f |= FL.SWIM;
    if (!me.onGround) f |= FL.AIR;
    return f;
  }
  function sendState() {
    const s = { x: U.r2(me.x), y: U.r2(me.y), z: U.r2(me.z), vx: U.r1(me.vx), vy: U.r1(me.vy), vz: U.r1(me.vz), yaw: U.r2(ctl.yaw), pitch: U.r2(ctl.pitch), st: ST_CODE[me.state], f: flags(), sl: me.slot, tp: me.tp, g: me.onGround ? 1 : 0 };
    me.yaw = ctl.yaw; me.pitch = ctl.pitch; me.flags = s.f;
    me.held = heldCode(me);
    if (host) host.handleState(me.id, s);
    else Net.toHost({ t: 'st', s });
  }

  // ---------- combat ----------
  function spreadFor(st) {
    const base = st.spread[ctl.ads ? 1 : 0];
    const moving = Math.hypot(me.vx, me.vz) > 1.5;
    let s = base * (moving ? 1.35 : 1) * (me.onGround ? 1 : 2.2) + ctl.bloom;
    if (!moving && me.onGround && ctl.ads && ctl.sinceShot > 0.45 && st.cls !== 'shotgun') s = Math.min(s, base * 0.15);
    return s;
  }
  function combat(dt, inp) {
    const it = heldItem();
    ctl.fireCd -= dt; ctl.meleeCd -= dt;
    ctl.sinceShot = (ctl.sinceShot || 0) + dt;
    ctl.bloom = Math.max(0, ctl.bloom - dt * 0.12);
    // ADS
    if (isWeapon(it)) ctl.ads = Input.held('aim') && ctl.useT <= 0;
    const st = isWeapon(it) ? weaponStats(it.w, it.r) : null;
    ctl.scoped = !!(st && st.scope && ctl.ads);
    ctl.spreadPx = st ? spreadFor(st) * window.innerHeight / (Render.camera.fov * Math.PI / 180) : 0;
    if (ctl.reloadT > 0) {
      ctl.reloadT -= dt;
      if (ctl.reloadT <= 0) finishReload();
    }
    if (ctl.useT > 0) {
      ctl.useT -= dt;
      FX.heal({ x: me.rx, y: me.ry, z: me.rz }, ITEMS[ctl.useItem] && ITEMS[ctl.useItem].shield);
      if (ctl.useT <= 0) {
        const s = ctl.useSlot;
        const cur = me.inv.s[s - 1];
        if (isItem(cur) && Inv.canUse(me, cur)) {
          if (!host) Inv.takeOne(me, s);
          act({ a: 'use', s });
        }
      }
      return;
    }
    if (me.slot === 0) {
      if (Input.held('fire') && ctl.meleeCd <= 0) swing();
      return;
    }
    if (!it) return;
    if (isItem(it)) {
      const d = ITEMS[it.c];
      if (Input.hit('fire')) {
        if (d.throw) throwNade(it);
        else if (d.trap) placePad();
        else if (Inv.canUse(me, it)) { ctl.useT = d.time; ctl.useMax = d.time; ctl.useName = d.name; ctl.useSlot = me.slot; ctl.useItem = it.c; }
        else Hud.toast(d.shield ? 'Shield is already full' : 'Health is already full', 'warn');
      } else if (Input.held('fire') && !d.throw && !d.trap && Inv.canUse(me, it) && ctl.autoUseT === undefined) { /* hold-to-chain handled by repeat presses */ }
      return;
    }
    // weapons
    const mag = st.mag;
    if (Input.hit('reload') && mag > 0 && it.mag < mag && me.inv.ammo[st.ammo] > 0 && ctl.reloadT <= 0) startReload(st);
    if (Input.hit('drop')) { dropHeld(); return; }
    const want = st.auto ? Input.held('fire') : Input.hit('fire');
    if (st.spin) { if (Input.held('fire')) ctl.spin = Math.min(st.spin, ctl.spin + dt); else ctl.spin = Math.max(0, ctl.spin - dt * 2); }
    if (ctl.burstLeft > 0) {
      ctl.burstT -= dt;
      if (ctl.burstT <= 0) { if (fireOnce(it, st)) { ctl.burstLeft--; ctl.burstT = st.burstGap; } else ctl.burstLeft = 0; }
      return;
    }
    if (want && ctl.fireCd <= 0) {
      if (mag > 0 && it.mag <= 0) {
        if (Input.hit('fire')) Sfx.play('empty');
        if (me.inv.ammo[st.ammo] > 0 && ctl.reloadT <= 0) startReload(st);
        return;
      }
      if (mag === 0 && me.inv.ammo[st.ammo] <= 0) { if (Input.hit('fire')) Sfx.play('empty'); return; }
      if (st.spin && ctl.spin < st.spin) return;
      if (ctl.reloadT > 0) {
        if (st.shellReload && it.mag > 0) ctl.reloadT = 0; else return;
      }
      if (fireOnce(it, st)) {
        if (st.burst) { ctl.burstLeft = st.burst - 1; ctl.burstT = st.burstGap; }
        ctl.fireCd = 1 / st.rate;
      }
    }
    if (mag > 0 && it.mag === 0 && ctl.reloadT <= 0 && me.inv.ammo[st.ammo] > 0 && ctl.fireCd <= -0.15) startReload(st);
  }
  function startReload(st) {
    ctl.reloadT = st.shellReload ? st.shellReload : st.reload;
    ctl.reloadMax = ctl.reloadT;
    ctl.reloadSlot = me.slot;
    Sfx.play(st.shellReload ? 'shell' : 'reload', null);
  }
  function finishReload() {
    const it = me.inv.s[ctl.reloadSlot - 1];
    if (!isWeapon(it) || me.slot !== ctl.reloadSlot) { ctl.reloadT = 0; return; }
    const st = weaponStats(it.w, it.r);
    const one = !!st.shellReload;
    if (!host) Inv.reload(me, ctl.reloadSlot, one);
    act({ a: 'reload', s: ctl.reloadSlot, one });
    const it2 = me.inv.s[ctl.reloadSlot - 1];
    if (one && it2 && it2.mag < st.mag && me.inv.ammo[st.ammo] > 0) { ctl.reloadT = st.shellReload; ctl.reloadMax = st.shellReload; Sfx.play('shell'); }
    else ctl.reloadT = 0;
  }
  function fireOnce(it, st) {
    if (st.mag > 0 && it.mag <= 0) return false;
    if (st.mag === 0 && me.inv.ammo[st.ammo] <= 0) return false;
    const cam = Render.camera;
    const sp = spreadFor(st);
    const n = st.pellets || 1;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const o = eye();
    const mz = muzzleOf(me);
    const dirs = [], ends = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = (n > 1 ? Math.sqrt(Math.random()) : Math.random()) * sp;
      const d = fwd.clone().addScaledVector(right, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize();
      const ap = aimPoint({ x: d.x, y: d.y, z: d.z }, st.range);
      let dx = ap.p.x - o.x, dy = ap.p.y - o.y, dz = ap.p.z - o.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      dirs.push([U.r2(dx * 100) / 100, U.r2(dy * 100) / 100, U.r2(dz * 100) / 100].map((v, k) => [dx, dy, dz][k]));
      if (!st.proj) {
        const h = Phys.ray(G, o, { x: dx, y: dy, z: dz }, st.range, { players: G.alivePlayers(), ignore: me });
        const e = h ? h.p : { x: o.x + dx * st.range, y: o.y + dy * st.range, z: o.z + dz * st.range };
        ends.push(e);
        if (h) FX.impact(h.p, h.n, h.kind, h.piece ? h.piece.mat : h.prop ? PROP_DEFS[h.prop.t].mat : undefined);
      }
    }
    if (!host) Inv.consumeShot(me, me.slot);
    act({ a: 'fire', s: me.slot, o: [o.x, o.y, o.z], d: dirs });
    for (const e of ends) FX.tracer(mz, e, 0xfff0b8, n > 1 ? 0.04 : 0.06, 0.1);
    FX.muzzle(mz, st.cls === 'shotgun' ? 1.0 : st.cls === 'sniper' ? 1.2 : 0.7);
    Sfx.play('shot', null, { s: st.sound });
    me.fireAnim = 1;
    ctl.bloom = Math.min(st.bloomMax || 0.05, ctl.bloom + (st.bloom || 0.01));
    ctl.recoil += st.recoil * (ctl.ads ? 0.6 : 1);
    ctl.pitch += st.recoil * (ctl.ads ? 0.5 : 0.8);
    ctl.yaw += (Math.random() - 0.5) * st.recoil * 0.4;
    shake = Math.max(shake, st.recoil * 2);
    ctl.sinceShot = 0;
    ctl.reloadT = 0;
    return true;
  }
  function swing() {
    ctl.meleeCd = 1 / PICKAXE.rate;
    me.swingT = G.time;
    Sfx.play('swing', null);
    setTimeout(() => {
      if (!G || !me || !me.alive || me.slot !== 0) return;
      const { d } = camRay();
      const ap = aimPoint(d, 12);
      const o = eye();
      let dx = ap.p.x - o.x, dy = ap.p.y - o.y, dz = ap.p.z - o.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const h = Phys.ray(G, o, { x: dx, y: dy, z: dz }, PICKAXE.range + 0.6, { players: G.alivePlayers(), ignore: me });
      let crit = false;
      if (h && (h.kind === 'prop' || (h.kind === 'piece' && h.piece.world))) {
        const id = h.prop ? 'p' + h.prop.id : h.piece.k;
        if (ctl.weak && ctl.weak.id === id && Math.hypot(h.p.x - ctl.weak.x, h.p.y - ctl.weak.y, h.p.z - ctl.weak.z) < 0.55) crit = true;
        // next weak point: somewhere else on the same surface
        const n = h.n;
        const tx = -n.z, tz = n.x;
        const a = (Math.random() - 0.5) * 1.6, b = (Math.random() - 0.3) * 1.2;
        ctl.weak = { id, x: h.p.x + tx * a + n.x * 0.05, y: U.clamp(h.p.y + b, me.y + 0.4, me.y + 2.4), z: h.p.z + tz * a + n.z * 0.05 };
        const mat = h.prop ? PROP_DEFS[h.prop.t].mat : h.piece.mat;
        FX.harvest(h.p, h.n, mat, crit);
        Sfx.play('pick', null, { m: mat, crit });
      } else if (h) {
        FX.harvest(h.p, h.n, h.piece ? h.piece.mat : -1, false);
        Sfx.play('pick', null, { m: h.piece ? h.piece.mat : h.kind === 'player' ? -1 : -1 });
        ctl.weak = null;
      } else ctl.weak = null;
      act({ a: 'melee', o: [o.x, o.y, o.z], d: [dx, dy, dz], crit });
    }, 120);
  }
  function throwNade(it) {
    const { d } = camRay();
    const o = eye();
    const v = [d.x * 24 + me.vx * 0.5, d.y * 24 + 5 + me.vy * 0.3, d.z * 24 + me.vz * 0.5];
    if (!host) Inv.takeOne(me, me.slot);
    act({ a: 'throw', s: me.slot, o: [o.x + d.x * 0.6, o.y + d.y * 0.6, o.z + d.z * 0.6], v });
    Sfx.play('swing', null);
    me.swingT = G.time;
    if (!me.inv.s[me.slot - 1]) selectSlot(0);
  }
  function placePad() {
    const fx = U.fwdX(ctl.yaw), fz = U.fwdZ(ctl.yaw);
    const x = me.x + fx * 2.6, z = me.z + fz * 2.6;
    const sup = Phys.supportBelow(G, x, me.y + 1.5, z, 5);
    if (!sup) { Hud.toast("Can't place that here", 'warn'); return; }
    if (!host) Inv.takeOne(me, me.slot);
    act({ a: 'pad', s: me.slot, x, y: me.y, z });
  }
  function dropHeld() {
    const s = me.slot;
    if (s < 1 || !me.inv.s[s - 1]) return;
    if (!host) me.inv.s[s - 1] = null;
    act({ a: 'drop', s });
    ctl.reloadT = 0;
  }

  // ---------- interaction ----------
  function interaction(can) {
    ctl.prompt = null;
    if (!can || ctl.mode === 'edit') return;
    const { d } = camRay();
    let best = null, bs = -1;
    const consider = (x, y, z, kind, obj) => {
      const dx = x - me.x, dy = y + 0.4 - (me.y + 1.2), dz = z - me.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 3.2) return;
      const dot = (dx * d.x + dy * d.y + dz * d.z) / (dist || 1);
      const score = dot + (3.2 - dist) * 0.35;
      if (dist > 1.4 && dot < 0.35) return;
      if (score > bs) { bs = score; best = { kind, obj }; }
    };
    for (const l of G.loot.values()) if (Math.abs(l.x - me.x) < 4 && Math.abs(l.z - me.z) < 4) consider(l.x, l.y, l.z, 'loot', l);
    for (const c of G.chests.values()) if (!c.open && Math.abs(c.x - me.x) < 4 && Math.abs(c.z - me.z) < 4) consider(c.x, c.y + 0.3, c.z, 'chest', c);
    for (const c of G.aboxes.values()) if (!c.open && Math.abs(c.x - me.x) < 4 && Math.abs(c.z - me.z) < 4) consider(c.x, c.y + 0.2, c.z, 'abox', c);
    if (!best) return;
    if (best.kind === 'loot') {
      const it = best.obj.it;
      let html;
      if (isWeapon(it)) html = `Pick up <b style="color:${RARITY[it.r].color}">${RARITY[it.r].name} ${WEAPONS[it.w].name}</b>`;
      else if (isItem(it)) html = `Pick up <b style="color:${RARITY[ITEMS[it.c].r].color}">${ITEMS[it.c].name}</b>${it.n > 1 ? ' ×' + it.n : ''}`;
      else if (it.a) html = `Pick up <b>${AMMO[it.a].name}</b> ×${it.n}`;
      else html = `Pick up <b>${MATS[it.m].name}</b> ×${it.n}`;
      if ((isWeapon(it) || isItem(it)) && !me.inv.s.includes(null) && !(isItem(it) && me.inv.s.some(s => s && s.c === it.c && s.n < ITEMS[it.c].stack))) {
        html += me.slot === 0 ? ' <span class="dim">(inventory full — select a slot to swap)</span>' : ` <span class="dim">(swap for ${itemName(me.inv.s[me.slot - 1])})</span>`;
      }
      ctl.prompt = { html };
      if (Input.hit('interact')) act({ a: 'pickup', id: best.obj.id });
    } else {
      ctl.prompt = { html: best.kind === 'chest' ? (best.obj.vault ? 'Open <b style="color:#c99bff">Vault Chest</b>' : 'Open <b style="color:#ffd56a">Chest</b>') : 'Open <b>Ammo Box</b>' };
      if (Input.hit('interact')) act({ a: 'open', id: best.obj.id, kind: best.kind });
    }
  }

  // ---------- building ----------
  function enterBuild(piece) {
    if (ctl.mode === 'combat') { ctl.reloadT = 0; ctl.useT = 0; ctl.burstLeft = 0; }
    ctl.mode = 'build';
    ctl.piece = piece;
    ctl.lastPlacedKey = '';
    if (SETTINGS.autoMat && me.inv.mats[ctl.mat] < BUILD_COST) {
      const m = [0, 1, 2].find(i => me.inv.mats[i] >= BUILD_COST);
      if (m !== undefined) ctl.mat = m;
    }
  }
  function currentTarget() {
    const sup = Phys.supportBelow(G, me.x, me.y + 0.1, me.z, 3.5);
    return Build.target(ctl.piece, me, ctl.yaw, ctl.pitch, ctl.rot, sup);
  }
  function building(dt) {
    ctl.buildCd -= dt;
    if (Input.hit('changeMat')) { ctl.mat = (ctl.mat + 1) % 3; Sfx.play('ui'); }
    if (Input.hit('rotate')) { ctl.rot = (ctl.rot + 1) & 3; Sfx.play('ui'); }
    if (SETTINGS.autoMat && me.inv.mats[ctl.mat] < BUILD_COST) {
      const m = [0, 1, 2].find(i => me.inv.mats[i] >= BUILD_COST);
      if (m !== undefined) ctl.mat = m;
    }
    const t = currentTarget();
    const reason = G.structs.check({ ...t, mat: ctl.mat });
    const ok = !reason && me.inv.mats[ctl.mat] >= BUILD_COST;
    const occupied = reason === 'Occupied';
    Render.ghost(occupied ? null : t, ok);
    const press = Input.hit('place');
    const hold = SETTINGS.turboBuild && Input.held('place');
    if ((press || hold) && ok && ctl.buildCd <= 0) {
      const key = Build.keyOf(t);
      if (press || key !== ctl.lastPlacedKey || true) placeBuild(t);
      ctl.lastPlacedKey = key;
      ctl.buildCd = 0.05;
    } else if (press && !ok && !occupied && me.inv.mats[ctl.mat] < BUILD_COST) Hud.toast('Not enough ' + MATS[ctl.mat].name, 'warn');
  }
  function placeBuild(t) {
    const m = ctl.mat;
    Sfx.play('build', null, { m });
    if (!host) {
      me.inv.mats[m] -= BUILD_COST;
      const max = MATS[m].hp, start = Math.round(max * 0.3);
      const k = Build.keyOf(t);
      G.apply({ t: 'sAdd', p: { ...t, mat: m, owner: me.id, hp: start, max, grow: max - start, growRate: (max - start) / MATS[m].time, mask: 0, pending: true } });
      pending.set(k, performance.now());
    }
    act({ a: 'build', t: t.type, gx: t.gx, gy: t.gy, gz: t.gz, ax: t.axis, dir: t.dir, m });
  }

  // ---------- editing ----------
  function startEdit() {
    const { o, d } = camRay();
    const skip = 1.5;
    const so = { x: o.x + d.x * skip, y: o.y + d.y * skip, z: o.z + d.z * skip };
    const h = G.structs.raycast(so, d, 9);
    if (!h) return;
    const p = h.piece;
    const hp = { x: so.x + d.x * h.t, y: so.y + d.y * h.t, z: so.z + d.z * h.t };
    if (Math.hypot(hp.x - me.x, hp.y - me.y - 1, hp.z - me.z) > 6.5) return;
    if (!p.world && p.owner !== me.id) { Hud.toast("You can only edit your own builds", 'warn'); return; }
    const sel = new Set();
    if (p.type !== 'ramp' && !SETTINGS.resetOnEditStart) for (let i = 0; i < 9; i++) if (p.mask & (1 << i)) sel.add(i);
    ctl.edit = { k: p.k, p, sel, orig: p.mask, dragMode: null, dragStart: -1, dragEnd: -1, dir: p.dir, prevMode: ctl.mode, hover: -1 };
    ctl.mode = 'edit';
    ctl.reloadT = 0; ctl.useT = 0;
    Sfx.play('editSel');
  }
  function cancelEdit() {
    if (!ctl.edit) { if (ctl.mode === 'edit') ctl.mode = 'combat'; return; }
    const back = ctl.edit.prevMode;
    ctl.edit = null;
    ctl.mode = back === 'build' ? 'build' : 'combat';
    Render.edit(null);
  }
  function confirmEdit() {
    const e = ctl.edit;
    if (!e) return;
    const p = G.structs.get(e.k);
    if (p) {
      if (p.type === 'ramp') {
        if (e.dir !== p.dir) applyEdit(p, 0, e.dir);
      } else {
        let mask = 0;
        for (const i of e.sel) mask |= 1 << i;
        if (mask !== p.mask && Build.validMask(p.type, mask)) applyEdit(p, mask);
      }
    }
    cancelEdit();
  }
  function resetEdit() {
    const e = ctl.edit;
    const p = e && G.structs.get(e.k);
    if (p && (p.mask || p.type === 'ramp')) applyEdit(p, 0, p.type === 'ramp' ? e.dir : undefined);
    cancelEdit();
  }
  function applyEdit(p, mask, dir) {
    Sfx.play('edit', null);
    if (!host) {
      const ev = { t: 'sEdit', k: p.k, mask };
      if (dir !== undefined) ev.dir = dir;
      G.apply(ev);
    }
    act({ a: 'edit', k: p.k, mask, dir });
  }
  function editing(dt) {
    const e = ctl.edit;
    const p = e && G.structs.get(e.k);
    if (!p) { cancelEdit(); return; }
    const b = p.box;
    if (Math.hypot((b[0] + b[3]) / 2 - me.x, (b[1] + b[4]) / 2 - me.y - 1, (b[2] + b[5]) / 2 - me.z) > 9) { cancelEdit(); return; }
    if (Input.hit('resetEdit')) { resetEdit(); return; }
    const { o, d } = camRay();
    const tile = Build.editTileAt(p, o, d);
    e.hover = tile;
    if (Input.hit('editSelect') && tile >= 0) {
      if (p.type === 'ramp') { e.dragStart = tile; e.dragEnd = tile; }
      else { e.dragMode = !e.sel.has(tile); toggleTile(e, tile, e.dragMode); }
    }
    if (Input.held('editSelect') && tile >= 0) {
      if (p.type === 'ramp') {
        if (e.dragStart >= 0 && tile !== e.dragEnd) { e.dragEnd = tile; const nd = Build.rampDirFromDrag(e.dragStart, tile); if (nd >= 0) { e.dir = nd; Sfx.play('editSel'); } }
      } else if (e.dragMode !== null) toggleTile(e, tile, e.dragMode);
    }
    if (Input.up('editSelect')) {
      e.dragMode = null;
      if (SETTINGS.editOnRelease) { confirmEdit(); return; }
    }
    const sel = p.type === 'ramp' ? new Set() : e.sel;
    Render.edit(p, sel, tile, p.type === 'ramp' ? e.dir : undefined);
  }
  function toggleTile(e, tile, on) {
    const had = e.sel.has(tile);
    if (on && !had) { e.sel.add(tile); Sfx.play('editSel'); }
    else if (!on && had) { e.sel.delete(tile); Sfx.play('editSel'); }
  }

  // ---------- camera ----------
  const tmpV = new THREE.Vector3();
  function camera(dt, alpha) {
    const cam = Render.camera;
    const vfov = h => 2 * Math.atan(Math.tan(h * Math.PI / 360) / (16 / 9)) * 180 / Math.PI;
    let fovH = SETTINGS.fov;
    const it = me && heldItem();
    let target, dist = 3.1, right = 0.95, up = 0.38, fp = false;
    const view = { localId: me ? me.id : -1, hideLocal: false, inStorm: false };
    let subject = me;
    if (me && !me.alive && ctl.spectating && ctl.specTarget) subject = ctl.specTarget;
    if (!subject) return view;
    if (subject === me) {
      me.rx = U.lerp(prev.x, me.x, alpha); me.ry = U.lerp(prev.y, me.y, alpha); me.rz = U.lerp(prev.z, me.z, alpha);
      me.ryaw = ctl.yaw; me.rpitch = ctl.pitch;
    }
    if (subject.state === 'bus') {
      const bp = G.busPos(Math.max(0, G.time - 3));
      target = new THREE.Vector3(bp.x, bp.y, bp.z);
      dist = 62; right = 0; up = 14;
    } else {
      if (camY === null || Math.abs(camY - subject.ry) > 3) camY = subject.ry;
      camY += (subject.ry - camY) * Math.min(1, dt * 20);
      target = new THREE.Vector3(subject.rx, camY + 1.55, subject.rz);
      if (subject.state === 'sky') { dist = 6.5; right = 0; up = 1; }
      else if (subject.state === 'glide') { dist = 6; right = 0; up = 1.4; }
      else if (ctl.mode === 'build') { dist = 3.7; }
      if (subject === me && ctl.ads && isWeapon(it)) {
        const st = WEAPONS[it.w];
        fovH = SETTINGS.fov / st.zoom;
        if (st.scope) fp = true; else { dist = 1.7; right = 0.62; up = 0.25; }
      }
    }
    ctl.fovZoom = fovH;
    const yaw = ctl.yaw, pitch = ctl.pitch;
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
    const rgt = new THREE.Vector3(1, 0, 0).applyEuler(cam.rotation);
    if (fp) {
      cam.position.set(subject.rx, subject.ry + PH.EYE, subject.rz);
      view.hideLocal = true;
    } else {
      const piv = target.clone().addScaledVector(rgt, right * 0.6);
      piv.y += up * 0.5;
      const wantPos = target.clone().addScaledVector(rgt, right).add(new THREE.Vector3(0, up, 0)).addScaledVector(fwd, -dist);
      const dir = wantPos.clone().sub(piv);
      const len = dir.length();
      dir.normalize();
      let L = len;
      if (G && subject.state !== 'bus') {
        const h = Phys.ray(G, { x: piv.x, y: piv.y, z: piv.z }, { x: dir.x, y: dir.y, z: dir.z }, len + 0.3);
        if (h) L = Math.max(0.35, h.t - 0.3);
      }
      cam.position.copy(piv).addScaledVector(dir, L);
      if (L < 0.8 && subject === me) view.hideLocal = true;
    }
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * shake * 0.25;
      shake = Math.max(0, shake - dt * 2.5);
    }
    const targetFov = vfov(fovH);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 14);
    cam.updateProjectionMatrix();
    view.focus = target;
    const s = G.storm;
    if (s && s.st !== 'pre') view.inStorm = Math.hypot(cam.position.x - s.cx, cam.position.z - s.cz) > s.r;
    Sfx.setListener(cam.position.x, cam.position.y, cam.position.z, yaw);
    Sfx.loops(view.inStorm ? 1 : U.clamp(1 - (Math.hypot(cam.position.x - (s ? s.cx : 0), cam.position.z - (s ? s.cz : 0)) - (s ? s.r : 1e4)) / -40, 0, 0.4), subject.state === 'sky' ? 1 : subject.state === 'glide' ? 0.5 : 0);
    return view;
  }

  function smoothOthers(dt) {
    const k = Math.min(1, dt * (host ? 22 : 12));
    for (const p of G.players.values()) {
      if (p === me) continue;
      if (p.rx === undefined || Math.hypot(p.x - p.rx, p.z - p.rz) > 25) { p.rx = p.x; p.ry = p.y; p.rz = p.z; p.ryaw = p.yaw; }
      const ox = p.rx, oz = p.rz;
      p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; p.rz += (p.z - p.rz) * k;
      p.ryaw = U.lerpAngle(p.ryaw, p.yaw, k);
      p.rpitch = U.lerp(p.rpitch || 0, p.pitch || 0, k);
      p.rvx = (p.rx - ox) / Math.max(dt, 1e-4); p.rvz = (p.rz - oz) / Math.max(dt, 1e-4);
      p.onGroundR = !(p.flags & FL.AIR);
      if (host) p.held = heldCode(p);
      if (p.flags & FL.HEAL && Math.random() < 0.3) FX.heal({ x: p.rx, y: p.ry, z: p.rz }, false);
    }
    if (me) { me.rvx = me.vx; me.rvz = me.vz; me.onGroundR = me.onGround || me.state !== 'ground'; me.held = heldCode(me); me.flags = flags(); }
  }

  // ---------- main loop ----------
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    fpsT += dt; fpsN++;
    if (fpsT > 0.5) { const el = document.getElementById('fps'); if (el) el.textContent = Math.round(fpsN / fpsT) + ' FPS'; fpsT = 0; fpsN = 0; }
    try {
      if (state === 'game' && G) gameFrame(dt);
      else menuFrame(dt);
    } catch (e) {
      console.error(e);
      if (window.T) window.T.errs.push(String(e && e.stack || e));
    }
    Input.endFrame();
  }

  function gameFrame(dt) {
    const offlinePause = paused && !online;
    if (!offlinePause && !paused && Input.locked()) controller(dt);
    else if (!paused) { Input.mouse(); if (me.alive) ctl.inp = { yaw: ctl.yaw }; }
    if (!offlinePause) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        prev = { x: me.x, y: me.y, z: me.z };
        physicsStep(STEP);
        if (host) {
          sendState();
          host.tick(STEP);
        } else {
          G.time += STEP;
          G.update(STEP);
          for (const pr of G.proj.values()) { pr.vy -= (pr.grav || 0) * STEP; pr.x += pr.vx * STEP; pr.y += pr.vy * STEP; pr.z += pr.vz * STEP; pr.age += STEP; }
        }
        acc -= STEP; steps++;
      }
      if (acc > STEP * 6) acc = 0;
      netFrame(dt);
    }
    // pending prediction timeout
    const nowMs = performance.now();
    for (const [k, t] of pending) if (nowMs - t > 1500) { pending.delete(k); const p = G.structs.get(k); if (p && p.pending) G.apply({ t: 'sRem', k, why: 'rej' }); }
    smoothOthers(dt);
    FX.syncProjectiles(G, dt);
    const view = camera(dt, U.clamp(acc / STEP, 0, 1));
    // weak point marker
    if (ctl.weak && me.slot === 0 && ctl.mode === 'combat') FX.weakPoint(ctl.weak);
    // aimed piece hp
    ctl.aimPiece = null;
    if (me.alive && me.state === 'ground') {
      const { o, d } = camRay();
      const h = G.structs.raycast({ x: o.x + d.x * 1.5, y: o.y + d.y * 1.5, z: o.z + d.z * 1.5 }, d, 30);
      if (h && (ctl.mode !== 'combat' || h.piece.hp < h.piece.max || me.slot === 0)) ctl.aimPiece = h.piece;
    }
    FX.stormSpecks(Render.camera.position, G.storm);
    Render.frame(dt, view);
    Hud.update(dt, ctl);
  }

  function netFrame(dt) {
    if (!online) { if (host) host.drain(); return; }
    if (host) {
      netT += dt; snapT += dt;
      if (netT >= 1 / 30) {
        netT = 0;
        const evs = host.drain();
        for (const [pid] of Net.conns) {
          const mine = evs.filter(e => e.to === undefined || e.to === pid);
          if (mine.length) Net.send(pid, { t: 'ev', l: mine });
          const p = G.players.get(pid);
          if (p && p.invDirty) { Net.send(pid, { t: 'inv', inv: p.inv, ack: p.ack || 0 }); p.invDirty = false; }
        }
        me.invDirty = false;
      }
      if (snapT >= 1 / 20) { snapT = 0; Net.broadcast(host.snapshot()); }
    } else {
      stT += dt;
      if (stT >= 1 / 30) { stT = 0; if (me.alive && me.state !== 'bus') sendState(); }
    }
  }

  // menu: slow orbit over the island with the player's character
  function menuFrame(dt) {
    menuT += dt;
    const sp = menuAvatar.spot;
    const cam = Render.camera;
    // camera stands outside town looking back at the character, with the houses behind them
    const a = sp.a + Math.sin(menuT * 0.08) * 0.25;
    const dx = Math.cos(a), dz = Math.sin(a);
    cam.position.set(sp.x + dx * 5.6 - dz * 1.2, sp.y + 1.9, sp.z + dz * 5.6 + dx * 1.2);
    cam.fov = 48; cam.updateProjectionMatrix();
    const look = new THREE.Vector3(sp.x, sp.y + 1.25, sp.z);
    cam.lookAt(look);
    cam.rotateY(0.34);
    menuAvatar.root.rotation.y = Math.atan2(-dx, -dz) + 0.35;
    menuAvatar.head.rotation.y = Math.sin(menuT * 0.7) * 0.2;
    menuAvatar.torso.rotation.z = Math.sin(menuT * 1.3) * 0.02;
    menuAvatar.root.position.y = sp.y + Math.sin(menuT * 2) * 0.01;
    Render.frame(dt, { focus: look, localId: -1 });
  }

  // ---------- dev harness ----------
  function setupDev() {
    const ce = console.error.bind(console);
    console.error = (...a) => { if (window.T) T.errs.push(a.map(String).join(' ').slice(0, 400)); ce(...a); };
    window.T = {
      errs: [],
      G: () => G, host: () => host, me: () => me, ctl,
      startBR(bots = 10) { SETTINGS.br.bots = bots; startOffline('br'); return 'ok'; },
      startDuel() { startOffline('duel'); return 'ok'; },
      run(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { host.tick(STEP); host.drain(); } return T.status(); },
      status() { if (!G) return 'menu'; return { phase: G.phase, time: U.r1(G.time), alive: G.aliveCount(), me: { hp: me.hp, sh: me.sh, state: me.state, x: U.r1(me.x), y: U.r1(me.y), z: U.r1(me.z), alive: me.alive }, pieces: G.structs.map.size, loot: G.loot.size, storm: G.storm && { r: U.r1(G.storm.r), st: G.storm.st, i: G.storm.i }, duel: G.duel && { ...G.duel } }; },
      tp(x, z, y) { me.x = x; me.z = z; me.y = y !== undefined ? y : G.T.h(x, z) + 0.5; me.vy = 0; me.state = 'ground'; prev = { x: me.x, y: me.y, z: me.z }; camY = null; return [me.x, me.y, me.z]; },
      look(yaw, pitch) { ctl.yaw = yaw; ctl.pitch = pitch; },
      give(w, r = 4) { const i = me.inv.s.indexOf(null); me.inv.s[i >= 0 ? i : 0] = { w, r, mag: WEAPONS[w].mag }; for (const a in me.inv.ammo) me.inv.ammo[a] = 500; me.inv.mats = [999, 999, 999]; },
      mats() { me.inv.mats = [999, 999, 999]; },
      build(piece, yaw = ctl.yaw, pitch = ctl.pitch) { ctl.piece = piece; ctl.yaw = yaw; ctl.pitch = pitch; const t = currentTarget(); const r = G.structs.check({ ...t, mat: ctl.mat }); if (!r) placeBuild(t); return { t, r }; },
      target(piece, yaw = ctl.yaw, pitch = ctl.pitch) { ctl.piece = piece; ctl.yaw = yaw; ctl.pitch = pitch; return currentTarget(); },
      step(n = 1, inp = {}) { for (let i = 0; i < n; i++) { prev = { x: me.x, y: me.y, z: me.z }; Phys.step(G, me, { yaw: ctl.yaw, ...inp }, STEP); if (host) { sendState(); host.tick(STEP); host.drain(); } } return [U.r2(me.x), U.r2(me.y), U.r2(me.z), me.onGround]; },
      edit(k, mask, dir) { const p = G.structs.get(k); if (p) applyEdit(p, mask, dir); return p && p.mask; },
      // render one frame and save the canvas through the dev server (works even when the pane is throttled)
      snap(name = 'snap', withHud = false) {
        T.frames(1);
        const c = Render.renderer.domElement;
        return new Promise(res => c.toBlob(b => fetch('/__snap/' + name, { method: 'POST', body: b }).then(() => res('saved ' + name)).catch(e => res('fail ' + e)), 'image/jpeg', 0.85));
      },
      // drive frames by hand (the preview pane throttles requestAnimationFrame when hidden)
      frames(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { try { if (state === 'game' && G) gameFrame(dt); else menuFrame(dt); } catch (e) { T.errs.push(String(e.stack || e)); break; } Input.endFrame(); } return T.errs.length ? T.errs.slice(-2) : 'ok'; },
      lock: () => Input.lock(),
      fakeLock() { Object.defineProperty(document, 'pointerLockElement', { get: () => document.getElementById('game'), configurable: true }); },
    };
  }

  return { boot, startOffline, startOnline, leave, resume, openPause, get ctl() { return ctl; }, get G() { return G; }, get me() { return me; }, get state() { return state; }, get online() { return online; }, placeMenuAvatar, botDef };
})();

window.addEventListener('load', () => Main.boot());
