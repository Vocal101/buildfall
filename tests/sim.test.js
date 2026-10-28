// Headless checks for world generation, building rules, movement and full bot matches.
// Run: node tests/sim.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, Math, Date, JSON, Map, Set, performance: { now: () => Date.now() } };
vm.createContext(ctx);
for (const f of ['util', 'config', 'world', 'build', 'physics', 'game', 'sim', 'bots']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const run = code => vm.runInContext(code, ctx);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// ---- world ----
run(`var W = World.genBR(12345); var W2 = World.genBR(12345);`);
ok(run('W.pois.length') >= 6, 'BR world has points of interest (' + run('W.pois.length') + ')');
ok(run('W.pieces.length') > 300, 'prebuilt houses generated (' + run('W.pieces.length') + ' pieces)');
ok(run('W.pieces.length === W2.pieces.length && W.loot.length === W2.loot.length && W.props.length === W2.props.length'), 'world generation is deterministic');
ok(run('W.chests.length') > 15, 'chests placed (' + run('W.chests.length') + ')');
ok(run('new Set(W.pieces.map(p => Build.keyOf(p))).size === W.pieces.length'), 'no two prebuilt pieces share a slot');

// ---- building ----
run(`var G = new Game({ mode: 'duel', seed: 7, players: [{ id: 1, name: 'A', human: true }, { id: 2, name: 'B', human: false }], rounds: 3, mats: 999 });
var H = new Host(G); var me = G.players.get(1); var gy = Math.round(G.T.h(0, 0) / S);`);
ok(run(`G.structs.check({ type: 'wall', axis: 'z', gx: 0, gy, gz: 0, mat: 0 }) === ''`), 'grounded wall is valid');
ok(run(`G.structs.check({ type: 'wall', axis: 'z', gx: 0, gy: gy + 3, gz: 0, mat: 0 }) === 'No support'`), 'floating wall is rejected');
run(`G.duel.state = 'fight'; me.x = 2; me.z = 2; me.y = G.T.h(2, 2); me.inv.mats = [999, 999, 999];
H.handleAction(1, { a: 'build', t: 'wall', gx: 0, gy, gz: 0, ax: 'z', m: 0 });`);
ok(run(`G.structs.map.has('Z0,' + gy + ',0')`), 'host accepts a valid wall');
ok(run(`me.inv.mats[0] === 989`), 'building costs 10 materials');
run(`H.handleAction(1, { a: 'build', t: 'wall', gx: 0, gy, gz: 0, ax: 'z', m: 1 });`);
ok(run(`me.inv.mats[1] === 999`), 'cannot build into an occupied slot');
run(`H.handleAction(1, { a: 'build', t: 'ramp', gx: 0, gy, gz: 0, dir: 0, m: 0 }); H.handleAction(1, { a: 'build', t: 'cone', gx: 0, gy, gz: 0, m: 0 });`);
ok(run(`G.structs.get('V0,' + gy + ',0').type === 'ramp' && me.inv.mats[0] === 979`), 'ramp and roof share a cell slot (no overlap)');
// support chain + collapse
run(`me.y = (gy + 2) * S; for (let i = 1; i <= 3; i++) H.handleAction(1, { a: 'build', t: 'wall', gx: 0, gy: gy + i, gz: 0, ax: 'z', m: 0 }); me.y = G.T.h(2, 2);`);
ok(run(`G.structs.map.has('Z0,' + (gy + 3) + ',0')`), 'stacked walls supported by the one below');
run(`H.destroyPiece(G.structs.get('Z0,' + gy + ',0'), 'destroy'); H.destroyPiece(G.structs.get('V0,' + gy + ',0'), 'destroy');`);
ok(run(`!G.structs.map.has('Z0,' + (gy + 3) + ',0')`), 'unsupported pieces collapse when their base breaks');
// edits
run(`H.handleAction(1, { a: 'build', t: 'wall', gx: 2, gy, gz: 0, ax: 'z', m: 0 });
H.handleAction(1, { a: 'edit', k: 'Z2,' + gy + ',0', mask: World.DOOR });`);
ok(run(`G.structs.get('Z2,' + gy + ',0').mask === World.DOOR && G.structs.get('Z2,' + gy + ',0').cb.length > 1`), 'wall edit cuts a door');
run(`H.handleAction(1, { a: 'edit', k: 'Z2,' + gy + ',0', mask: 511 });`);
ok(run(`G.structs.get('Z2,' + gy + ',0').mask === World.DOOR`), 'removing every tile is rejected');
run(`H.handleAction(2, { a: 'edit', k: 'Z2,' + gy + ',0', mask: 0 });`);
ok(run(`G.structs.get('Z2,' + gy + ',0').mask === World.DOOR`), "cannot edit an opponent's build");

// ---- movement ----
run(`var P = { x: 10.5, y: G.T.h(10.5, 10.5) + 2, z: 10.5, vx: 0, vy: 0, vz: 0, state: 'ground', onGround: false };
for (let i = 0; i < 60; i++) Phys.step(G, P, { yaw: 0 }, 1 / 60);`);
ok(run('P.onGround && Math.abs(P.y - G.T.h(P.x, P.z)) < 0.05'), 'player lands on the ground');
// walk into a wall: should be blocked
run(`H.handleAction(1, { a: 'build', t: 'wall', gx: 2, gy, gz: 2, ax: 'z', m: 0 });
P.x = 10; P.z = 11; P.y = G.T.h(10, 11) + 0.05; P.vx = P.vz = 0;
for (let i = 0; i < 120; i++) Phys.step(G, P, { yaw: 0, mz: 1 }, 1 / 60);`);
ok(run('P.z > 8.1'), 'walls block movement (z=' + run('P.z.toFixed(2)') + ')');
// walk up a ramp onto a floor
run(`var gy2 = Math.round(G.T.h(-20, -20) / S); me.x = -18; me.z = -21; me.y = G.T.h(-18, -21);
H.handleAction(1, { a: 'build', t: 'ramp', gx: -5, gy: gy2, gz: -5, dir: 0, m: 0 });
H.handleAction(1, { a: 'build', t: 'floor', gx: -5, gy: gy2 + 1, gz: -4, m: 0 });
P.x = -18; P.z = -20.5; P.y = G.T.h(-18, -20.5) + 0.05; P.vx = P.vz = 0; P.onGround = true;
for (let i = 0; i < 80; i++) Phys.step(G, P, { yaw: Math.PI, mz: 1 }, 1 / 60);`);
ok(run('P.y > (gy2 + 1) * S'), 'player climbs a ramp onto a floor (y=' + run('P.y.toFixed(2)') + ')');
// ramp rush targeting: standing on a ramp facing its direction targets the next cell one level up
run(`P.x = -18; P.z = -18.6; P.y = Build.surfaceAt(G.structs.get('V-5,' + gy2 + ',-5'), -18, -18.6);
var sup = Phys.supportBelow(G, P.x, P.y + 0.1, P.z, 3.5); var tg = Build.target('ramp', P, Math.PI, 0, 0, sup);`);
ok(run('tg.gz === -4 && tg.gy === gy2 + 1 && tg.dir === 0'), 'ramp rush places the next ramp ahead and one level up');

// ---- full matches ----
function match(mode, n, secs) {
  run(`var players = [{ id: 1, name: 'Bot1', human: false, diff: 2 }];
  for (let i = 0; i < ${n - 1}; i++) players.push({ id: 100 + i, name: 'B' + i, human: false, diff: i % 3 });
  var MG = new Game({ mode: '${mode}', seed: ${Math.floor(Math.random() * 1e6)}, players, rounds: 3, mats: 500 });
  var MH = new Host(MG); var t0 = Date.now(); var errs = [];
  try { for (let i = 0; i < ${secs * 60} && !MH.ended; i++) { MH.tick(1 / 60); MH.drain(); } } catch (e) { errs.push(e.stack); }`);
  return run(`({ ended: MH.ended, time: Math.round(MG.time), alive: MG.aliveCount(), ms: Date.now() - t0, errs, builds: [...MG.structs.map.values()].filter(p => !p.world).length, kills: [...MG.players.values()].reduce((a, p) => a + p.kills, 0), storm: MG.storm && MG.storm.i, scores: MG.duel && MG.duel.scores })`);
}
const br = match('br', 20, 900);
console.log('     BR:', JSON.stringify(br));
ok(!br.errs.length, 'battle royale runs without errors' + (br.errs[0] ? '\n' + br.errs[0] : ''));
ok(br.ended, 'battle royale ends with a winner (t=' + br.time + 's)');
ok(br.kills >= 5, 'bots eliminate each other (' + br.kills + ' kills)');
ok(br.builds > 10, 'bots build during fights (' + br.builds + ' pieces)');
const du = match('duel', 2, 600);
console.log('     1v1:', JSON.stringify(du));
ok(!du.errs.length, '1v1 runs without errors' + (du.errs[0] ? '\n' + du.errs[0] : ''));
ok(du.ended, '1v1 finishes all rounds (t=' + du.time + 's)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
