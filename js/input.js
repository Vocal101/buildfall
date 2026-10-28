'use strict';
// Keyboard/mouse input with rebindable actions.

const Input = (() => {
  const down = new Set();
  let pressed = new Set(), released = new Set();
  let mdx = 0, mdy = 0;
  let capture = null;
  let binds = {};
  let enabled = false;
  let canvas = null;

  function setBinds(b) {
    binds = {};
    for (const a of ACTIONS) binds[a.id] = (b && b[a.id]) || a.def;
  }
  function codeOf(action) { return binds[action]; }
  const press = c => { if (!down.has(c)) pressed.add(c); down.add(c); };
  const release = c => { if (down.has(c)) released.add(c); down.delete(c); };

  function onKey(e, isDown) {
    if (capture) {
      if (isDown) {
        e.preventDefault();
        if (e.code === 'Escape') { const cb = capture; capture = null; cb(null); }
        else { const cb = capture; capture = null; cb(e.code); }
      }
      return;
    }
    if (!enabled) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (['Space', 'Tab', 'AltLeft', 'AltRight', 'Backquote', 'F1'].includes(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    if (isDown) { if (!e.repeat) press(e.code); } else release(e.code);
  }
  function onMouse(e, isDown) {
    const c = 'Mouse' + e.button;
    if (e.button >= 3 && (enabled || capture)) e.preventDefault(); // stop side buttons from navigating back/forward
    if (capture && isDown) {
      if (e.target && e.target.closest && e.target.closest('.bind-cancel')) return;
      e.preventDefault();
      const cb = capture; capture = null; cb(c);
      return;
    }
    if (!enabled) return;
    if (isDown) { if (document.pointerLockElement) press(c); } else release(c);
  }
  function onWheel(e) {
    const c = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    if (capture) { e.preventDefault(); const cb = capture; capture = null; cb(c); return; }
    if (!enabled || !document.pointerLockElement) return;
    pressed.add(c); released.add(c);
  }

  function init(cv) {
    canvas = cv;
    window.addEventListener('keydown', e => onKey(e, true));
    window.addEventListener('keyup', e => onKey(e, false));
    window.addEventListener('mousedown', e => onMouse(e, true));
    window.addEventListener('mouseup', e => onMouse(e, false));
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement === canvas) {
        // ignore the huge spikes some browsers report on lock changes
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) { mdx += e.movementX; mdy += e.movementY; }
      }
    });
    window.addEventListener('contextmenu', e => { if (enabled || capture) e.preventDefault(); });
    window.addEventListener('auxclick', e => { if (e.button >= 3 && (enabled || capture)) e.preventDefault(); });
    window.addEventListener('blur', clear);
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) clear(); });
  }
  function clear() {
    for (const c of down) released.add(c);
    down.clear();
  }
  function lock() {
    if (!canvas || document.pointerLockElement === canvas) return;
    try {
      const r = canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => { try { canvas.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) { try { canvas.requestPointerLock(); } catch (e2) { /* ignore */ } }
  }
  function unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  const locked = () => !!document.pointerLockElement;

  const held = a => down.has(binds[a]);
  const hit = a => pressed.has(binds[a]);
  const up = a => released.has(binds[a]);
  function mouse() { const r = [mdx, mdy]; mdx = 0; mdy = 0; return r; }
  function endFrame() { pressed = new Set(); released = new Set(); }
  function captureNext(cb) { capture = cb; }
  function setEnabled(v) { enabled = v; if (!v) clear(); }

  const NAMES = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down', Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', CapsLock: 'Caps', Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
  function label(code) {
    if (!code) return '—';
    if (NAMES[code]) return NAMES[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }

  return { init, setBinds, codeOf, held, hit, up, mouse, endFrame, captureNext, setEnabled, lock, unlock, locked, label, clear, get binds() { return binds; } };
})();
