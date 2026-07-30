// The Antechamber — the first room after boot. A dim stone entry hall to the
// cult's sanctuary. The player arrives as a bodiless SPIRIT. A north archway
// leads deeper; flanking it are two stone tables staffed by cultists, signed
// MINT (left) and DOCS (right) — the same layout as Club Nile's foyer. Walking
// into the archway asks the player to connect a wallet and choose a Cultist;
// with none, they drift through as a spirit.

import { drawCharacter, getCultistSprite } from '../spritesheet.js';
import { getWalletId } from '../api.js';
import { sfx } from '../sfx.js';

const W = 208, H = 206;

// room interior bounds (inside the stone walls)
const IN = { x0: 15, y0: 26, x1: 193, y1: 188 };

// north archway (the way deeper in)
const ARCH = { x0: 86, x1: 122, y: 24 };

// two staffed stone tables flanking the arch
const TABLES = [
  { id: 'mint', label: 'MINT', cx: 52, cy: 70, w: 44, h: 15 },
  { id: 'docs', label: 'DOCS', cx: 156, cy: 70, w: 44, h: 15 },
];

export class EntranceScene {
  constructor({ player, onDocs, onMint, onWallet, isBusy }) {
    this.player = player;
    this.onDocs = onDocs || (() => {});
    this.onMint = onMint || (() => {});
    this.onWallet = onWallet || (() => {});
    this.isBusy = isBusy || (() => false);

    this.t = 0;
    this.locked = false;
    this.pc = { x: 104, y: 168, w: 7, h: 7, speed: 42, dir: 'up', moving: false, bob: 0 };
    this.sheet = getCultistSprite(getWalletId(), player?.sex || 'male');
    this._prompt = null;
  }

  enter() {}
  exit() {}

  // called by main after the wallet overlay is dismissed without entering
  resume() {
    this.locked = false;
    this.pc.y = Math.min(IN.y1 - 6, this.pc.y + 26); // step back out of the arch
  }

  _blocked(nx, ny) {
    const half = this.pc.w / 2;
    if (nx - half < IN.x0 || nx + half > IN.x1 || ny - half < IN.y0 || ny + half > IN.y1) {
      // outside the walls is solid, EXCEPT the arch gap at the top
      const inArchX = nx > ARCH.x0 && nx < ARCH.x1;
      if (!(inArchX && ny - half < IN.y0)) return true;
    }
    for (const tb of TABLES) {
      if (Math.abs(nx - tb.cx) < tb.w / 2 + half && Math.abs(ny - tb.cy) < tb.h / 2 + half) return true;
    }
    return false;
  }

  update(dt, input) {
    this.t += dt;
    if (this.locked || this.isBusy()) { input.consumeAPress?.(); input.consumeBPress?.(); return; }

    const p = this.pc;
    let dx = 0, dy = 0;
    if (input.dirs.up) { dy -= 1; p.dir = 'up'; }
    if (input.dirs.down) { dy += 1; p.dir = 'down'; }
    if (input.dirs.left) { dx -= 1; p.dir = 'left'; }
    if (input.dirs.right) { dx += 1; p.dir = 'right'; }
    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) {
      const len = Math.hypot(dx, dy) || 1;
      const nx = p.x + (dx / len) * p.speed * dt;
      const ny = p.y + (dy / len) * p.speed * dt;
      if (!this._blocked(nx, p.y)) p.x = nx;
      if (!this._blocked(p.x, ny)) p.y = ny;
      p.bob += dt * 8;
    }

    // walking up through the archway -> connect wallet / choose a Cultist
    if (p.y < IN.y0 + 4 && p.x > ARCH.x0 && p.x < ARCH.x1) {
      this.locked = true;
      this.onWallet();
      return;
    }

    // nearest interactable table
    this._prompt = null;
    let best = 99;
    for (const tb of TABLES) {
      const d = Math.hypot(p.x - tb.cx, p.y - (tb.cy + tb.h));
      if (d < 22 && d < best) { best = d; this._prompt = tb.id; }
    }
    if (p.y < IN.y0 + 22 && p.x > ARCH.x0 - 6 && p.x < ARCH.x1 + 6) this._prompt = this._prompt || 'arch';

    if (input.consumeAPress?.()) {
      if (this._prompt === 'mint') this.onMint();
      else if (this._prompt === 'docs') this.onDocs();
    }
    input.consumeBPress?.();
  }

  // ---- rendering ----
  render(ctx) {
    ctx.fillStyle = '#060507';
    ctx.fillRect(0, 0, W, H);

    this._drawFloor(ctx);
    this._drawWalls(ctx);
    this._drawArch(ctx);

    // depth-sorted: tables+staff+signs, then the spirit
    const items = [];
    for (const tb of TABLES) items.push({ y: tb.cy + tb.h, draw: () => this._drawTable(ctx, tb) });
    items.push({ y: this.pc.y, draw: () => this._drawSpirit(ctx) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // heavy vignette
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // prompt / hint
    ctx.textAlign = 'center';
    ctx.font = '6px "Courier New", monospace';
    ctx.fillStyle = '#f4e5bd';
    const bounce = Math.sin(this.t * 6) * 1.2;
    if (this._prompt === 'mint') ctx.fillText('[A] Mint a Cultist', W / 2, H - 16 + bounce);
    else if (this._prompt === 'docs') ctx.fillText('[A] Read the Doctrine', W / 2, H - 16 + bounce);
    else if (this._prompt === 'arch') ctx.fillText('Walk north to enter…', W / 2, H - 16 + bounce);

    ctx.textAlign = 'left';
  }

  _drawFloor(ctx) {
    for (let y = IN.y0; y < IN.y1; y += 8) {
      for (let x = IN.x0; x < IN.x1; x += 8) {
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        ctx.fillStyle = (h % 3 === 0) ? '#34323d' : (h % 3 === 1) ? '#2f2d37' : '#322f39';
        ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(x, y + 7, 8, 1);
      }
    }
    // blood-red runner from the arch to the south
    ctx.fillStyle = 'rgba(96,16,20,0.55)';
    ctx.fillRect(W / 2 - 9, IN.y0, 18, IN.y1 - IN.y0);
    ctx.fillStyle = 'rgba(150,30,34,0.25)';
    ctx.fillRect(W / 2 - 9, IN.y0, 1, IN.y1 - IN.y0);
    ctx.fillRect(W / 2 + 8, IN.y0, 1, IN.y1 - IN.y0);
  }

  _drawWalls(ctx) {
    ctx.fillStyle = '#191820';
    // top wall (with arch gap), bottom, left, right
    ctx.fillRect(0, 0, W, IN.y0);            // north band
    ctx.fillRect(0, IN.y1, W, H - IN.y1);    // south band
    ctx.fillRect(0, 0, IN.x0, H);            // west
    ctx.fillRect(IN.x1, 0, W - IN.x1, H);    // east
    // carve the arch opening back out of the north band
    ctx.fillStyle = '#060507';
    ctx.fillRect(ARCH.x0, 0, ARCH.x1 - ARCH.x0, IN.y0);
    // cold top-edge light on the inner wall faces
    ctx.fillStyle = 'rgba(80,82,100,0.18)';
    ctx.fillRect(IN.x0, IN.y0 - 1.5, IN.x1 - IN.x0, 1.5);
  }

  _drawArch(ctx) {
    const { x0, x1 } = ARCH;
    // stone jambs
    ctx.fillStyle = '#242230';
    ctx.fillRect(x0 - 3, 0, 3, IN.y0 + 2);
    ctx.fillRect(x1, 0, 3, IN.y0 + 2);
    // red glow spilling from beyond
    const gl = ctx.createLinearGradient(0, 0, 0, IN.y0 + 10);
    gl.addColorStop(0, 'rgba(200,40,40,0.32)');
    gl.addColorStop(1, 'rgba(200,40,40,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x0, 0, x1 - x0, IN.y0 + 10);
    // an inverted-cross keystone over the arch
    const cx = (x0 + x1) / 2;
    ctx.fillStyle = '#8f8a97';
    ctx.fillRect(cx - 0.8, 3, 1.6, 12);
    ctx.fillRect(cx - 3.5, 11, 7, 1.6);
    // beckoning arrow
    ctx.fillStyle = '#d24b4b';
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲', cx, IN.y0 + 6 + (Math.floor(this.t * 3) % 2));
    ctx.textAlign = 'left';
  }

  _drawTable(ctx, tb) {
    const { cx, cy, w, h, id, label } = tb;
    // sign on a post, raised above the staffer's head
    const sy = cy - 34;
    ctx.fillStyle = '#241a12';
    ctx.fillRect(cx - 1.5, sy + 6, 3, 30);
    ctx.fillStyle = '#3a2c18';
    ctx.fillRect(cx - 15, sy - 3, 30, 12);
    ctx.fillStyle = id === 'mint' ? '#5c1a1a' : '#1f3d2a';
    ctx.fillRect(cx - 13, sy - 1, 26, 8);
    ctx.fillStyle = '#e6d8a6';
    ctx.font = '6px "Press Start 2P", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, sy + 5);
    ctx.textAlign = 'left';

    // the cultist staffer standing behind the table
    ctx.save();
    ctx.globalAlpha = 1;
    const staffSheet = getCultistSprite(`staff-${id}`, id === 'mint' ? 'male' : 'female');
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, cy - 3, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    drawCharacter(ctx, { sheet: staffSheet, dir: 'down', moving: false, animPhase: this.t + cx, x: cx, groundY: cy - 3, targetHeight: 21 });
    ctx.restore();

    // stone table/counter in front
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cx - w / 2 + 1, cy + h - 2, w - 2, 3);
    ctx.fillStyle = '#3b3946';
    ctx.fillRect(cx - w / 2, cy, w, h);
    ctx.fillStyle = '#4a4856';
    ctx.fillRect(cx - w / 2, cy, w, 2.4);
    ctx.fillStyle = '#141217';
    ctx.fillRect(cx - w / 2, cy + h - 2, w, 2);
    for (let x = cx - w / 2 + 4; x < cx + w / 2 - 2; x += 6) {
      ctx.fillStyle = 'rgba(10,9,13,0.6)';
      ctx.fillRect(x, cy + 3, 0.7, h - 5);
    }
    // a candle on the counter
    const flick = 0.7 + Math.sin(this.t * 11 + cx) * 0.2;
    const px = cx + w / 2 - 6, py = cy + 2;
    const pool = ctx.createRadialGradient(px, py, 0.5, px, py, 10);
    pool.addColorStop(0, `rgba(255,170,80,${0.14 + flick * 0.08})`);
    pool.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = pool; ctx.fillRect(px - 10, py - 10, 20, 20);
    ctx.fillStyle = '#161318'; ctx.fillRect(px - 1, py - 4, 2, 5);
    ctx.fillStyle = `rgba(255,190,110,${flick})`;
    ctx.beginPath(); ctx.ellipse(px, py - 6, 1, 2, 0, 0, Math.PI * 2); ctx.fill();
  }

  _drawSpirit(ctx) {
    const p = this.pc;
    const x = Math.round(p.x);
    const bob = Math.sin(this.t * 2.2) * 1.4;
    const y = Math.round(p.y + bob);
    // spectral glow
    const glow = ctx.createRadialGradient(x, y - 4, 1, x, y - 4, 13);
    glow.addColorStop(0, 'rgba(150,200,220,0.30)');
    glow.addColorStop(1, 'rgba(150,200,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 13, y - 17, 26, 26);
    // faint wisp instead of a shadow
    ctx.fillStyle = 'rgba(150,200,220,0.12)';
    ctx.beginPath(); ctx.ellipse(x, y + 5, 5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    // translucent, cool-tinted body
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawCharacter(ctx, { sheet: this.sheet, dir: p.dir, moving: p.moving, animPhase: p.moving ? p.bob : this.t, x, groundY: y + 6, targetHeight: 21 });
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(140,190,220,1)';
    ctx.fillRect(x - 8, y - 16, 16, 22);
    ctx.restore();
  }
}
