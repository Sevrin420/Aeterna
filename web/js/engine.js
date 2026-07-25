// Tiny input manager shared by every scene.
// Tracks keyboard + on-screen D-pad/A/B hit zones as a single directional/button state.

import { sfx } from './sfx.js';

export class Input {
  constructor() {
    this.dirs = { up: false, down: false, left: false, right: false };
    this.a = false;
    this.b = false;
    this._aJustPressed = false;
    this._bJustPressed = false;

    const keyMap = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
    };

    const isTyping = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (keyMap[e.code]) { this.dirs[keyMap[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Enter' || e.code === 'KeyZ' || e.code === 'Space') { this._setA(true); e.preventDefault(); }
      if (e.code === 'KeyX' || e.code === 'ShiftLeft') { this._setB(true); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      if (isTyping(e)) return;
      if (keyMap[e.code]) this.dirs[keyMap[e.code]] = false;
      if (e.code === 'Enter' || e.code === 'KeyZ' || e.code === 'Space') this.a = false;
      if (e.code === 'KeyX' || e.code === 'ShiftLeft') this.b = false;
    });
  }

  _setA(v) { if (v && !this.a) { this._aJustPressed = true; sfx.click(); } this.a = v; }
  _setB(v) { if (v && !this.b) { this._bJustPressed = true; sfx.click(); } this.b = v; }

  // Single continuous d-pad zone (Club Nile style): press once anywhere on
  // the cross, then slide the thumb to change direction without lifting.
  // Direction is the dominant axis of the thumb's offset from the zone
  // centre, recomputed on every move.
  bindDpadZone(el) {
    const clear = () => { this.dirs.up = this.dirs.down = this.dirs.left = this.dirs.right = false; };
    const from = (e) => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      clear();
      if (Math.abs(nx) < 0.08 && Math.abs(ny) < 0.08) return; // dead zone at centre
      if (Math.abs(nx) > Math.abs(ny)) this.dirs[nx < 0 ? 'left' : 'right'] = true;
      else this.dirs[ny < 0 ? 'up' : 'down'] = true;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      el._pressed = true;
      el.classList.add('is-down');
      sfx.click();
      from(e);
    });
    el.addEventListener('pointermove', (e) => { if (el._pressed) { e.preventDefault(); from(e); } });
    ['pointerup', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => { el._pressed = false; el.classList.remove('is-down'); clear(); }));
  }

  bindButton(el, which) {
    // Every pointerdown queues a DISCRETE press, independent of the held-state
    // boolean. (The old code only fired on the rising edge of `this.a`; if a
    // pointerup/leave/cancel was ever missed on mobile, `this.a` stayed true
    // and every later tap was silently dropped — "A doesn't register".)
    const press = () => {
      if (which === 'a') { this._aJustPressed = true; this.a = true; }
      else { this._bJustPressed = true; this.b = true; }
      el.classList.add('is-down');
      sfx.click();
    };
    const release = () => { el.classList.remove('is-down'); return which === 'a' ? (this.a = false) : (this.b = false); };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Capture the pointer (the d-pad already does this): once the finger
      // lands on the button, its events stay bound to the button even if the
      // touch drifts a few px off the small hit circle, so the tap can't be
      // silently retargeted to the console art behind it and lost.
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      press();
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    // With capture held, pointerleave won't fire mid-press (so a drifting thumb
    // no longer releases early); it only matters as a fallback if capture threw.
    el.addEventListener('pointerleave', release);
  }

  // Call once per frame after update() has consumed the "just pressed" edge.
  consumeAPress() {
    const v = this._aJustPressed;
    this._aJustPressed = false;
    return v;
  }

  consumeBPress() {
    const v = this._bJustPressed;
    this._bJustPressed = false;
    return v;
  }
}

export function makeLoop(update, render) {
  let last = performance.now();
  let running = true;

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return () => { running = false; };
}
