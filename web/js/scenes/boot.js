// Boot scene: the night-castle title art fades in, the title logo falls and
// bounces to rest in the middle of it, then a blinking PRESS A. Both images are
// real assets (web/assets/title-bg.jpg + the logo below). This sequence runs on
// every power-on.
//
// The falling logo IS the game's name, so it follows the rename rather than
// sitting beside it: Throbbin Abbey drops now, and ?oldName=1 drops the old
// Aeterna plate instead. Stacking the new name under the old one was the first
// attempt and it was wrong twice over — two titles at once, and the one the
// player reads first is the retired one.

import { NEW_NAME } from '../config.js';

const W = 208, H = 208;
const FONT = '"Press Start 2P", monospace';

function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
// Bounce, but with the bounce wiggle damped toward a smooth landing.
function easeSoftBounce(t, damp = 0.5) {
  const smooth = easeOutQuad(t);
  return smooth + (easeOutBounce(t) - smooth) * damp;
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

export class BootScene {
  constructor({ onComplete }) {
    this.onComplete = onComplete;
    this.t = 0;
    this.fadeIn = 2.0;        // background art fades up from black
    this.fallDuration = 4.8;  // then the logo drops slowly and settles to rest
    this.landed = false;
    this.blink = 0;

    this.bg = loadImage('assets/title-bg.jpg');
    this.logo = loadImage(NEW_NAME ? 'assets/title-logo-throbbin.png' : 'assets/title-logo.png');
  }

  enter() {}

  update(dt, input) {
    this.t += dt;
    if (this.t >= this.fadeIn + this.fallDuration) this.landed = true;
    if (!this.landed) {
      // An early A-press skips straight to the landed state so the button never
      // feels unresponsive; a second press then starts the game.
      if (input.consumeAPress()) {
        this.t = this.fadeIn + this.fallDuration;
        this.landed = true;
      }
      return;
    }
    this.blink += dt;
    if (input.consumeAPress()) this.onComplete();
  }

  render(ctx) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);

    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;

    // 1) background castle art fades in over the first `fadeIn` seconds
    const bgAlpha = Math.min(1, this.t / this.fadeIn);
    if (this.bg.complete && this.bg.naturalWidth) {
      ctx.globalAlpha = bgAlpha;
      ctx.drawImage(this.bg, 0, 0, W, H); // square art into the square screen
      ctx.globalAlpha = 1;
    }

    // 2) the logo falls once the fade-in is done, bouncing to rest in the middle
    const progress = Math.min(Math.max((this.t - this.fadeIn) / this.fallDuration, 0), 1);
    if (progress > 0 && this.logo.complete && this.logo.naturalWidth) {
      const lw = W * 0.92;                         // logo art is square; scale to width
      const lh = lw * (this.logo.naturalHeight / this.logo.naturalWidth);
      const restCy = H * 0.46;                     // centre it over the castle
      const startCy = -lh * 0.5;
      const cy = startCy + (restCy - startCy) * easeSoftBounce(progress, 0.5); // 50% less bounce
      ctx.save();
      ctx.filter = 'brightness(1.18)';             // a touch brighter than the source art
      ctx.drawImage(this.logo, (W - lw) / 2, cy - lh / 2, lw, lh);
      ctx.restore();
    }

    ctx.imageSmoothingEnabled = smooth;

    // 3) blinking PRESS A once everything has landed
    if (this.landed) {
      const on = Math.floor(this.blink / 0.5) % 2 === 0;
      if (on) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `8px ${FONT}`;
        ctx.save();
        ctx.shadowColor = 'rgba(255,190,110,0.9)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#f7dd93';
        ctx.fillText('PRESS  A', W / 2, H - 16);
        ctx.restore();
      }
    }

    // 4) fade the whole screen up from black over the first `fadeIn` seconds
    if (this.t < this.fadeIn) {
      ctx.fillStyle = `rgba(0,0,0,${1 - this.t / this.fadeIn})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  exit() {}
}
