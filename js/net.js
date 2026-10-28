'use strict';
// Online play over WebRTC (PeerJS). One player hosts and runs the simulation; others connect with a room code.

const Net = (() => {
  const PREFIX = 'buildfall-v' + NET_VER + '-';
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const N = {
    mode: 'off', peer: null, conns: new Map(), host: null, code: '', myId: 0, lobby: null,
    onLobby: null, onStart: null, onMsg: null, onError: null, onClose: null, nextPid: 2,
  };

  function genCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)]; return s; }
  function available() { return typeof Peer !== 'undefined'; }

  function hostRoom(me, cb) {
    if (!available()) { cb('Online play needs the PeerJS library, which did not load.'); return; }
    close();
    const code = genCode();
    N.mode = 'host'; N.code = code; N.myId = 1;
    N.lobby = { code, mode: 'br', bots: 20, diff: 1, rounds: 5, mats: 999, players: [{ id: 1, name: me.name, skin: me.skin, host: true }] };
    const peer = new Peer(PREFIX + code, { debug: 0 });
    N.peer = peer;
    let opened = false;
    peer.on('open', () => { opened = true; cb(null, code); });
    peer.on('connection', conn => {
      conn.on('open', () => {
        if (N.started || N.lobby.players.length >= 16 || (N.lobby.mode === 'duel' && N.lobby.players.length >= 2)) {
          conn.send({ t: 'deny', why: N.started ? 'That match already started.' : 'The lobby is full.' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        conn.pid = 0;
      });
      conn.on('data', d => onHostData(conn, d));
      conn.on('close', () => dropConn(conn));
      conn.on('error', () => dropConn(conn));
    });
    peer.on('error', e => {
      if (!opened && e.type === 'unavailable-id') { close(); hostRoom(me, cb); return; }
      if (!opened) cb(errText(e)); else if (N.onError) N.onError(errText(e));
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  }

  function errText(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'No room with that code. Check the code and try again.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking server. Check your internet connection.';
    if (t === 'browser-incompatible') return 'This browser does not support online play.';
    return 'Connection error' + (t ? ' (' + t + ')' : '') + '.';
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') {
      if (d.ver !== NET_VER) { conn.send({ t: 'deny', why: 'Your game version does not match the host. Refresh the page.' }); return; }
      if (conn.pid) return;
      const pid = N.nextPid++;
      conn.pid = pid;
      N.conns.set(pid, conn);
      N.lobby.players.push({ id: pid, name: String(d.name || 'Player').slice(0, 16), skin: (d.skin | 0) % SKINS.length });
      conn.send({ t: 'welcome', pid });
      pushLobby();
      return;
    }
    if (!conn.pid) return;
    if (N.onMsg) N.onMsg(conn.pid, d);
  }
  function dropConn(conn) {
    if (!conn.pid || !N.conns.has(conn.pid)) return;
    N.conns.delete(conn.pid);
    if (N.lobby) N.lobby.players = N.lobby.players.filter(p => p.id !== conn.pid);
    if (N.onMsg) N.onMsg(conn.pid, { t: 'left' });
    pushLobby();
  }
  function pushLobby() {
    if (N.mode !== 'host') return;
    broadcast({ t: 'lobby', lobby: N.lobby });
    if (N.onLobby) N.onLobby(N.lobby);
  }
  function setLobby(patch) { Object.assign(N.lobby, patch); pushLobby(); }

  function joinRoom(code, me, cb) {
    if (!available()) { cb('Online play needs the PeerJS library, which did not load.'); return; }
    close();
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    N.mode = 'client'; N.code = code;
    const peer = new Peer({ debug: 0 });
    N.peer = peer;
    let done = false;
    const fail = msg => { if (done) { if (N.onError) N.onError(msg); return; } done = true; close(); cb(msg); };
    const timer = setTimeout(() => fail('Timed out connecting to the host.'), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      N.host = conn;
      conn.on('open', () => conn.send({ t: 'hello', name: me.name, skin: me.skin, ver: NET_VER }));
      conn.on('data', d => {
        if (d.t === 'deny') { clearTimeout(timer); fail(d.why); return; }
        if (d.t === 'welcome') { clearTimeout(timer); done = true; N.myId = d.pid; cb(null, d.pid); return; }
        if (d.t === 'lobby') { N.lobby = d.lobby; if (N.onLobby) N.onLobby(d.lobby); return; }
        if (d.t === 'start') { if (N.onStart) N.onStart(d.cfg); return; }
        if (N.onMsg) N.onMsg(0, d);
      });
      conn.on('close', () => { if (N.mode === 'client' && N.onClose) N.onClose('The host left the game.'); });
      conn.on('error', () => { /* handled by close */ });
    });
    peer.on('error', e => { clearTimeout(timer); fail(errText(e)); });
  }

  function send(pid, msg) { const c = N.conns.get(pid); if (c && c.open) c.send(msg); }
  function broadcast(msg) { for (const c of N.conns.values()) if (c.open) c.send(msg); }
  function toHost(msg) { if (N.host && N.host.open) N.host.send(msg); }
  function startMatch(cfg) { N.started = true; for (const [pid, c] of N.conns) if (c.open) c.send({ t: 'start', cfg: { ...cfg, you: pid } }); }

  function close() {
    try { if (N.host) N.host.close(); } catch (e) { /* ignore */ }
    for (const c of N.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    try { if (N.peer) N.peer.destroy(); } catch (e) { /* ignore */ }
    N.peer = null; N.host = null; N.conns = new Map(); N.mode = 'off'; N.lobby = null; N.started = false; N.nextPid = 2;
  }

  return Object.assign(N, { hostRoom, joinRoom, send, broadcast, toHost, startMatch, close, setLobby, pushLobby, available });
})();
