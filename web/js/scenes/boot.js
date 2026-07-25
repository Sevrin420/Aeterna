// Boot scene: a hand-painted gothic death-cult title card — a great glowing
// rose window with an inverted cross, candlelit stone architecture, drifting
// fog and rising embers, and a carved-gold AETERNA logo that drops into place
// with a blinking PRESS A. Everything is drawn procedurally on the canvas (no
// image assets); the static architecture is baked once and the light, fog,
// embers and logo are animated live over it.

const W = 208, H = 208;
const RES = 2; // matches the 2x device transform main.js sets each frame
const FONT = '"Press Start 2P", monospace';
const SERIF = 'Georgia, "Times New Roman", serif';

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
    this.fadeIn = 2.0;       // screen fades up from black before the title drops
    this.fallDuration = 3.3; // slow, weighty drop
    this.landed = false;
    this.blink = 0;
    this.title = 'AETERNA';
    this.subtitle = 'V I T A   A E T E R N A';

    // rose window geometry (top centre)
    this.win = { cx: W / 2, cy: 54, R: 30 };

    // pre-scatter embers so they don't all rise in lockstep
    this._embers = [];
    for (let i = 0; i < 26; i++) {
      this._embers.push({
        x: 20 + (h2(i * 5, 3) / 97) * (W - 40),
        base: 40 + (h2(3, i * 5) / 97) * (H - 60),
        seed: (h2(i * 9, i * 2) / 97) * Math.PI * 2,
        spd: 6 + (h2(i, i * 3) / 97) * 10,
        r: 0.5 + (h2(i * 2, 7) / 97) * 0.9,
      });
    }
  }

  enter() {}

  update(dt, input) {
    this.t += dt;
    if (this.t >= this.fadeIn + this.fallDuration) this.landed = true;
    if (!this.landed) {
      if (input.consumeAPress()) {
        this.t = this.fadeIn + this.fallDuration;
        this.landed = true;
      }
      return;
    }
    this.blink += dt;
    if (input.consumeAPress()) this.onComplete();
  }

  // ---- static architecture, baked once into an offscreen canvas ----
  _bake() {
    const cv = document.createElement('canvas');
    cv.width = W * RES; cv.height = H * RES;
    const g = cv.getContext('2d');
    g.setTransform(RES, 0, 0, RES, 0, 0);
    g.lineJoin = 'round';

    // deep void with a faint crimson wash bleeding down from the window
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#160b10');
    sky.addColorStop(0.4, '#120a0e');
    sky.addColorStop(1, '#070406');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // ribbed vault suggestion: faint stone arcs sweeping up to the window
    g.strokeStyle = 'rgba(70,64,74,0.25)'; g.lineWidth = 1.4;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(this.win.cx, this.win.cy);
      g.quadraticCurveTo(this.win.cx + i * 46, 30, this.win.cx + i * 74, H * 0.5);
      g.stroke();
    }

    this._bakeArch(g);
    this._bakeWindow(g);
    this._bakeColumns(g);
    this._bakeLedge(g);
    this._bakeAltar(g);

    // heavy vignette baked in; corners drink the light
    const vig = g.createRadialGradient(W / 2, H * 0.52, 40, W / 2, H * 0.52, 150);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);

    this._bg = cv;
  }

  _bakeArch(g) {
    const { cx, cy, R } = this.win;
    // a pointed lancet arch of dressed stone framing the window
    const springY = cy + R + 4, apexY = cy - R - 26, halfW = R + 10;
    const band = (outset, fill) => {
      g.strokeStyle = fill; g.lineWidth = outset;
      g.beginPath();
      g.moveTo(cx - halfW, springY);
      g.quadraticCurveTo(cx - halfW, apexY + 18, cx, apexY);
      g.quadraticCurveTo(cx + halfW, apexY + 18, cx + halfW, springY);
      g.stroke();
    };
    band(9, '#26282d');
    band(6, '#3a3d44');
    band(2.4, '#54575f');
    // keystone knot at the apex
    g.fillStyle = '#4a4d54';
    g.beginPath(); g.moveTo(cx, apexY - 5); g.lineTo(cx + 4, apexY + 1); g.lineTo(cx, apexY + 6); g.lineTo(cx - 4, apexY + 1); g.closePath(); g.fill();
    g.fillStyle = '#2b2d32'; g.fillRect(cx - 0.6, apexY - 2, 1.2, 6);
  }

  _bakeWindow(g) {
    const { cx, cy, R } = this.win;
    const glass = ['#7e1620', '#3a2456', '#a8731c', '#243c66'];

    // stone outer rim
    g.fillStyle = '#3a3d44'; g.beginPath(); g.arc(cx, cy, R + 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d1f23'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    // twelve glowing petals in the outer ring
    const inner = R * 0.42, seg = 12;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2 - Math.PI / 2;
      const base = glass[i % glass.length];
      g.beginPath();
      g.arc(cx, cy, R - 1.5, a0 + 0.03, a1 - 0.03);
      g.arc(cx, cy, inner + 1.5, a1 - 0.03, a0 + 0.03, true);
      g.closePath();
      g.fillStyle = base; g.fill();
      // lit centre of each petal
      const mid = (a0 + a1) / 2, mr = (R + inner) / 2;
      const lx = cx + Math.cos(mid) * mr, ly = cy + Math.sin(mid) * mr;
      const gl = g.createRadialGradient(lx, ly, 0, lx, ly, (R - inner) * 0.7);
      gl.addColorStop(0, 'rgba(255,235,200,0.55)');
      gl.addColorStop(1, 'rgba(255,235,200,0)');
      g.fillStyle = gl; g.fill();
    }

    // stone tracery: spokes + concentric rings
    g.strokeStyle = '#2a2c31'; g.lineWidth = 2;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * (R - 0.5), cy + Math.sin(a) * (R - 0.5));
      g.stroke();
    }
    g.lineWidth = 2.4;
    for (const rr of [R - 0.5, inner]) { g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke(); }

    // inner rosette with an INVERTED cross at the heart (death-cult sigil)
    g.fillStyle = '#120a0c'; g.beginPath(); g.arc(cx, cy, inner - 1, 0, Math.PI * 2); g.fill();
    const petal = inner * 0.9;
    g.fillStyle = 'rgba(168,40,52,0.5)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * petal * 0.4, cy + Math.sin(a) * petal * 0.4, petal * 0.5, petal * 0.22, a, 0, Math.PI * 2);
      g.fill();
    }
    // inverted cross: long arm points DOWN
    g.fillStyle = '#f0d68a';
    g.fillRect(cx - 1, cy - inner * 0.55, 2, inner * 1.25);
    g.fillRect(cx - inner * 0.42, cy + inner * 0.35, inner * 0.84, 2);
  }

  _bakeColumns(g) {
    const column = (cx) => {
      // shaft
      g.fillStyle = '#212226'; g.fillRect(cx - 9, 8, 18, H - 58);
      g.fillStyle = '#3c3f45'; g.fillRect(cx - 7, 8, 14, H - 58);
      g.fillStyle = '#585b62'; g.fillRect(cx - 7, 8, 3.5, H - 58);
      g.fillStyle = 'rgba(16,16,18,0.7)';
      for (let y = 18; y < H - 58; y += 13) g.fillRect(cx - 7, y, 14, 1.4);
      // fluting shadow
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx + 1, 8, 2, H - 58);
      // capital
      g.fillStyle = '#4a4d54'; g.fillRect(cx - 11, 8, 22, 6);
      g.fillStyle = '#5e6169'; g.fillRect(cx - 11, 8, 22, 2);
      g.fillStyle = '#c79a3e'; g.fillRect(cx - 11, 13, 22, 1.4); // gold band
    };
    column(15);
    column(W - 15);
  }

  _bakeLedge(g) {
    // stone ledge the candles stand on
    const ly = 150;
    g.fillStyle = '#2c2e33'; g.fillRect(24, ly, W - 48, 7);
    g.fillStyle = '#43464d'; g.fillRect(24, ly, W - 48, 2.4);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(24, ly + 5, W - 48, 2);
    g.fillStyle = '#c79a3e'; g.fillRect(24, ly + 3, W - 48, 0.8);
  }

  _bakeAltar(g) {
    // dark stone floor
    g.fillStyle = '#120c08'; g.fillRect(0, H - 34, W, 34);
    g.fillStyle = '#201810'; g.fillRect(0, H - 34, W, 2);
    for (let i = 0; i < 46; i++) {
      const gx = (h2(i * 7, 9) / 97) * W;
      const gy = H - 30 + (h2(9, i * 7) / 97) * 26;
      g.fillStyle = 'rgba(96,72,40,0.35)'; g.fillRect(gx, gy, 2, 1);
    }
    // altar block with a draped cloth
    const ax = W / 2, ay = H - 34;
    g.fillStyle = '#4c4a45'; g.fillRect(ax - 17, ay - 11, 34, 11);
    g.fillStyle = '#65635b'; g.fillRect(ax - 17, ay - 11, 34, 2);
    g.fillStyle = '#26241f'; g.fillRect(ax - 13, ay, 26, 4);
    g.fillStyle = '#cfc7b4'; g.fillRect(ax - 14, ay - 9, 28, 2.6);
    g.fillStyle = '#a71f2b'; g.fillRect(ax - 14, ay - 7, 28, 0.8); // blood trim
    // standing INVERTED cross of dark iron behind the altar
    g.strokeStyle = '#15100e'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ax, ay - 34); g.lineTo(ax, ay - 8); g.stroke();
    g.beginPath(); g.moveTo(ax - 7, ay - 14); g.lineTo(ax + 7, ay - 14); g.stroke();
    g.strokeStyle = '#3a2c22'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ax, ay - 34); g.lineTo(ax, ay - 8); g.stroke();
  }

  // ---- live light: window backlight, god-rays, candle flames, fog ----
  _light(ctx) {
    const { cx, cy, R } = this.win;
    const pulse = 0.5 + Math.sin(this.t * 1.7) * 0.22 + Math.sin(this.t * 5.3) * 0.05;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // unholy light breathing through the rose window
    const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, R * 2.6);
    halo.addColorStop(0, `rgba(255,150,80,${0.22 + pulse * 0.20})`);
    halo.addColorStop(0.4, `rgba(190,40,54,${0.10 + pulse * 0.10})`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);

    // god-rays fanning down from the window
    for (let i = -2; i <= 2; i++) {
      const sway = Math.sin(this.t * 0.6 + i) * 5;
      const topX = cx + i * 5, botX = cx + i * 26 + sway;
      const wTop = 3, wBot = 12;
      const ray = ctx.createLinearGradient(0, cy, 0, H - 30);
      ray.addColorStop(0, `rgba(255,190,120,${0.10 + pulse * 0.06})`);
      ray.addColorStop(1, 'rgba(255,150,90,0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(topX - wTop, cy); ctx.lineTo(topX + wTop, cy);
      ctx.lineTo(botX + wBot, H - 30); ctx.lineTo(botX - wBot, H - 30);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // candles along the ledge + warm pools of light
    const ly = 150;
    for (let i = 0; i < 5; i++) {
      const cxk = 44 + i * ((W - 88) / 4);
      this._candle(ctx, cxk, ly, i);
    }

    // low drifting fog
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const fy = H - 44 + i * 8;
      const off = Math.sin(this.t * 0.35 + i * 1.7) * 14;
      const fog = ctx.createLinearGradient(0, fy - 8, 0, fy + 8);
      fog.addColorStop(0, 'rgba(120,90,70,0)');
      fog.addColorStop(0.5, `rgba(140,110,86,${0.05 - i * 0.01})`);
      fog.addColorStop(1, 'rgba(120,90,70,0)');
      ctx.fillStyle = fog;
      ctx.beginPath();
      ctx.ellipse(W / 2 + off, fy, W * 0.6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _candle(ctx, x, ly, i) {
    // wax stick
    ctx.fillStyle = '#d8cdb2'; ctx.fillRect(x - 1.5, ly - 9, 3, 9);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 0.6, ly - 9, 0.9, 9);
    const flick = 0.75 + Math.sin(this.t * 12 + i * 2.3) * 0.16 + Math.sin(this.t * 27 + i) * 0.06;
    const fy = ly - 11;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // pool of light on the ledge
    const pool = ctx.createRadialGradient(x, ly, 0, x, ly, 16 * flick);
    pool.addColorStop(0, 'rgba(255,180,90,0.28)');
    pool.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = pool; ctx.fillRect(x - 20, ly - 12, 40, 24);
    // outer flame
    ctx.fillStyle = `rgba(255,150,60,0.85)`;
    ctx.beginPath(); ctx.ellipse(x, fy, 1.9 * flick, 3.6 * flick, 0, 0, Math.PI * 2); ctx.fill();
    // hot core
    ctx.fillStyle = 'rgba(255,236,170,0.95)';
    ctx.beginPath(); ctx.ellipse(x, fy + 0.4, 0.9 * flick, 1.8 * flick, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _embersDraw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this._embers) {
      const y = e.base - ((this.t * e.spd + e.seed * 12) % (e.base - 20));
      const x = e.x + Math.sin(this.t * 0.7 + e.seed) * 5;
      const a = Math.max(0, 0.5 + Math.sin(this.t * 2 + e.seed * 3) * 0.4) * 0.5;
      ctx.fillStyle = `rgba(255,150,70,${a})`;
      ctx.beginPath(); ctx.arc(x, y, e.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- carved-gold logo ----
  _drawLogo(ctx, y) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // fit the word to the frame
    let size = 34;
    ctx.font = `bold ${size}px ${SERIF}`;
    const maxW = 178;
    const w = ctx.measureText(this.title).width;
    if (w > maxW) { size *= maxW / w; ctx.font = `bold ${size}px ${SERIF}`; }
    const cx = W / 2;

    // outer unholy glow
    ctx.save();
    ctx.shadowColor = 'rgba(216,60,60,0.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(120,20,26,0.9)';
    ctx.fillText(this.title, cx, y);
    ctx.shadowBlur = 6;
    ctx.fillText(this.title, cx, y);
    ctx.restore();

    // cast shadow
    ctx.fillStyle = 'rgba(6,4,4,0.85)';
    ctx.fillText(this.title, cx + 2, y + 2.4);

    // dark carved outline (two passes for a bevelled edge)
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#170d08'; ctx.lineWidth = size * 0.14;
    ctx.strokeText(this.title, cx, y);
    ctx.strokeStyle = '#3f2a12'; ctx.lineWidth = size * 0.06;
    ctx.strokeText(this.title, cx, y);

    // gold face
    const grad = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
    grad.addColorStop(0, '#fff6d0');
    grad.addColorStop(0.42, '#f2cf5c');
    grad.addColorStop(0.62, '#c8931f');
    grad.addColorStop(1, '#7c5310');
    ctx.fillStyle = grad;
    ctx.fillText(this.title, cx, y);

    // top highlight rim
    ctx.fillStyle = 'rgba(255,252,232,0.55)';
    ctx.fillText(this.title, cx, y - size * 0.055);
    // re-lay the face slightly so the rim reads as a thin bevel, not a ghost
    const grad2 = ctx.createLinearGradient(0, y - size * 0.42, 0, y + size * 0.5);
    grad2.addColorStop(0, 'rgba(255,246,208,0)');
    grad2.addColorStop(0.28, '#f2cf5c');
    grad2.addColorStop(0.62, '#c8931f');
    grad2.addColorStop(1, '#7c5310');
    ctx.fillStyle = grad2;
    ctx.fillText(this.title, cx, y);

    ctx.restore();
    return size;
  }

  _flourish(ctx, y) {
    const cx = W / 2;
    ctx.save();
    ctx.strokeStyle = '#c9a04a';
    ctx.fillStyle = '#e6c766';
    ctx.lineWidth = 1;
    // rule with a central diamond and skull ends
    const half = 58;
    ctx.beginPath(); ctx.moveTo(cx - half, y); ctx.lineTo(cx - 8, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 8, y); ctx.lineTo(cx + half, y); ctx.stroke();
    // centre diamond
    ctx.beginPath(); ctx.moveTo(cx, y - 3); ctx.lineTo(cx + 3, y); ctx.lineTo(cx, y + 3); ctx.lineTo(cx - 3, y); ctx.closePath(); ctx.fill();
    // little skulls at the ends
    for (const sx of [cx - half - 3, cx + half + 3]) {
      ctx.fillStyle = '#d8d1bd';
      ctx.beginPath(); ctx.arc(sx, y - 0.5, 2.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a251c';
      ctx.fillRect(sx - 1.2, y - 1, 0.9, 0.9); ctx.fillRect(sx + 0.3, y - 1, 0.9, 0.9);
      ctx.fillRect(sx - 0.9, y + 1.1, 1.8, 1.2);
    }
    ctx.restore();
  }

  render(ctx) {
    if (!this._bg) this._bake();

    // baked architecture
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._bg, 0, 0, W, H);

    // live atmosphere
    this._light(ctx);
    this._embersDraw(ctx);

    // logo drop
    const targetY = H * 0.5;
    const startY = -34;
    const progress = Math.min(Math.max((this.t - this.fadeIn) / this.fallDuration, 0), 1);
    const eased = easeOutBounce(progress);
    const y = startY + (targetY - startY) * eased;

    const size = this._drawLogo(ctx, y);

    if (this.landed) {
      this._flourish(ctx, y + size * 0.62);

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `5px ${FONT}`;
      ctx.fillStyle = '#caa565';
      ctx.fillText(this.subtitle, W / 2, y + size * 0.62 + 12);

      // blinking, glowing PRESS A inside a small ornate frame
      const on = Math.floor(this.blink / 0.5) % 2 === 0;
      if (on) {
        ctx.font = `8px ${FONT}`;
        ctx.save();
        ctx.shadowColor = 'rgba(255,190,110,0.9)'; ctx.shadowBlur = 8;
        ctx.fillStyle = '#f7dd93';
        ctx.fillText('PRESS  A', W / 2, H - 15);
        ctx.restore();
        ctx.strokeStyle = 'rgba(201,160,74,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(W / 2 - 40, H - 15); ctx.lineTo(W / 2 - 30, H - 15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(W / 2 + 30, H - 15); ctx.lineTo(W / 2 + 40, H - 15); ctx.stroke();
      }
      ctx.restore();
    }

    // fade up from black
    if (this.t < this.fadeIn) {
      ctx.fillStyle = `rgba(0,0,0,${1 - this.t / this.fadeIn})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  exit() {}
}
