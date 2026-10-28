'use strict';
// Menus: main, mode setup, online lobby, locker, settings with keybind editor, pause, banners.

const Menus = (() => {
  const $ = id => document.getElementById(id);
  let root, current = 'main', settingsTab = 'game', settingsBack = 'main';
  const DIFFS = ['Easy', 'Normal', 'Hard'];

  function init() {
    root = $('menus');
    root.addEventListener('mouseover', e => { if (e.target.closest('button')) Sfx.play('uiHover'); });
    root.addEventListener('click', e => { if (e.target.closest('button')) { Sfx.resume(); Sfx.play('ui'); } });
    show('main');
    if (!Net.available()) console.warn('PeerJS missing: online play disabled');
  }
  function hideAll() { root.classList.add('hidden'); root.innerHTML = ''; }
  function panel(html, cls = '') { root.classList.remove('hidden'); root.innerHTML = `<div class="menu ${cls}">${html}</div>`; }
  const btn = (id, label, cls = '', extra = '') => `<button id="${id}" class="btn ${cls}" ${extra}>${label}</button>`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

  function show(name, arg) {
    current = name;
    document.body.classList.toggle('in-menu', true);
    ({ main, br, duel, online, lobby, locker, settings, stats, help })[name](arg);
  }

  function logo() {
    return `<div class="logo"><span class="l1">BUILD</span><span class="l2">FALL</span><div class="tag">Battle Royale · Build Fights · Online</div></div>`;
  }

  function main() {
    panel(`${logo()}
      <div class="main-btns">
        ${btn('m-br', '<b>Battle Royale</b><small>Drop in. Loot up. Be the last one standing.</small>', 'big primary')}
        ${btn('m-duel', '<b>1v1 Build Fight</b><small>Full mats, full loadout, first to win the rounds.</small>', 'big')}
        ${btn('m-online', '<b>Play Online</b><small>Host a room or join friends with a code.</small>', 'big')}
        <div class="row3">
          ${btn('m-locker', 'Locker')}${btn('m-settings', 'Settings')}${btn('m-stats', 'Career')}${btn('m-help', 'How to Play')}
        </div>
      </div>
      ${matchMedia('(pointer: coarse)').matches ? '<p class="warn">Buildfall is played with a keyboard and mouse.</p>' : ''}
      <div class="foot">v${VERSION} · <span class="dim">Playing as</span> <b>${U.esc(SETTINGS.name)}</b></div>`, 'main');
    on('m-br', () => show('br'));
    on('m-duel', () => show('duel'));
    on('m-online', () => show('online'));
    on('m-locker', () => show('locker'));
    on('m-settings', () => { settingsBack = 'main'; show('settings'); });
    on('m-stats', () => show('stats'));
    on('m-help', () => show('help'));
  }

  function seg(id, opts, val) {
    return `<div class="seg" id="${id}">${opts.map((o, i) => `<button class="${(o.v !== undefined ? o.v : i) === val ? 'on' : ''}" data-v="${o.v !== undefined ? o.v : i}">${o.l || o}</button>`).join('')}</div>`;
  }
  function bindSeg(id, fn) {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => b.onclick = () => { el.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v); });
  }

  function br() {
    const s = SETTINGS.br;
    panel(`<h2>Battle Royale</h2>
      <p class="lead">Ride the Battle Blimp across the island and jump when you like. Loot weapons, harvest materials and build to survive. The storm keeps shrinking until one player is left.</p>
      <label class="field">Players <span class="val" id="bots-v">${s.bots + 1}</span><input type="range" id="bots" min="4" max="59" value="${s.bots}"></label>
      <div class="field">Bot skill ${seg('diff', DIFFS, s.diff)}</div>
      <div class="actions">${btn('back', 'Back')}${btn('go', 'Drop In', 'primary')}</div>`, 'narrow');
    $('bots').oninput = e => { s.bots = +e.target.value; $('bots-v').textContent = s.bots + 1; saveSettings(); };
    bindSeg('diff', v => { s.diff = v; saveSettings(); });
    on('back', () => show('main'));
    on('go', () => Main.startOffline('br'));
  }
  function duel() {
    const s = SETTINGS.duel;
    panel(`<h2>1v1 Build Fight</h2>
      <p class="lead">You and a CPU opponent start with full health, full shields, a Legendary loadout and a big stack of materials. Win a round by eliminating the other player. The zone closes in after 40 seconds.</p>
      <div class="field">First to ${seg('rounds', [{ l: '3', v: 3 }, { l: '5', v: 5 }, { l: '7', v: 7 }], s.rounds)}</div>
      <div class="field">Materials ${seg('mats', [{ l: '300', v: 300 }, { l: '500', v: 500 }, { l: '999', v: 999 }], s.mats)}</div>
      <div class="field">Opponent ${seg('diff', DIFFS, s.diff)}</div>
      <div class="actions">${btn('back', 'Back')}${btn('go', 'Start Fight', 'primary')}</div>`, 'narrow');
    bindSeg('rounds', v => { s.rounds = v; saveSettings(); });
    bindSeg('mats', v => { s.mats = v; saveSettings(); });
    bindSeg('diff', v => { s.diff = v; saveSettings(); });
    on('back', () => show('main'));
    on('go', () => Main.startOffline('duel'));
  }

  function online() {
    const ok = Net.available();
    panel(`<h2>Play Online</h2>
      <p class="lead">One player hosts and shares the room code. Everyone else types the code to join. Hosted matches run on the host's computer, so the host should have the best connection.</p>
      ${ok ? '' : '<p class="warn">Online play could not load. Check your internet connection and refresh the page.</p>'}
      <div class="field">Your name <input type="text" id="nm" maxlength="16" value="${U.esc(SETTINGS.name)}"></div>
      <div class="online-split">
        <div class="card"><h3>Host a room</h3><p class="dim">Create a lobby and invite friends.</p>${btn('host', 'Create Room', 'primary', ok ? '' : 'disabled')}</div>
        <div class="card"><h3>Join a room</h3><input type="text" id="code" maxlength="6" placeholder="CODE" autocomplete="off" spellcheck="false">${btn('join', 'Join', '', ok ? '' : 'disabled')}</div>
      </div>
      <div class="status" id="st"></div>
      <div class="actions">${btn('back', 'Back')}</div>`, 'narrow');
    $('nm').oninput = e => { SETTINGS.name = e.target.value.trim().slice(0, 16) || SETTINGS.name; saveSettings(); };
    $('code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
    on('back', () => { Net.close(); show('main'); });
    on('host', () => {
      $('st').textContent = 'Creating room…';
      Net.hostRoom({ name: SETTINGS.name, skin: SETTINGS.skin }, (err, code) => {
        if (err) { $('st').innerHTML = `<span class="warn">${U.esc(err)}</span>`; return; }
        Net.setLobby({ bots: Math.min(SETTINGS.br.bots, 40), diff: SETTINGS.br.diff, rounds: SETTINGS.duel.rounds, mats: SETTINGS.duel.mats });
        show('lobby');
      });
    });
    on('join', () => {
      const code = $('code').value.trim();
      if (code.length < 4) { $('st').innerHTML = '<span class="warn">Enter the room code from your host.</span>'; return; }
      $('st').textContent = 'Connecting…';
      Net.onStart = cfg => Main.startOnline(cfg, false);
      Net.onClose = why => { if (current === 'lobby') { show('online'); $('st').innerHTML = `<span class="warn">${U.esc(why)}</span>`; } };
      Net.joinRoom(code, { name: SETTINGS.name, skin: SETTINGS.skin }, err => {
        if (err) { $('st').innerHTML = `<span class="warn">${U.esc(err)}</span>`; return; }
        show('lobby');
      });
    });
  }

  function lobby() {
    const isHost = Net.mode === 'host';
    const render = L => {
      if (current !== 'lobby' || !L) return;
      const humans = L.players.length;
      const total = L.mode === 'br' ? humans + L.bots : 2;
      panel(`<h2>Lobby</h2>
        <div class="code-box"><span class="dim">Room code</span><b id="code">${U.esc(L.code)}</b>${btn('copy', 'Copy', 'small')}</div>
        <div class="lobby-grid">
          <div class="card"><h3>Players (${humans}${L.mode === 'duel' ? '/2' : ''})</h3>
            <ul class="plist">${L.players.map(p => `<li><i style="background:#${SKINS[p.skin % SKINS.length].suit.toString(16).padStart(6, '0')}"></i>${U.esc(p.name)}${p.host ? ' <span class="tagh">HOST</span>' : ''}${p.id === Net.myId ? ' <span class="dim">(you)</span>' : ''}</li>`).join('')}</ul>
          </div>
          <div class="card"><h3>Match</h3>
            ${isHost ? `<div class="field">Mode ${seg('lmode', [{ l: 'Battle Royale', v: 'br' }, { l: '1v1', v: 'duel' }], L.mode)}</div>` : `<p>Mode: <b>${L.mode === 'br' ? 'Battle Royale' : '1v1 Build Fight'}</b></p>`}
            ${L.mode === 'br' ? (isHost ? `<label class="field">Bots <span class="val" id="lb-v">${L.bots}</span><input type="range" id="lbots" min="0" max="45" value="${L.bots}"></label><div class="field">Bot skill ${seg('ldiff', DIFFS, L.diff)}</div>` : `<p>Bots: <b>${L.bots}</b> (${DIFFS[L.diff]})</p>`) : (isHost ? `<div class="field">First to ${seg('lrounds', [{ l: '3', v: 3 }, { l: '5', v: 5 }, { l: '7', v: 7 }], L.rounds)}</div>` : `<p>First to <b>${L.rounds}</b></p>`)}
            <p class="dim">${L.mode === 'br' ? total + ' players total' : (humans < 2 ? 'Waiting for an opponent…' : 'Ready!')}</p>
          </div>
        </div>
        <div class="actions">${btn('leave', 'Leave')}${isHost ? btn('start', 'Start Match', 'primary', (L.mode === 'duel' && humans !== 2) || (L.mode === 'br' && humans + L.bots < 2) ? 'disabled' : '') : '<span class="dim">Waiting for the host to start…</span>'}</div>`, 'wide');
      on('copy', () => { navigator.clipboard && navigator.clipboard.writeText(L.code); $('copy').textContent = 'Copied!'; });
      on('leave', () => { Net.close(); show('online'); });
      if (isHost) {
        bindSeg('lmode', v => { if (v === 'duel' && L.players.length > 2) { Hud.toast('1v1 needs exactly 2 players', 'warn'); render(L); return; } Net.setLobby({ mode: v }); });
        if ($('lbots')) $('lbots').oninput = e => { $('lb-v').textContent = e.target.value; };
        if ($('lbots')) $('lbots').onchange = e => Net.setLobby({ bots: +e.target.value });
        if ($('ldiff')) bindSeg('ldiff', v => Net.setLobby({ diff: v }));
        if ($('lrounds')) bindSeg('lrounds', v => Net.setLobby({ rounds: v }));
        on('start', () => startHosted(L));
      }
    };
    Net.onLobby = render;
    render(Net.lobby);
  }
  function startHosted(L) {
    const seed = (Math.random() * 1e9) | 0;
    const players = L.players.map(p => ({ id: p.id, name: p.name, skin: p.skin, human: true }));
    if (L.mode === 'br') for (let i = 0; i < L.bots; i++) players.push(Main.botDef(100 + i, i, L.diff));
    const cfg = { mode: L.mode, seed, players, rounds: L.rounds, mats: L.mats };
    Net.startMatch(cfg);
    Main.startOnline({ ...cfg, you: Net.myId }, true);
  }

  function locker() {
    const hex6 = c => '#' + c.toString(16).padStart(6, '0');
    const pics = Character.portraitAll();
    panel(`<h2>Locker</h2>
      <div class="field">Display name <input type="text" id="nm" maxlength="16" value="${U.esc(SETTINGS.name)}"></div>
      <div class="skins">${SKINS.map((s, i) => `<button class="skin ${i === SETTINGS.skin ? 'on' : ''}${s.style && s.style.mask ? ' masked' : ''}" data-i="${i}"><i style="--c1:${hex6(s.suit)};--c2:${hex6(s.accent)}">${pics[i] ? `<img src="${pics[i]}" alt="">` : ''}</i><span>${s.name}</span></button>`).join('')}</div>
      <div class="actions">${btn('back', 'Done', 'primary')}</div>`, 'narrow locker');
    $('nm').oninput = e => { const v = e.target.value.trim().slice(0, 16); if (v) { SETTINGS.name = v; saveSettings(); } };
    root.querySelectorAll('.skin').forEach(b => b.onclick = () => {
      SETTINGS.skin = +b.dataset.i; saveSettings();
      root.querySelectorAll('.skin').forEach(x => x.classList.toggle('on', x === b));
      Main.placeMenuAvatar();
    });
    on('back', () => show('main'));
  }

  function stats() {
    const s = STATS;
    panel(`<h2>Career</h2>
      <div class="stat-grid">
        <div><b>${s.matches}</b><span>Matches</span></div>
        <div><b>${s.wins}</b><span>Victories</span></div>
        <div><b>${s.kills}</b><span>Eliminations</span></div>
        <div><b>${s.best ? '#' + s.best : '—'}</b><span>Best Place</span></div>
        <div><b>${s.duelWins}/${s.duels}</b><span>1v1 Wins</span></div>
        <div><b>${s.builds}</b><span>Pieces Built</span></div>
      </div>
      <div class="actions">${btn('back', 'Back')}</div>`, 'narrow');
    on('back', () => show('main'));
  }

  function help() {
    const L = a => `<kbd>${Input.label(Input.binds[a])}</kbd>`;
    panel(`<h2>How to Play</h2>
      <div class="help">
        <div><h4>Moving</h4><p>${L('forward')}${L('left')}${L('back')}${L('right')} move, ${L('jump')} jump, ${L('sprint')} sprint. On the blimp, press ${L('jump')} to jump out. You free fall first: hold ${L('forward')} to dive faster and press ${L('jump')} to open your glider. It opens by itself ${PH.AUTO_GLIDE} m above the ground. Falls of more than two storeys on foot cause damage.</p></div>
        <div><h4>Fighting</h4><p>${L('fire')} fire, ${L('aim')} aim, ${L('reload')} reload. ${L('pickaxe')} is your harvesting tool; ${L('slot1')}–${L('slot5')} pick inventory slots. ${L('interact')} picks up loot and opens chests. Hit the glowing weak points when harvesting for bonus damage.</p></div>
        <div><h4>Building</h4><p>${L('wall')} wall, ${L('floor')} floor, ${L('ramp')} stairs, ${L('cone')} roof. ${L('place')} places the piece, and holding it builds continuously. ${L('changeMat')} switches between wood, brick and metal. ${L('rotate')} rotates stairs. Every piece snaps to the grid and must touch the ground or another build.</p></div>
        <div><h4>Editing</h4><p>Aim at your build and press ${L('edit')}. Click or drag across tiles to cut doors, windows and arches. ${L('resetEdit')} resets the piece. Releasing confirms the edit (you can turn that off in Settings). On stairs, drag across tiles to change their direction.</p></div>
        <div><h4>Weapons &amp; rarity</h4><p>${Object.keys(WEAPONS).length} weapons across 6 rarities: <span style="color:${RARITY[0].color}">Common</span>, <span style="color:${RARITY[1].color}">Uncommon</span>, <span style="color:${RARITY[2].color}">Rare</span>, <span style="color:${RARITY[3].color}">Epic</span>, <span style="color:${RARITY[4].color}">Legendary</span> and the chest-only <span style="color:${RARITY[5].color}">Mythic</span> weapons. Higher rarity means more damage and faster reloads.</p></div>
        <div><h4>The storm</h4><p>The white circle on the map shows the next safe zone. Standing in the storm drains your health, and the damage grows each phase.</p></div>
      </div>
      <div class="actions">${btn('back', 'Back')}${btn('keys', 'Change Keybinds')}</div>`, 'wide');
    on('back', () => show('main'));
    on('keys', () => { settingsTab = 'controls'; settingsBack = 'help'; show('settings'); });
  }

  // ---------- settings ----------
  function settings() {
    const S_ = SETTINGS;
    const tabs = [['game', 'Game'], ['controls', 'Keybinds'], ['video', 'Video'], ['audio', 'Audio']];
    let body = '';
    const slider = (id, label, min, max, step, val, fmt = v => v) => `<label class="field">${label} <span class="val" id="${id}-v">${fmt(val)}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
    const toggle = (id, label, val, desc = '') => `<label class="toggle"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}><span class="sw"></span><span class="tl">${label}${desc ? `<small>${desc}</small>` : ''}</span></label>`;
    if (settingsTab === 'game') {
      body = `${slider('sens', 'Look sensitivity', 0.1, 3, 0.05, S_.sens, v => (+v).toFixed(2))}
        ${slider('adsSens', 'Aim sensitivity (multiplier)', 0.1, 1.5, 0.05, S_.adsSens, v => (+v).toFixed(2))}
        ${slider('scopeSens', 'Scope sensitivity (multiplier)', 0.1, 1.5, 0.05, S_.scopeSens, v => (+v).toFixed(2))}
        ${slider('buildSens', 'Build mode sensitivity (multiplier)', 0.3, 2, 0.05, S_.buildSens, v => (+v).toFixed(2))}
        ${slider('editSens', 'Edit mode sensitivity (multiplier)', 0.3, 2, 0.05, S_.editSens, v => (+v).toFixed(2))}
        ${toggle('invertY', 'Invert vertical look', S_.invertY)}
        ${toggle('editOnRelease', 'Confirm edit on release', S_.editOnRelease, 'Edits apply as soon as you let go of Select Edit Tile.')}
        ${toggle('resetOnEditStart', 'Start edits from a blank piece', S_.resetOnEditStart, 'Ignores the existing edit when you start editing a piece.')}
        ${toggle('turboBuild', 'Turbo building', S_.turboBuild, 'Hold Place Build to keep placing pieces.')}
        ${toggle('autoMat', 'Auto material change', S_.autoMat, 'Switch to another material when you run out.')}
        ${toggle('autoSprint', 'Sprint by default', S_.autoSprint, 'Hold the sprint key to walk instead.')}
        ${toggle('showNames', 'Show player names', S_.showNames !== false)}`;
    } else if (settingsTab === 'controls') {
      const groups = {};
      for (const a of ACTIONS) (groups[a.group] = groups[a.group] || []).push(a);
      const conflicts = findConflicts();
      body = `<p class="dim">Click a key to rebind it, then press any key, mouse button or wheel direction. Press Esc to cancel.</p><div class="binds">` + Object.entries(groups).map(([g, list]) => `<h4>${g}</h4>` + list.map(a => `<div class="bind ${conflicts.has(a.id) ? 'conflict' : ''}"><span>${a.label}</span><button class="key" data-a="${a.id}">${Input.label(Input.binds[a.id])}</button><button class="rst small" data-r="${a.id}" title="Reset">↺</button></div>`).join('')).join('') + `</div>
        <div class="actions left">${btn('rst-all', 'Reset All Keybinds')}</div>`;
    } else if (settingsTab === 'video') {
      body = `<div class="field">Quality ${seg('quality', [{ l: 'Low', v: 'low' }, { l: 'Medium', v: 'medium' }, { l: 'High', v: 'high' }], S_.quality)}</div>
        ${slider('fov', 'Field of view', 70, 110, 1, S_.fov)}
        ${slider('renderScale', 'Resolution scale', 0.5, 1, 0.05, S_.renderScale, v => Math.round(v * 100) + '%')}
        ${toggle('shadows', 'Shadows', S_.shadows)}
        ${toggle('grass', 'Grass', S_.grass)}
        ${toggle('showFps', 'Show FPS', S_.showFps)}
        <label class="field">Crosshair color <input type="color" id="crosshair" value="${S_.crosshair}"></label>`;
    } else {
      body = `${slider('volume', 'Master volume', 0, 1, 0.01, S_.volume, v => Math.round(v * 100) + '%')}`;
    }
    const inGame = Main.state === 'game';
    panel(`<h2>Settings</h2>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === settingsTab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
      <div class="tab-body">${body}</div>
      <div class="actions">${btn('back', inGame ? 'Back' : 'Done', 'primary')}</div>`, 'wide settings' + (inGame ? ' ingame' : ''));
    root.querySelectorAll('.tab').forEach(t => t.onclick = () => { settingsTab = t.dataset.t; settings(); });
    on('back', () => { if (inGame) pause(Main.online); else show(settingsBack); });
    const num = ['sens', 'adsSens', 'scopeSens', 'buildSens', 'editSens', 'fov', 'renderScale', 'volume'];
    for (const k of num) if ($(k)) $(k).oninput = e => {
      S_[k] = +e.target.value;
      const v = $(k + '-v');
      if (v) v.textContent = k === 'volume' || k === 'renderScale' ? Math.round(S_[k] * 100) + '%' : k === 'fov' ? S_[k] : S_[k].toFixed(2);
      if (k === 'volume') Sfx.setVolume(S_[k]);
      if (k === 'renderScale') Render.resize();
      saveSettings();
    };
    for (const k of ['invertY', 'editOnRelease', 'resetOnEditStart', 'turboBuild', 'autoMat', 'autoSprint', 'showNames', 'shadows', 'grass', 'showFps']) if ($(k)) $(k).onchange = e => {
      S_[k] = e.target.checked; saveSettings();
      if (k === 'shadows') Render.setQuality(S_.quality, S_.shadows);
    };
    if ($('quality')) bindSeg('quality', v => { S_.quality = v; saveSettings(); Render.setQuality(v, S_.shadows); });
    if ($('crosshair')) $('crosshair').oninput = e => { S_.crosshair = e.target.value; saveSettings(); };
    root.querySelectorAll('.bind .key').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      b.textContent = 'Press a key…';
      b.classList.add('listening');
      setTimeout(() => Input.captureNext(code => {
        if (code) { SETTINGS.binds[b.dataset.a] = code; saveSettings(); Input.setBinds(SETTINGS.binds); }
        settings();
      }), 50);
    });
    root.querySelectorAll('.bind .rst').forEach(b => b.onclick = () => { delete SETTINGS.binds[b.dataset.r]; saveSettings(); Input.setBinds(SETTINGS.binds); settings(); });
    on('rst-all', () => { SETTINGS.binds = {}; saveSettings(); Input.setBinds({}); settings(); });
  }
  // actions that share a key within a context that can be active at the same time
  function findConflicts() {
    // 'move' actions work in every mode; combat, build and edit actions never overlap each other
    const out = new Set();
    for (const a of ACTIONS) for (const b of ACTIONS) {
      if (a.id >= b.id || Input.binds[a.id] !== Input.binds[b.id]) continue;
      if (a.ctx === b.ctx || a.ctx === 'move' || b.ctx === 'move') { out.add(a.id); out.add(b.id); }
    }
    return out;
  }

  function pause(isOnline) {
    current = 'pause';
    Input.unlock();
    panel(`<h2>${isOnline ? 'Menu' : 'Paused'}</h2>
      ${isOnline ? '<p class="dim">The match keeps running while this menu is open.</p>' : ''}
      <div class="pause-btns">${btn('resume', 'Resume', 'primary')}${btn('set', 'Settings')}${btn('keys', 'Keybinds')}${btn('quit', 'Leave Match', 'danger')}</div>`, 'narrow pause');
    on('resume', () => Main.resume());
    on('set', () => { settingsTab = 'game'; settings(); });
    on('keys', () => { settingsTab = 'controls'; settings(); });
    on('quit', () => Main.leave());
  }

  function banner(html, buttons) {
    const b = $('banner');
    b.innerHTML = `<div class="banner-in">${html}<div class="actions">${buttons.map((x, i) => `<button class="btn ${x.primary ? 'primary' : ''}" data-i="${i}">${x.label}</button>`).join('')}</div></div>`;
    b.classList.remove('hidden');
    b.querySelectorAll('button').forEach(el => el.onclick = () => { Sfx.play('ui'); buttons[+el.dataset.i].fn(); });
  }
  function hideBanner() { $('banner').classList.add('hidden'); $('banner').innerHTML = ''; }

  return { init, show, hideAll, pause, banner, hideBanner };
})();
