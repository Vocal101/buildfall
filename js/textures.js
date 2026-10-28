'use strict';
// Procedural textures drawn on canvases, with normal maps derived from their brightness.

const Tex = (() => {
  const cache = {};
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rnd(seed) { return U.rng(seed); }

  function normalFrom(c, strength = 2.5) {
    const w = c.width, h = c.height;
    const src = c.getContext('2d').getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.59 + src[i * 4 + 2] * 0.11) / 255;
    const out = canvas(w, h);
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const L = (x, y) => lum[((y + h) % h) * w + ((x + w) % w)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  function wood() {
    const c = canvas(512, 512), g = c.getContext('2d'), R = rnd(11);
    g.fillStyle = '#9a6234'; g.fillRect(0, 0, 512, 512);
    const planks = 6, ph = 512 / planks;
    for (let i = 0; i < planks; i++) {
      const y = i * ph;
      const base = 120 + R() * 40;
      const grad = g.createLinearGradient(0, y, 0, y + ph);
      grad.addColorStop(0, `rgb(${base + 70},${base + 22},${base * 0.35})`);
      grad.addColorStop(0.5, `rgb(${base + 58},${base + 12},${base * 0.28})`);
      grad.addColorStop(1, `rgb(${base + 38},${base - 2},${base * 0.2})`);
      g.fillStyle = grad; g.fillRect(0, y, 512, ph);
      // grain
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = `rgba(60,30,10,${0.08 + R() * 0.14})`;
        g.lineWidth = 1 + R() * 2;
        g.beginPath();
        const yy = y + R() * ph;
        g.moveTo(0, yy);
        for (let x = 0; x <= 512; x += 32) g.lineTo(x, yy + Math.sin(x * 0.02 + k) * 3 + (R() - 0.5) * 2);
        g.stroke();
      }
      // knots
      for (let k = 0; k < 2; k++) {
        const kx = R() * 512, ky = y + ph * (0.3 + R() * 0.4);
        const rg = g.createRadialGradient(kx, ky, 1, kx, ky, 9);
        rg.addColorStop(0, 'rgba(50,25,8,0.8)'); rg.addColorStop(1, 'rgba(50,25,8,0)');
        g.fillStyle = rg; g.beginPath(); g.ellipse(kx, ky, 14, 7, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(30,14,4,0.85)'; g.fillRect(0, y, 512, 4);
      g.fillStyle = 'rgba(255,220,170,0.18)'; g.fillRect(0, y + 4, 512, 2);
      // plank seams
      const seam = R() * 400 + 50;
      g.fillStyle = 'rgba(30,14,4,0.7)'; g.fillRect(seam, y, 3, ph);
    }
    // frame
    g.strokeStyle = '#4a2a12'; g.lineWidth = 26; g.strokeRect(13, 13, 486, 486);
    g.strokeStyle = 'rgba(255,210,150,0.25)'; g.lineWidth = 3; g.strokeRect(27, 27, 458, 458);
    g.strokeStyle = 'rgba(20,10,0,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510);
    // nails
    g.fillStyle = '#2a2622';
    for (const [x, y] of [[13, 13], [499, 13], [13, 499], [499, 499], [256, 13], [256, 499], [13, 256], [499, 256]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    return c;
  }

  function brick() {
    const c = canvas(512, 512), g = c.getContext('2d'), R = rnd(23);
    g.fillStyle = '#c9b8a2'; g.fillRect(0, 0, 512, 512);
    const rows = 10, bh = 512 / rows, bw = 512 / 4;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw / 2;
      for (let i = -1; i < 5; i++) {
        const x = i * bw + off, y = r * bh;
        const h = 8 + R() * 14, s = 50 + R() * 15, l = 36 + R() * 14;
        g.fillStyle = `hsl(${h},${s}%,${l}%)`;
        g.fillRect(x + 4, y + 4, bw - 8, bh - 8);
        // speckles
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(${R() < 0.5 ? '255,220,200' : '40,15,10'},${R() * 0.18})`;
          g.fillRect(x + 4 + R() * (bw - 8), y + 4 + R() * (bh - 8), 2 + R() * 4, 2 + R() * 3);
        }
        g.fillStyle = 'rgba(255,230,210,0.12)'; g.fillRect(x + 4, y + 4, bw - 8, 3);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 4, y + bh - 7, bw - 8, 3);
      }
    }
    g.strokeStyle = '#8f8a82'; g.lineWidth = 22; g.strokeRect(11, 11, 490, 490);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3; g.strokeRect(23, 23, 466, 466);
    return c;
  }

  function metal() {
    const c = canvas(512, 512), g = c.getContext('2d'), R = rnd(37);
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#9aa6b1'); grad.addColorStop(1, '#7d8893');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    // corrugation
    for (let x = 0; x < 512; x += 32) {
      const gg = g.createLinearGradient(x, 0, x + 32, 0);
      gg.addColorStop(0, 'rgba(255,255,255,0.10)'); gg.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gg.addColorStop(1, 'rgba(255,255,255,0.10)');
      g.fillStyle = gg; g.fillRect(x, 40, 32, 432);
    }
    // scratches
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(255,255,255,${R() * 0.12})`; g.lineWidth = 1;
      g.beginPath(); const x = R() * 512, y = R() * 512; g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 60, y + (R() - 0.5) * 20); g.stroke();
    }
    // frame + bolts
    g.fillStyle = '#5b646d'; g.fillRect(0, 0, 512, 40); g.fillRect(0, 472, 512, 40); g.fillRect(0, 0, 30, 512); g.fillRect(482, 0, 30, 512);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, 38, 512, 2); g.fillRect(0, 470, 512, 2);
    for (let x = 30; x < 512; x += 60) for (const y of [20, 492]) {
      const rg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
      rg.addColorStop(0, '#e9eef2'); rg.addColorStop(1, '#4a525a');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
    }
    // hazard stripe
    g.save(); g.beginPath(); g.rect(30, 440, 452, 30); g.clip();
    for (let x = -40; x < 520; x += 40) { g.fillStyle = '#e8b21c'; g.beginPath(); g.moveTo(x, 470); g.lineTo(x + 20, 470); g.lineTo(x + 50, 440); g.lineTo(x + 30, 440); g.fill(); }
    g.restore();
    return c;
  }

  function detail(seed, base, varAmt, size = 256) {
    const c = canvas(size, size), g = c.getContext('2d'), R = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size / 6; i++) {
      const v = (R() - 0.5) * varAmt;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(R() * size, R() * size, 1 + R() * 2, 1 + R() * 2);
    }
    return c;
  }

  function grassBlade() {
    const c = canvas(64, 128), g = c.getContext('2d'), R = rnd(5);
    for (let i = 0; i < 9; i++) {
      const x = 6 + R() * 52, w = 3 + R() * 4, h = 60 + R() * 64, lean = (R() - 0.5) * 22;
      const gr = g.createLinearGradient(0, 128, 0, 128 - h);
      gr.addColorStop(0, '#5f8f3a'); gr.addColorStop(1, '#c6ec7c');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.quadraticCurveTo(x + lean * 0.3 + w * 0.3, 128 - h * 0.6, x + w, 128); g.fill();
    }
    return c;
  }

  function blueprint() {
    const c = canvas(256, 256), g = c.getContext('2d');
    g.fillStyle = 'rgba(70,160,255,0.28)'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(180,225,255,0.9)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250);
    g.strokeStyle = 'rgba(160,215,255,0.45)'; g.lineWidth = 2;
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke(); }
    return c;
  }

  function glow() {
    const c = canvas(128, 128), g = c.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    return c;
  }
  function flash() {
    const c = canvas(128, 128), g = c.getContext('2d');
    g.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      const gr = g.createLinearGradient(0, 0, 60, 0);
      gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, -7); g.lineTo(62, 0); g.lineTo(0, 7); g.fill();
    }
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    rg.addColorStop(0, 'rgba(255,255,230,1)'); rg.addColorStop(1, 'rgba(255,180,60,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill();
    return c;
  }
  function beam() {
    const c = canvas(64, 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    const hg = g.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
    return c;
  }

  function get(name) {
    if (cache[name]) return cache[name];
    let t;
    const mk = (cv, srgb = true, rep = true) => {
      const tx = new THREE.CanvasTexture(cv);
      if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
      if (rep) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; }
      tx.anisotropy = 8;
      return tx;
    };
    switch (name) {
      case 'wood': { const c = wood(); t = { map: mk(c), normal: mk(normalFrom(c, 3), false) }; break; }
      case 'brick': { const c = brick(); t = { map: mk(c), normal: mk(normalFrom(c, 4), false) }; break; }
      case 'metal': { const c = metal(); t = { map: mk(c), normal: mk(normalFrom(c, 2), false) }; break; }
      case 'ground': t = mk(detail(3, '#d8d8d8', 0.35, 256)); break;
      case 'grass': t = mk(grassBlade(), true, false); break;
      case 'blueprint': t = mk(blueprint(), true); break;
      case 'glow': t = mk(glow(), true, false); break;
      case 'flash': t = mk(flash(), true, false); break;
      case 'beam': t = mk(beam(), true, false); break;
    }
    cache[name] = t;
    return t;
  }
  return { get };
})();
