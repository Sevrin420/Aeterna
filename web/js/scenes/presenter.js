// Presenter scene: the very first thing shown when the console is switched on.
// Two lines type slowly across a black screen — "Presented by" / "Members Only"
// — then a blinking PRESS A. Pressing A hands off to the title card.

const W = 208, H = 208;
const FONT = '"Press Start 2P", monospace';

export class PresenterScene {
  constructor({ onComplete }) {
    this.onComplete = onComplete;
    this.t = 0;
    this.line1 = 'Presented by';
    this.line2 = 'Members Only';
    this.charDelay = 0.16;                 // seconds per character (slow print)
    this.total = this.line1.length + this.line2.length;
    this.blink = 0;
  }

  enter() {}

  get printed() { return Math.floor(this.t / this.charDelay); }
  get done() { return this.printed >= this.total; }

  update(dt, input) {
    this.t += dt;
    if (!this.done) {
      // early A finishes the typing instantly; a second press continues
      if (input.consumeAPress()) this.t = this.total * this.charDelay;
      return;
    }
    this.blink += dt;
    if (input.consumeAPress()) this.onComplete();
  }

  render(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const n = Math.min(this.printed, this.total);
    const s1 = this.line1.slice(0, Math.min(n, this.line1.length));
    const s2 = n > this.line1.length ? this.line2.slice(0, n - this.line1.length) : '';

    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = '#e8e2d2';
    ctx.fillText(s1, W / 2, H * 0.42);
    ctx.fillText(s2, W / 2, H * 0.42 + 18);

    if (this.done) {
      const on = Math.floor(this.blink / 0.5) % 2 === 0;
      if (on) {
        ctx.font = `8px ${FONT}`;
        ctx.save();
        ctx.shadowColor = 'rgba(255,190,110,0.9)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#f7dd93';
        ctx.fillText('PRESS  A', W / 2, H - 26);
        ctx.restore();
      }
    }
  }

  exit() {}
}
