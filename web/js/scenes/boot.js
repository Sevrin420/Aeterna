// Boot scene: title falls into place, then a blinking "PRESS A" prompt.

const W = 208, H = 208;

function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export class BootScene {
  constructor({ onComplete }) {
    this.onComplete = onComplete;
    this.t = 0;
    this.fallDuration = 1.1;
    this.landed = false;
    this.blink = 0;
    this.title = 'AETERNA';
    this.subtitle = 'Vita Aeterna';
  }

  enter() {}

  update(dt, input) {
    this.t += dt;
    if (this.t >= this.fallDuration) this.landed = true;
    if (this.landed) {
      this.blink += dt;
      if (input.consumeAPress()) {
        this.onComplete();
      }
    }
  }

  render(ctx) {
    ctx.fillStyle = '#050301';
    ctx.fillRect(0, 0, W, H);

    // faint stone-glow backdrop
    const grad = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.75);
    grad.addColorStop(0, 'rgba(120, 90, 30, 0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const targetY = H / 2 - 6;
    const startY = -30;
    const progress = Math.min(this.t / this.fallDuration, 1);
    const eased = easeOutBounce(progress);
    const y = startY + (targetY - startY) * eased;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(this.title, W / 2 + 1, y + 2);
    ctx.fillStyle = '#e9c468';
    ctx.fillText(this.title, W / 2, y);

    if (this.landed) {
      ctx.font = '9px "Courier New", monospace';
      ctx.fillStyle = '#a9821f';
      ctx.fillText(this.subtitle, W / 2, y + 20);

      const on = Math.floor(this.blink / 0.5) % 2 === 0;
      if (on) {
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.fillStyle = '#f4d78a';
        ctx.fillText('PRESS A', W / 2, H - 34);
      }
    }
    ctx.restore();
  }

  exit() {}
}
