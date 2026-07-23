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

  bindDpad(el, dir) {
    const on = (e) => { this.dirs[dir] = true; sfx.click(); e.preventDefault(); };
    const off = (e) => { this.dirs[dir] = false; if (e) e.preventDefault(); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }

  bindButton(el, which) {
    const setter = which === 'a' ? this._setA.bind(this) : this._setB.bind(this);
    const clear = () => (which === 'a' ? (this.a = false) : (this.b = false));
    el.addEventListener('pointerdown', (e) => { setter(true); e.preventDefault(); });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('pointercancel', clear);
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
