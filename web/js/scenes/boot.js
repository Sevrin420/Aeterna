// Boot scene: a painted abbey-interior title card falls into place, then a
// blinking "PRESS A" prompt. Visual approach (painted backdrop behind a
// falling title card, Press Start 2P gradient title) adapted from the
// clubnile.html boot sequence in the sevrin420/members-only repo.

const W = 208, H = 208;
const FONT = '"Press Start 2P", monospace';

function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function h2(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97; }

export class BootScene {
  constructor({ onComplete }) {
    this.onComplete = onComplete;
    this.t = 0;
    this.fallDuration = 3.3; // slowed 200% (3x) from the original 1.1s drop
    this.landed = false;
    this.blink = 0;
    this.title = 'AETERNA';
    this.subtitle = 'VITA AETERNA';
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

  _paintBackdrop(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#241608');
    sky.addColorStop(0.45, '#2e1a0c');
    sky.addColorStop(0.72, '#1c130c');
    sky.addColorStop(1, '#0e0906');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // soft torchlit glow washing up from the altar
    const glow = ctx.createRadialGradient(W / 2, H * 0.8, 6, W / 2, H * 0.8, W * 0.7);
    glow.addColorStop(0, 'rgba(240, 180, 90, 0.20)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // flanking stone pillars with gold banding
    const column = (cx) => {
      ctx.fillStyle = '#241a10';
      ctx.fillRect(cx - 8, 6, 16, H - 44);
      ctx.fillStyle = '#40301c';
      ctx.fillRect(cx - 6, 6, 12, H - 44);
      ctx.fillStyle = '#5a4426';
      ctx.fillRect(cx - 6, 6, 3, H - 44);
      ctx.fillStyle = '#c9a13b';
      for (let y = 14; y < H - 44; y += 12) ctx.fillRect(cx - 6, y, 12, 2);
    };
    column(16);
    column(W - 16);

    // torches on the pillars, gently flickering
    const torch = (cx, cy) => {
      const flick = 0.75 + Math.sin(this.t * 13 + cx) * 0.18;
      ctx.fillStyle = '#2a1a0c';
      ctx.fillRect(cx - 1.5, cy, 3, 8);
      ctx.fillStyle = `rgba(255, ${Math.floor(150 + flick * 55)}, 70, 0.9)`;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 5, 3.2 * flick, 5 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 225, 150, 0.75)';
      ctx.beginPath();
      ctx.ellipse(cx, cy - 5, 1.3 * flick, 2.2 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    torch(16, 46);
    torch(W - 16, 46);

    // dark stone floor
    ctx.fillStyle = '#1a1108';
    ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(0, H - 40, W, 2);
    for (let i = 0; i < 40; i++) {
      const gx = (h2(i * 7, 9) / 97) * W;
      const gy = H - 36 + (h2(9, i * 7) / 97) * 30;
      ctx.fillStyle = 'rgba(90, 68, 38, 0.4)';
      ctx.fillRect(gx, gy, 2, 1);
    }

    // stone altar with a glowing ankh
    const ax = W / 2, ay = H - 40;
    ctx.fillStyle = '#3a2c18';
    ctx.fillRect(ax - 16, ay - 10, 32, 10);
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(ax - 16, ay - 10, 32, 2);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(ax - 12, ay, 24, 4);

    const pulse = 0.6 + Math.sin(this.t * 3) * 0.3;
    ctx.save();
    ctx.translate(ax, ay - 22);
    ctx.fillStyle = `rgba(233, 196, 104, ${0.55 + pulse * 0.3})`;
    ctx.beginPath(); ctx.arc(0, -3, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-1.4, -3, 2.8, 13);
    ctx.fillRect(-6, 3, 12, 2.4);
    ctx.restore();
  }

  render(ctx) {
    this._paintBackdrop(ctx);

    const targetY = H * 0.42;
    const startY = -30;
    const progress = Math.min(this.t / this.fallDuration, 1);
    const eased = easeOutBounce(progress);
    const y = startY + (targetY - startY) * eased;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#1a0f04';
    ctx.fillText(this.title, W / 2 + 1.5, y + 2);
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    g.addColorStop(0, '#fff0b8');
    g.addColorStop(0.5, '#eec24a');
    g.addColorStop(1, '#a9821f');
    ctx.fillStyle = g;
    ctx.fillText(this.title, W / 2, y);

    if (this.landed) {
      ctx.fillStyle = '#caa04a';
      ctx.fillRect(W / 2 - 46, y + 16, 92, 1);

      ctx.font = `6px ${FONT}`;
      ctx.fillStyle = '#c9a35f';
      ctx.fillText(this.subtitle, W / 2, y + 26);

      const on = Math.floor(this.blink / 0.5) % 2 === 0;
      if (on) {
        ctx.font = `9px ${FONT}`;
        ctx.fillStyle = '#f4d78a';
        ctx.fillText('PRESS A', W / 2, H - 16);
      }
    }
    ctx.restore();
  }

  exit() {}
}
