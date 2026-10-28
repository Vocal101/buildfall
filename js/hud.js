'use strict';
// In-game HUD: health, hotbar, materials, minimap, kill feed, prompts, damage numbers.

const Hud = (() => {
  const $ = id => document.getElementById(id);
  let G = null, me = null;
  let mapImg = null, mapSize = 0;
  const feed = [];
  const dmgNums = [];
  let hitT = 0, hitHead = false, hurtDirs = [];
  let centerTimer = null;

  function init() { }

  function iconFor(it) {
    if (!it) return '';
    if (isWeapon(it)) return weaponIcon(it.w);
    return itemIcon(it.c);
  }
  // compact inline SVG silhouettes
  function weaponIcon(w) {
    const c = WEAPONS[w].cls;
    const P = {
      ar: 'M4 18h30l4-3h18v6H40l-2 3h-6l-2 6h-6l2-6H14l-4 4H4z',
      shotgun: 'M2 17h44v5H24l-2 2h-4l-2 6h-6l2-6H8l-3 3H2z M46 18h12v3H46z',
      smg: 'M8 16h30v6H28l-1 8h-6l1-8h-8l-2 4H8z M38 17h10v3H38z',
      pistol: 'M14 15h26v6H28l-2 9h-7l2-9h-7z',
      sniper: 'M2 18h40l4-2h16v4H44l-2 2H26l-2 6h-6l2-6H8l-4 4H2z M16 12h18v4H16z',
      explosive: 'M4 14h52v8H4z M18 22h6v8h-6z M8 11h8v3H8z',
    };
    let d = P[c] || P.ar;
    if (w === 'minigun') d = 'M2 14h34v10H2z M36 15h24v2H36z M36 19h24v2H36z M36 23h24v1H36z M12 24h6v6h-6z';
    if (w === 'gl') d = 'M8 14h34v8H8z M42 16h16v4H42z M14 22h8v8h-8z';
    return `<svg viewBox="0 0 64 36"><path d="${d}" fill="currentColor"/></svg>`;
  }
  // drawn rounds for the ammo counters
  function ammoIcon(a) {
    const col = AMMO[a].color;
    const round = (x, w, caseH, tipH) => `<rect x="${x}" y="${24 - caseH}" width="${w}" height="${caseH}" rx="1" fill="#d9a640"/><rect x="${x}" y="${24 - caseH}" width="${w * 0.35}" height="${caseH}" fill="#f3cf72"/><rect x="${x - 0.6}" y="22.4" width="${w + 1.2}" height="1.6" fill="#a87a2a"/><path d="M${x} ${24 - caseH}Q${x} ${24 - caseH - tipH * 0.75} ${x + w / 2} ${24 - caseH - tipH}Q${x + w} ${24 - caseH - tipH * 0.75} ${x + w} ${24 - caseH}z" fill="#c8703a"/><rect x="${x}" y="${24 - caseH + 1}" width="${w}" height="1.6" fill="${col}"/>`;
    let body;
    if (a === 'shells') body = '<rect x="3" y="6" width="10" height="13" rx="1.5" fill="#d23a32"/><rect x="3" y="6" width="3" height="13" fill="#ef6a5e"/><rect x="2.4" y="18" width="11.2" height="6" rx="1" fill="#d9a640"/><rect x="3" y="9" width="10" height="1.6" fill="' + col + '"/>';
    else if (a === 'rockets') body = '<path d="M8 1l3.5 6v12h-7V7z" fill="#5d6672"/><path d="M8 1l3.5 6h-7z" fill="#e8402a"/><path d="M4.5 15l-3 5h3zM11.5 15l3 5h-3z" fill="#e8402a"/><rect x="4.5" y="8" width="7" height="1.6" fill="' + col + '"/><rect x="6" y="19" width="4" height="3" fill="#ffb03a"/>';
    else if (a === 'heavy') body = round(3.5, 9, 13, 8);
    else if (a === 'medium') body = round(4.5, 7, 12, 7);
    else body = round(5.5, 5, 9, 5);
    return `<svg class="ammo-ic" viewBox="0 0 16 24">${body}</svg>`;
  }
  function itemIcon(c) {
    const I = {
      bandage: '<circle cx="32" cy="18" r="11" fill="#f4f1ea"/><rect x="21" y="15" width="22" height="6" fill="#d8b48a"/>',
      medkit: '<rect x="14" y="8" width="36" height="22" rx="3" fill="#f2f2f2"/><rect x="29" y="11" width="6" height="16" fill="#e23b3b"/><rect x="24" y="16" width="16" height="6" fill="#e23b3b"/>',
      mini: '<circle cx="32" cy="21" r="10" fill="#3fb8ff"/><rect x="29" y="5" width="6" height="8" fill="#ddd"/>',
      big: '<rect x="23" y="10" width="18" height="22" rx="5" fill="#2f8dff"/><rect x="28" y="3" width="8" height="8" fill="#ddd"/>',
      fizz: '<rect x="24" y="6" width="16" height="26" rx="3" fill="#6bdc3c"/><rect x="24" y="15" width="16" height="6" fill="#3a7df0"/>',
      jug: '<rect x="20" y="6" width="22" height="26" rx="5" fill="#f0f6ff"/><rect x="20" y="15" width="22" height="8" fill="#2f8dff"/><circle cx="46" cy="16" r="5" fill="none" stroke="#f0f6ff" stroke-width="3"/>',
      nade: '<circle cx="32" cy="21" r="10" fill="#6b8f3f"/><rect x="29" y="6" width="6" height="6" fill="#999"/><circle cx="38" cy="7" r="3" fill="none" stroke="#ccc" stroke-width="2"/>',
      pad: '<ellipse cx="32" cy="22" rx="20" ry="7" fill="#2c2f36"/><ellipse cx="32" cy="19" rx="16" ry="5" fill="#48e0ff"/>',
    };
    return `<svg viewBox="0 0 64 36">${I[ITEMS[c].icon] || ''}</svg>`;
  }

  function prerenderMap(W) {
    const T = W.T;
    const n = 256;
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    const N = U.noise2(W.seed + 99);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const wx = -T.half + (x + 0.5) / n * T.size, wz = -T.half + (y + 0.5) / n * T.size;
      const h = T.h(wx, wz);
      let r, gg, b;
      if (h < WATER_Y - 0.2) { const d = U.clamp(-h / 10, 0, 1); r = 40 - d * 20; gg = 150 - d * 70; b = 190 - d * 50; }
      else if (h < 2.4) { r = 222; gg = 205; b = 150; }
      else {
        const nn = N(wx * 0.05, wz * 0.05) * 0.5 + 0.5;
        const sl = Math.abs(T.h(wx + 2, wz) - T.h(wx - 2, wz)) + Math.abs(T.h(wx, wz + 2) - T.h(wx, wz - 2));
        r = 80 + nn * 20; gg = 140 + nn * 25 - h * 0.6; b = 60;
        if (sl > 3.5 || h > 32) { r = 120 + h; gg = 118 + h * 0.8; b = 110 + h * 0.6; }
        const shade = U.clamp(1 + (T.h(wx - 2, wz - 2) - h) * -0.06, 0.75, 1.2);
        r *= shade; gg *= shade; b *= shade;
      }
      const i = (y * n + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(150,120,80,0.9)'; g.lineWidth = 2;
    const toM = v => (v + T.half) / T.size * n;
    for (const r of W.roads) { g.beginPath(); g.moveTo(toM(r[0]), toM(r[1])); g.lineTo(toM(r[2]), toM(r[3])); g.stroke(); }
    for (const p of W.pieces) {
      if (p.type !== 'floor') continue;
      g.fillStyle = 'rgba(120,90,70,0.9)';
      g.fillRect(toM(p.gx * S), toM(p.gz * S), S / T.size * n + 0.5, S / T.size * n + 0.5);
    }
    mapImg = c; mapSize = n;
  }

  function start(game, localPlayer) {
    G = game; me = localPlayer;
    prerenderMap(G.W);
    feed.length = 0;
    $('killfeed').innerHTML = '';
    $('hud').classList.remove('hidden');
    $('hud').classList.toggle('duel', G.mode === 'duel');
    buildHotbar();
  }
  function stop() { $('hud').classList.add('hidden'); for (const d of dmgNums) d.el.remove(); dmgNums.length = 0; }

  function buildHotbar() {
    const hb = $('hotbar');
    hb.innerHTML = '';
    for (let i = 0; i <= 5; i++) {
      const d = document.createElement('div');
      d.className = 'slot' + (i === 0 ? ' pick' : '');
      d.innerHTML = `<div class="icon"></div><div class="cnt"></div><div class="key"></div>`;
      hb.appendChild(d);
    }
  }

  function centerMsg(text, kind = '', dur = 2.6) {
    const el = $('center-msg');
    el.textContent = text;
    el.className = 'show ' + kind;
    clearTimeout(centerTimer);
    centerTimer = setTimeout(() => { el.className = ''; }, dur * 1000);
  }
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

  function addFeed(html) {
    const el = document.createElement('div');
    el.className = 'feed-row';
    el.innerHTML = html;
    $('killfeed').prepend(el);
    feed.push(el);
    setTimeout(() => el.classList.add('out'), 6000);
    setTimeout(() => { el.remove(); }, 6600);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  }

  function dmgNumber(pos, dmg, head, sh) {
    const el = document.createElement('div');
    el.className = 'dmgnum' + (head ? ' head' : '') + (sh ? ' sh' : '');
    el.textContent = Math.round(dmg);
    $('dmgnums').appendChild(el);
    dmgNums.push({ el, x: pos[0] + (Math.random() - 0.5) * 0.6, y: pos[1] + 0.3, z: pos[2] + (Math.random() - 0.5) * 0.6, t: 0 });
  }

  function onEvent(ev) {
    if (!G) return;
    const lid = window.LOCAL_ID;
    switch (ev.t) {
      case 'hit':
        if (ev.to !== lid) return;
        dmgNumber(ev.p, ev.dmg, ev.head, ev.sh);
        hitT = 0.18; hitHead = ev.head;
        Sfx.play(ev.head ? 'head' : 'hit', null, { sh: ev.sh });
        break;
      case 'dmg':
        if (ev.to !== lid) return;
        if (ev.from) hurtDirs.push({ x: ev.from[0], z: ev.from[1], t: 1.2 });
        $('vignette').classList.remove('pulse'); void $('vignette').offsetWidth; $('vignette').classList.add(ev.storm ? 'pulse-storm' : 'pulse');
        Sfx.play('hurt');
        break;
      case 'kill': {
        const k = G.players.get(ev.k), v = G.players.get(ev.v);
        const wn = ev.w && WEAPONS[ev.w] ? WEAPONS[ev.w].name : ev.w === 'pick' ? 'Harvesting Tool' : ev.w === 'storm' ? 'the Storm' : ev.w === 'fall' ? 'a fall' : ev.w === 'boom' ? 'an explosion' : '';
        const nm = p => p ? `<b class="${p.id === lid ? 'me' : ''}">${U.esc(p.name)}</b>` : '';
        if (k && v) addFeed(`${nm(k)} <span class="w">${ev.head ? '🎯 ' : ''}${U.esc(wn)}</span> ${nm(v)}`);
        else if (v) addFeed(`${nm(v)} was eliminated by <span class="w">${U.esc(wn || 'the island')}</span>`);
        if (ev.k === lid && ev.v !== lid) { centerMsg(`ELIMINATED ${v ? v.name.toUpperCase() : ''}`, 'elim', 2.2); Sfx.play('elim'); }
        break;
      }
      case 'storm':
        if (ev.st === 'wait') centerMsg(ev.i === 0 ? 'The storm is forming' : 'Storm eye shrinking in ' + U.fmtTime(ev.time), 'storm', 3.5);
        else { centerMsg('The storm is closing in!', 'storm', 3); Sfx.play('alert'); }
        break;
      case 'msg': if (ev.to === undefined || ev.to === lid) toast(ev.text, ev.kind); break;
      case 'mats': if (ev.to === lid) { Sfx.play('mats'); flashMat(ev.m, ev.n); } break;
      case 'duel': {
        const D = G.duel;
        if (ev.d.state === 'countdown') centerMsg('ROUND ' + D.round, 'round', 1.4);
        if (ev.d.state === 'fight') { centerMsg('FIGHT!', 'round', 1); Sfx.play('count', null, { go: true }); }
        if (ev.d.state === 'roundEnd') {
          const w = G.players.get(ev.d.last);
          centerMsg(w ? (w.id === lid ? 'ROUND WON' : 'ROUND LOST') : 'DRAW', w && w.id === lid ? 'win' : 'lose', 2.5);
        }
        break;
      }
    }
  }
  const matFlash = [0, 0, 0];
  function flashMat(m, n) { matFlash[m] = 0.6; const el = document.querySelectorAll('#mats .mat')[m]; if (el) { const f = document.createElement('span'); f.className = 'plus'; f.textContent = '+' + n; el.appendChild(f); setTimeout(() => f.remove(), 900); } }

  // ---------- per frame ----------
  let lastHB = '';
  function update(dt, ctl) {
    if (!G || !me) return;
    const lid = window.LOCAL_ID;
    const p = ctl.viewPlayer();
    // health
    const hp = Math.max(0, me.hp), sh = Math.max(0, me.sh);
    $('hp-fill').style.width = hp + '%';
    $('sh-fill').style.width = sh + '%';
    $('hp-num').textContent = Math.ceil(hp);
    $('sh-num').textContent = Math.ceil(sh);
    $('hp-ghost').style.width = Math.max(parseFloat($('hp-ghost').style.width || 0) - dt * 40, hp) + '%';
    $('sh-ghost').style.width = Math.max(parseFloat($('sh-ghost').style.width || 0) - dt * 40, sh) + '%';
    // hotbar
    const inv = me.inv;
    const sig = JSON.stringify(inv.s) + me.slot + ctl.mode + (ctl.reloadT > 0) + Input.binds.slot1 + Input.binds.pickaxe;
    if (sig !== lastHB) {
      lastHB = sig;
      const slots = $('hotbar').children;
      for (let i = 0; i <= 5; i++) {
        const el = slots[i];
        const it = i === 0 ? null : inv.s[i - 1];
        el.classList.toggle('sel', me.slot === i && ctl.mode === 'combat');
        el.classList.toggle('empty', i > 0 && !it);
        const r = i === 0 ? -1 : itemRarity(it);
        el.style.setProperty('--rc', it ? RARITY[r].color : 'rgba(255,255,255,0.15)');
        el.dataset.r = it ? r : '';
        el.querySelector('.icon').innerHTML = i === 0 ? '<svg viewBox="0 0 64 36"><path d="M10 9c10-5 34-5 44 0l-3 4c-6-2-12-3-17-3l-5 23h-5l5-23c-5 0-11 1-16 3z" fill="currentColor"/></svg>' : iconFor(it);
        el.querySelector('.key').textContent = Input.label(Input.binds[i === 0 ? 'pickaxe' : 'slot' + i]);
        let cnt = '';
        if (isWeapon(it)) cnt = WEAPONS[it.w].mag === 0 ? inv.ammo[WEAPONS[it.w].ammo] : it.mag;
        else if (isItem(it)) cnt = it.n > 1 ? it.n : '';
        el.querySelector('.cnt').textContent = cnt;
      }
    }
    // ammo readout
    const held = Inv.held(me);
    const ar = $('ammo-readout');
    if (isWeapon(held) && ctl.mode === 'combat') {
      const st = WEAPONS[held.w];
      ar.classList.remove('hidden');
      ar.querySelector('.mag').textContent = st.mag === 0 ? '∞' : held.mag;
      ar.querySelector('.res').textContent = inv.ammo[st.ammo];
      ar.querySelector('.wname').textContent = st.name;
      ar.querySelector('.wname').style.color = RARITY[held.r].color;
      ar.classList.toggle('low', st.mag > 0 && held.mag <= Math.ceil(st.mag * 0.2));
    } else if (isItem(held) && ctl.mode === 'combat') {
      ar.classList.remove('hidden');
      ar.querySelector('.mag').textContent = held.n;
      ar.querySelector('.res').textContent = '';
      ar.querySelector('.wname').textContent = ITEMS[held.c].name;
      ar.querySelector('.wname').style.color = RARITY[ITEMS[held.c].r].color;
      ar.classList.remove('low');
    } else ar.classList.add('hidden');
    // ammo reserve list
    const al = $('ammo-list');
    const ah = Object.keys(AMMO).filter(a => inv.ammo[a] > 0).map(a => `<div style="--ac:${AMMO[a].color}" title="${AMMO[a].name}">${ammoIcon(a)}${inv.ammo[a]}</div>`).join('');
    if (al.dataset.h !== ah) { al.innerHTML = ah; al.dataset.h = ah; }
    // mats
    const mats = $('mats').children;
    for (let i = 0; i < 3; i++) {
      mats[i].querySelector('b').textContent = inv.mats[i];
      mats[i].classList.toggle('sel', ctl.mode !== 'combat' && ctl.mat === i);
      mats[i].classList.toggle('none', inv.mats[i] < BUILD_COST);
    }
    // build bar
    const bb = $('buildbar');
    bb.classList.toggle('hidden', ctl.mode !== 'build');
    if (ctl.mode === 'build') {
      const keys = ['wall', 'floor', 'ramp', 'cone'];
      [...bb.children].forEach((el, i) => { el.classList.toggle('sel', ctl.piece === keys[i]); el.querySelector('.key').textContent = Input.label(Input.binds[keys[i]]); });
    }
    $('edit-hint').classList.toggle('hidden', ctl.mode !== 'edit');
    if (ctl.mode === 'edit') $('edit-hint').innerHTML = `<b>EDITING</b> ${Input.label(Input.binds.editSelect)} select &nbsp;·&nbsp; ${Input.label(Input.binds.resetEdit)} reset &nbsp;·&nbsp; ${Input.label(Input.binds.edit)} ${SETTINGS.editOnRelease ? 'or release ' : ''}confirm`;
    // crosshair
    const ch = $('crosshair');
    const spr = Math.min(48, 5 + ctl.spreadPx * 0.75);
    ch.style.setProperty('--gap', spr + 'px');
    ch.className = ctl.mode === 'combat' ? (ctl.scoped ? 'hidden' : (me.slot === 0 ? 'dot' : (isWeapon(held) && WEAPONS[held.w].cls === 'shotgun' ? 'circle' : ''))) : 'build';
    ch.style.color = SETTINGS.crosshair;
    $('scope').classList.toggle('hidden', !ctl.scoped);
    // hitmarker
    hitT -= dt;
    const hm = $('hitmarker');
    hm.className = hitT > 0 ? ('show' + (hitHead ? ' head' : '')) : '';
    // reload / heal progress
    const prog = $('progress');
    if (ctl.useT > 0 || ctl.reloadT > 0) {
      prog.classList.remove('hidden');
      const f = ctl.useT > 0 ? 1 - ctl.useT / ctl.useMax : 1 - ctl.reloadT / ctl.reloadMax;
      prog.querySelector('.bar i').style.width = (f * 100) + '%';
      prog.querySelector('.lbl').textContent = ctl.useT > 0 ? ctl.useName : 'Reloading';
    } else prog.classList.add('hidden');
    // interaction prompt
    const ip = $('interact');
    if (ctl.prompt) {
      ip.classList.remove('hidden');
      ip.innerHTML = `<span class="k">${Input.label(Input.binds.interact)}</span> ${ctl.prompt.html}`;
    } else ip.classList.add('hidden');
    // piece health
    const ph = $('piece-hp');
    if (ctl.aimPiece) {
      ph.classList.remove('hidden');
      const pc = ctl.aimPiece;
      ph.querySelector('i').style.width = (U.clamp(pc.hp / pc.max, 0, 1) * 100) + '%';
      ph.querySelector('span').textContent = Math.ceil(pc.hp) + ' / ' + pc.max;
    } else ph.classList.add('hidden');
    // top right info
    $('alive').textContent = G.mode === 'duel' ? '' : G.aliveCount();
    $('kills').textContent = me.kills;
    const s = G.storm;
    const si = $('storm-info');
    if (G.mode === 'br') {
      if (G.phase === 'bus') si.innerHTML = me.state === 'bus' ? `<i class="ic-bus"></i> Press <b>${Input.label(Input.binds.jump)}</b> to jump` : me.state === 'ground' ? '<i class="ic-storm"></i> The storm forms soon' : '<i class="ic-bus"></i> Skydiving';
      else if (s && s.st !== 'done' && s.st !== 'pre') si.innerHTML = `<i class="ic-storm ${s.st}"></i> ${s.st === 'wait' ? 'Storm eye shrinks' : 'Storm closing'} <b>${U.fmtTime(s.t)}</b>`;
      else si.innerHTML = '<i class="ic-storm"></i> Final circle';
    } else if (G.duel) {
      const ids = [...G.players.keys()];
      const opp = ids.find(i => i !== lid);
      const D = G.duel;
      si.innerHTML = `<span class="sc me">${D.scores[lid] || 0}</span><span class="vs">ROUND ${D.round} · FIRST TO ${D.to}</span><span class="sc opp">${D.scores[opp] || 0}</span>`;
    }
    // skydive altimeter
    const alt = $('alt');
    const flying = me.alive && (me.state === 'sky' || me.state === 'glide');
    alt.classList.toggle('hidden', !flying);
    if (flying) {
      const h = Math.max(0, me.alt !== undefined ? me.alt : me.y - G.T.h(me.x, me.z));
      const top = 260, H = 260;
      alt.querySelector('.me').style.bottom = (U.clamp(h / top, 0, 1) * H) + 'px';
      alt.querySelector('.mark').style.bottom = (PH.AUTO_GLIDE / top * H) + 'px';
      alt.querySelector('.lbl b').textContent = Math.round(h);
      const K = a => `<span class="k">${Input.label(Input.binds[a])}</span>`;
      let tip;
      if (me.state === 'sky') tip = `${K('jump')} open glider<br>${K('forward')} dive faster`;
      else tip = h > PH.AUTO_GLIDE + PH.REDEPLOY ? `${K('jump')} close glider` : 'Gliding';
      const tipEl = alt.querySelector('.tip');
      if (tipEl.dataset.t !== tip) { tipEl.innerHTML = tip; tipEl.dataset.t = tip; }
    }
    // storm distance warning
    const sw = $('storm-warn');
    if (s && s.st !== 'pre' && me.alive) {
      const d = Math.hypot(me.x - s.cx, me.z - s.cz) - s.r;
      if (d > 0) { sw.classList.remove('hidden'); sw.textContent = `In the storm — ${Math.ceil(d)}m to safety`; }
      else sw.classList.add('hidden');
    } else sw.classList.add('hidden');
    drawMinimap(p, ctl);
    if (ctl.mapOpen) drawBigMap(p);
    $('bigmap').classList.toggle('hidden', !ctl.mapOpen);
    // damage numbers
    for (let i = dmgNums.length - 1; i >= 0; i--) {
      const d = dmgNums[i];
      d.t += dt;
      const sp = Render.project({ x: d.x, y: d.y + d.t * 1.2, z: d.z });
      if (!sp || d.t > 0.9) { if (d.t > 0.9) { d.el.remove(); dmgNums.splice(i, 1); } else d.el.style.opacity = 0; continue; }
      d.el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%,-50%) scale(${1.25 - d.t * 0.4})`;
      d.el.style.opacity = d.t < 0.6 ? 1 : 1 - (d.t - 0.6) / 0.3;
    }
    // hurt direction indicators
    const hd = $('hurt-dirs');
    hurtDirs = hurtDirs.filter(h => (h.t -= dt) > 0);
    hd.innerHTML = hurtDirs.map(h => {
      const a = Math.atan2(h.x - p.x, -(h.z - p.z)) + ctl.yaw;
      return `<i style="transform: translate(-50%,-50%) rotate(${a}rad) translateY(-140px); opacity:${Math.min(1, h.t)}"></i>`;
    }).join('');
    // fps
    $('fps').classList.toggle('hidden', !SETTINGS.showFps);
    $('spectate').classList.toggle('hidden', me.alive || G.phase === 'end' || !ctl.spectating);
    if (ctl.spectating && ctl.specTarget) $('spectate').innerHTML = `Spectating <b>${U.esc(ctl.specTarget.name)}</b>`;
  }

  function drawMinimap(p, ctl) {
    const cv = $('minimap');
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const T = G.W.T;
    const zoom = G.mode === 'duel' ? 1.2 : 2.6;
    const span = T.size / zoom;
    const toM = v => v / T.size * mapSize;
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#1f5a7a'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    const sc = W / span;
    g.scale(sc, sc);
    g.translate(-p.x, -p.z);
    g.imageSmoothingEnabled = true;
    g.drawImage(mapImg, -T.half, -T.half, T.size, T.size);
    drawStorm(g, 1 / sc);
    drawMarkers(g, 1 / sc, p, ctl);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
    // compass N
    g.fillStyle = '#fff'; g.font = 'bold 14px Lilita One, sans-serif'; g.textAlign = 'center';
    g.fillText('N', W / 2, 16);
  }
  function drawStorm(g, px) {
    const s = G.storm;
    if (!s || s.st === 'pre') return;
    g.save();
    g.fillStyle = 'rgba(120,50,200,0.42)';
    g.beginPath(); g.rect(-2000, -2000, 4000, 4000); g.arc(s.cx, s.cz, Math.max(0.1, s.r), 0, Math.PI * 2, true); g.fill('evenodd');
    g.strokeStyle = 'rgba(200,140,255,0.95)'; g.lineWidth = 2.5 * px;
    g.beginPath(); g.arc(s.cx, s.cz, Math.max(0.1, s.r), 0, Math.PI * 2); g.stroke();
    if (s.st !== 'done') { g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2 * px; g.beginPath(); g.arc(s.tx, s.tz, Math.max(0.1, s.tr), 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
  function drawMarkers(g, px, p, ctl) {
    // bus path
    if (G.W.bus && G.phase === 'bus') {
      const b = G.W.bus;
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2 * px; g.setLineDash([6 * px, 5 * px]);
      g.beginPath(); g.moveTo(b.ax, b.az); g.lineTo(b.bx, b.bz); g.stroke(); g.setLineDash([]);
      const bp = G.busPos(Math.max(0, G.time - 3));
      g.fillStyle = '#ffc531'; g.beginPath(); g.arc(bp.x, bp.z, 6 * px, 0, 7); g.fill();
    }
    // allies/opponent in duel
    if (G.mode === 'duel') {
      for (const q of G.players.values()) if (q.id !== window.LOCAL_ID && q.alive) { g.fillStyle = '#ff5050'; g.beginPath(); g.arc(q.rx, q.rz, 4 * px, 0, 7); g.fill(); }
    }
    // marker
    if (ctl.marker) { g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(ctl.marker.x, ctl.marker.z, 5 * px, 0, 7); g.fill(); }
    // player arrow
    g.save();
    g.translate(p.x, p.z);
    g.rotate(-ctl.yaw);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5 * px;
    g.beginPath(); g.moveTo(0, -9 * px); g.lineTo(6 * px, 7 * px); g.lineTo(0, 3 * px); g.lineTo(-6 * px, 7 * px); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  function drawBigMap(p) {
    const cv = $('bigmap-canvas');
    const g = cv.getContext('2d');
    const W = cv.width;
    const T = G.W.T;
    const scale = W / T.size;
    g.save();
    g.clearRect(0, 0, W, W);
    g.fillStyle = '#1f5a7a'; g.fillRect(0, 0, W, W);
    g.scale(scale, scale);
    g.translate(T.half, T.half);
    g.drawImage(mapImg, -T.half, -T.half, T.size, T.size);
    drawStorm(g, 1 / scale);
    drawMarkers(g, 1 / scale, p, Main.ctl);
    g.restore();
    g.font = '600 15px Lilita One, sans-serif'; g.textAlign = 'center';
    for (const poi of G.W.pois) {
      const x = (poi.x + T.half) * scale, y = (poi.z + T.half) * scale;
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(poi.name.toUpperCase(), x, y);
      g.fillStyle = '#fff'; g.fillText(poi.name.toUpperCase(), x, y);
    }
  }

  return { init, start, stop, update, onEvent, centerMsg, toast, prerenderMap, weaponIcon, itemIcon, iconFor, get mapImg() { return mapImg; } };
})();
