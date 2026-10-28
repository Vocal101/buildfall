'use strict';
// Synthesized sound effects (WebAudio). No audio files needed.

const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null, comp = null;
  let vol = 0.7;
  let listener = { x: 0, y: 0, z: 0, yaw: 0 };
  let stormNode = null, windNode = null;

  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = vol;
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { vol = v; if (master) master.gain.value = v; }
  function setListener(x, y, z, yaw) { listener = { x, y, z, yaw }; }

  // returns output node routed with distance attenuation + stereo pan
  function out(pos, gain = 1, range = 60) {
    const g = ctx.createGain();
    let level = gain;
    let pan = 0;
    if (pos) {
      const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
      const d = Math.hypot(dx, dy, dz);
      level *= 1 / (1 + (d / range) * (d / range) * 3);
      if (level < 0.004) return null;
      const rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
      pan = U.clamp((dx * rx + dz * rz) / Math.max(1, d), -1, 1) * 0.75;
    }
    g.gain.value = level;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(master);
    } else g.connect(master);
    return g;
  }
  function noise(dst, t, dur, f0, f1, q = 1, type = 'bandpass', g0 = 1, attack = 0.002) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dst);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  function tone(dst, t, dur, f0, f1, type = 'sine', g0 = 0.5, attack = 0.003) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(g0, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dst);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const SHOTS = {
    rifle: (d, t) => { noise(d, t, 0.16, 3000, 500, 0.8, 'lowpass', 0.9); tone(d, t, 0.08, 180, 60, 'triangle', 0.5); noise(d, t + 0.01, 0.35, 900, 200, 0.5, 'lowpass', 0.25); },
    smg: (d, t) => { noise(d, t, 0.09, 4000, 800, 0.8, 'lowpass', 0.7); tone(d, t, 0.05, 220, 80, 'triangle', 0.35); },
    pistol: (d, t) => { noise(d, t, 0.12, 3500, 600, 0.9, 'lowpass', 0.8); tone(d, t, 0.06, 260, 90, 'triangle', 0.4); },
    heavy: (d, t) => { noise(d, t, 0.25, 2200, 250, 0.7, 'lowpass', 1); tone(d, t, 0.14, 140, 40, 'sawtooth', 0.4); noise(d, t + 0.02, 0.5, 600, 100, 0.5, 'lowpass', 0.3); },
    shotgun: (d, t) => { noise(d, t, 0.35, 2000, 150, 0.6, 'lowpass', 1); tone(d, t, 0.18, 110, 35, 'sawtooth', 0.55); noise(d, t + 0.35, 0.08, 1800, 900, 3, 'bandpass', 0.25); noise(d, t + 0.5, 0.06, 1500, 800, 3, 'bandpass', 0.22); },
    sniper: (d, t) => { noise(d, t, 0.5, 5000, 200, 0.6, 'lowpass', 1); tone(d, t, 0.2, 300, 40, 'sawtooth', 0.5); noise(d, t + 0.05, 1.2, 700, 80, 0.4, 'lowpass', 0.35); },
    rocket: (d, t) => { noise(d, t, 0.6, 600, 2500, 0.8, 'bandpass', 0.8, 0.05); tone(d, t, 0.4, 90, 200, 'sawtooth', 0.25, 0.04); },
    gl: (d, t) => { noise(d, t, 0.15, 900, 300, 1, 'lowpass', 0.8); tone(d, t, 0.12, 160, 70, 'square', 0.3); },
  };

  function play(name, pos, opt = {}) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const near = !pos;
    let d;
    switch (name) {
      case 'shot': {
        d = out(pos, near ? 0.55 : 0.9, 140); if (!d) return;
        (SHOTS[opt.s] || SHOTS.rifle)(d, t); break;
      }
      case 'build': {
        d = out(pos, 0.45, 40); if (!d) return;
        const m = opt.m || 0;
        if (m === 0) { noise(d, t, 0.12, 900, 300, 2, 'bandpass', 1); tone(d, t, 0.1, 220, 120, 'triangle', 0.5); }
        else if (m === 1) { noise(d, t, 0.16, 600, 150, 1.5, 'lowpass', 1); tone(d, t, 0.12, 120, 60, 'sine', 0.6); }
        else { noise(d, t, 0.2, 3000, 1500, 6, 'bandpass', 0.6); tone(d, t, 0.25, 520, 430, 'square', 0.12); }
        break;
      }
      case 'edit': d = out(pos, 0.3, 30); if (!d) return; tone(d, t, 0.07, 900, 1300, 'triangle', 0.3); noise(d, t, 0.05, 3000, 2000, 2, 'bandpass', 0.3); break;
      case 'editSel': d = out(null, 0.14); tone(d, t, 0.04, 1500, 1800, 'sine', 0.3); break;
      case 'break': {
        d = out(pos, 0.7, 60); if (!d) return;
        const m = opt.m || 0;
        noise(d, t, 0.5, m === 2 ? 2500 : 1200, 150, 0.8, 'lowpass', 1);
        noise(d, t + 0.05, 0.35, m === 2 ? 4000 : 700, 300, 2, 'bandpass', 0.5);
        if (m === 2) tone(d, t, 0.4, 700, 300, 'square', 0.08);
        break;
      }
      case 'pick': {
        d = out(pos, 0.5, 30); if (!d) return;
        const m = opt.m;
        if (m === 0) { noise(d, t, 0.1, 1200, 400, 3, 'bandpass', 1); tone(d, t, 0.08, 300, 160, 'triangle', 0.4); }
        else if (m === 1) { noise(d, t, 0.12, 2500, 700, 2, 'bandpass', 1); tone(d, t, 0.06, 500, 300, 'square', 0.12); }
        else if (m === 2) { tone(d, t, 0.25, 1100, 1000, 'square', 0.12); noise(d, t, 0.15, 5000, 3000, 4, 'bandpass', 0.5); }
        else noise(d, t, 0.1, 700, 300, 1, 'lowpass', 0.6);
        if (opt.crit) tone(d, t, 0.15, 1400, 1800, 'sine', 0.3);
        break;
      }
      case 'swing': d = out(pos, 0.2, 20); if (!d) return; noise(d, t, 0.16, 400, 1800, 1, 'bandpass', 0.6, 0.06); break;
      case 'hit': d = out(null, 0.32); tone(d, t, 0.06, opt.sh ? 1700 : 1250, opt.sh ? 1500 : 1000, 'square', 0.18); break;
      case 'head': d = out(null, 0.35); tone(d, t, 0.25, 2200, 2100, 'sine', 0.45); tone(d, t + 0.01, 0.2, 3300, 3200, 'sine', 0.2); break;
      case 'hurt': d = out(null, 0.35); noise(d, t, 0.15, 600, 200, 1, 'lowpass', 0.8); tone(d, t, 0.12, 120, 70, 'sine', 0.4); break;
      case 'shieldBreak': d = out(null, 0.4); noise(d, t, 0.5, 6000, 1500, 3, 'bandpass', 0.7); tone(d, t, 0.4, 1600, 400, 'sine', 0.25); break;
      case 'boom': {
        d = out(pos, 1.2, 160); if (!d) return;
        noise(d, t, 1.4, 1800, 40, 0.6, 'lowpass', 1, 0.004); tone(d, t, 0.8, 80, 25, 'sine', 0.9, 0.004); noise(d, t + 0.05, 1.8, 400, 60, 0.4, 'lowpass', 0.4);
        break;
      }
      case 'chest': d = out(pos, 0.5, 40); if (!d) return; [880, 1100, 1320, 1760].forEach((f, i) => tone(d, t + i * 0.06, 0.4, f, f, 'triangle', 0.18)); noise(d, t, 0.3, 300, 200, 1, 'lowpass', 0.4); break;
      case 'chestHum': d = out(pos, 0.05, 14); if (!d) return; tone(d, t, 1.2, 660, 660, 'sine', 0.3, 0.3); tone(d, t, 1.2, 990, 990, 'sine', 0.15, 0.3); break;
      case 'pickup': d = out(null, 0.25); tone(d, t, 0.08, 700, 1200, 'triangle', 0.4); tone(d, t + 0.05, 0.1, 1200, 1500, 'sine', 0.25); break;
      case 'mats': d = out(null, 0.12); tone(d, t, 0.05, 1000, 1300, 'sine', 0.3); break;
      case 'reload': d = out(pos, 0.25, 20); if (!d) return; noise(d, t, 0.05, 3000, 2500, 5, 'bandpass', 0.6); noise(d, t + 0.18, 0.06, 2200, 1800, 5, 'bandpass', 0.7); break;
      case 'shell': d = out(pos, 0.25, 20); if (!d) return; noise(d, t, 0.06, 2500, 1500, 4, 'bandpass', 0.6); tone(d, t, 0.04, 400, 300, 'square', 0.08); break;
      case 'empty': d = out(null, 0.2); noise(d, t, 0.03, 4000, 3500, 6, 'bandpass', 0.6); break;
      case 'heal': d = out(pos, 0.25, 20); if (!d) return; [523, 659, 784].forEach((f, i) => tone(d, t + i * 0.08, 0.3, f, f * 1.01, 'sine', 0.25)); break;
      case 'shield': d = out(pos, 0.25, 20); if (!d) return; tone(d, t, 0.5, 400, 1400, 'sine', 0.3); noise(d, t, 0.4, 2000, 6000, 3, 'bandpass', 0.2); break;
      case 'jump': d = out(pos, 0.12, 20); if (!d) return; noise(d, t, 0.08, 800, 400, 1, 'lowpass', 0.5); break;
      case 'land': d = out(pos, 0.2, 20); if (!d) return; noise(d, t, 0.12, 500, 120, 1, 'lowpass', 0.8); break;
      case 'step': d = out(pos, 0.06, 16); if (!d) return; noise(d, t, 0.06, opt.hard ? 1500 : 700, 300, 1.5, 'bandpass', 0.7); break;
      case 'glide': d = out(null, 0.3); noise(d, t, 0.6, 300, 1500, 1, 'bandpass', 0.6, 0.15); break;
      case 'bounce': d = out(pos, 0.4, 30); if (!d) return; tone(d, t, 0.35, 200, 900, 'sine', 0.6); break;
      case 'elim': d = out(null, 0.4); [392, 523, 659, 784].forEach((f, i) => tone(d, t + i * 0.07, 0.35, f, f, 'triangle', 0.3)); break;
      case 'win': d = out(null, 0.5); [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(d, t + i * 0.14, 0.5, f, f, 'triangle', 0.32)); break;
      case 'lose': d = out(null, 0.4); [392, 349, 311, 262].forEach((f, i) => tone(d, t + i * 0.18, 0.5, f, f * 0.98, 'triangle', 0.3)); break;
      case 'ui': d = out(null, 0.18); tone(d, t, 0.05, 900, 1100, 'sine', 0.3); break;
      case 'uiHover': d = out(null, 0.06); tone(d, t, 0.03, 1400, 1500, 'sine', 0.2); break;
      case 'alert': d = out(null, 0.35); [660, 880, 660].forEach((f, i) => tone(d, t + i * 0.15, 0.13, f, f, 'square', 0.12)); break;
      case 'count': d = out(null, 0.3); tone(d, t, 0.15, opt.go ? 1320 : 880, opt.go ? 1320 : 880, 'triangle', 0.4); break;
      case 'whiz': d = out(null, 0.2); noise(d, t, 0.12, 3000, 800, 4, 'bandpass', 0.5, 0.02); break;
      case 'casing': d = out(pos, 0.05, 12); if (!d) return; tone(d, t, 0.06, 4200 + Math.random() * 900, 3800, 'triangle', 0.25); tone(d, t + 0.05, 0.04, 5100, 4600, 'triangle', 0.12); break;
      case 'impact': d = out(pos, 0.15, 25); if (!d) return; noise(d, t, 0.05, 2500, 900, 2, 'bandpass', 0.5); break;
    }
  }
  // looping ambience levels (0..1)
  function loops(storm, wind) {
    if (!ctx || ctx.state !== 'running') return;
    if (!stormNode) {
      const mk = (f, q) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(fl); fl.connect(g); g.connect(master); src.start();
        return g;
      };
      stormNode = mk(220, 1.2); windNode = mk(700, 0.6);
    }
    stormNode.gain.setTargetAtTime(storm * 0.5, ctx.currentTime, 0.3);
    windNode.gain.setTargetAtTime(wind * 0.35, ctx.currentTime, 0.2);
  }

  return { init, resume, play, setVolume, setListener, loops };
})();
