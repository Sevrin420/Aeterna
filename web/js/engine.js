// Tiny input manager shared by every scene.
// Tracks keyboard + on-screen D-pad/A/B hit zones as a single directional/button state.

import { sfx } from './sfx.js';

// On touch devices we drive the on-screen controls with Touch Events rather
// than Pointer Events. Touch events are the most consistent virtual-control API
// across mobile browsers (including privacy/in-app browsers like DuckDuckGo,
// where Pointer Events + setPointerCapture and touch-action are unreliable and
// a stray `pointercancel` kills a held press). Touch events are also implicitly
// captured to the element the touch began on, so a finger that drifts off the
// control keeps working without setPointerCapture. Desktop/mouse falls back to
// pointer events.
const HAS_TOUCH = typeof window !== 'undefined'
  && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

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
    // Steer from a screen point: direction is the dominant axis of the thumb's
    // offset from the zone centre.
    const from = (cx, cy) => {
      const r = el.getBoundingClientRect();
      const nx = (cx - r.left) / r.width - 0.5;
      const ny = (cy - r.top) / r.height - 0.5;
      clear();
      if (Math.abs(nx) < 0.08 && Math.abs(ny) < 0.08) return; // dead zone at centre
      if (Math.abs(nx) > Math.abs(ny)) this.dirs[nx < 0 ? 'left' : 'right'] = true;
      else this.dirs[ny < 0 ? 'up' : 'down'] = true;
    };
    const down = (cx, cy) => { el._pressed = true; el.classList.add('is-down'); sfx.click(); from(cx, cy); };
    const up = () => { el._pressed = false; el.classList.remove('is-down'); clear(); };

    if (HAS_TOUCH) {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; down(t.clientX, t.clientY); }, { passive: false });
      el.addEventListener('touchmove', (e) => { if (!el._pressed) return; e.preventDefault(); const t = e.touches[0]; if (t) from(t.clientX, t.clientY); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
    }
    // Fallback/dual: pointer events cover browsers where touch events are
    // unreliable (e.g. DuckDuckGo's WKWebView reports touch capability but
    // preventDefault doesn't always stick). Added alongside touch events
    // instead of in an else branch so both fire.
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      down(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => { if (el._pressed) { e.preventDefault(); from(e.clientX, e.clientY); } });
    ['pointerup', 'pointercancel'].forEach((ev) => el.addEventListener(ev, up));
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

    if (HAS_TOUCH) {
      // Touch events are implicitly captured to the touchstart target, so a
      // finger drifting off the small button still fires touchend on it — the
      // same robustness setPointerCapture gave us, but reliable everywhere.
      el.addEventListener('touchstart', (e) => { e.preventDefault(); press(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); release(); }, { passive: false });
      el.addEventListener('touchcancel', release, { passive: false });
    } else {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        press();
      });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    }
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
