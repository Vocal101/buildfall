'use strict';
// Shared helpers: seeded RNG, noise, math.

const U = (() => {
  function rng(seed) {
    let a = seed >>> 0;
    const f = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.chance = p => f() < p;
    return f;
  }

  // 2D gradient noise (Perlin-style), seeded.
  function noise2(seed) {
    const r = rng(seed);
    const perm = new Uint8Array(512);
    const p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const gx = new Float32Array(256), gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    function n(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const X = xi & 255, Y = yi & 255;
      const g = (ix, iy, dx, dy) => { const h = perm[ix + perm[iy]]; return gx[h] * dx + gy[h] * dy; };
      const n00 = g(X, Y, xf, yf), n10 = g(X + 1, Y, xf - 1, yf);
      const n01 = g(X, Y + 1, xf, yf - 1), n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
      const u = fade(xf), v = fade(yf);
      return (n00 + u * (n10 - n00)) + v * ((n01 + u * (n11 - n01)) - (n00 + u * (n10 - n00)));
    }
    n.fbm = (x, y, oct = 5, lac = 2, gain = 0.5) => {
      let s = 0, a = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= gain; f *= lac; }
      return s / norm;
    };
    n.ridge = (x, y, oct = 4) => {
      let s = 0, a = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(n(x * f, y * f) * 1.6)); norm += a; a *= 0.5; f *= 2.1; }
      return s / norm;
    };
    return n;
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
  const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const r2 = v => Math.round(v * 100) / 100;
  const r1 = v => Math.round(v * 10) / 10;
  const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Yaw convention: yaw 0 looks toward -Z, positive yaw turns left (counter-clockwise from above), like three.js.
  const fwdX = yaw => -Math.sin(yaw);
  const fwdZ = yaw => -Math.cos(yaw);
  const dirFromYawPitch = (yaw, pitch) => {
    const c = Math.cos(pitch);
    return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
  };
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage blocked */ } }
  function load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }

  return { rng, noise2, clamp, lerp, smooth, wrapAngle, lerpAngle, dist2, dist3, r2, r1, fmtTime, hashStr, esc, fwdX, fwdZ, dirFromYawPitch, yawTo, store, load };
})();
