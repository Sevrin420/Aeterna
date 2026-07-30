// The Antechamber — the first room after boot. A dim stone entry hall to the
// cult's sanctuary. The player arrives as a bodiless SPIRIT. A north archway
// leads deeper; flanking it are two stone tables staffed by cultists, signed
// MINT (left) and DOCS (right) — the same layout as Club Nile's foyer. Walking
// into the archway asks the player to connect a wallet and choose a Cultist;
// with none, they drift through as a spirit.

import { drawCharacter, getCultistSprite } from '../spritesheet.js';
import { getWalletId } from '../api.js';
import { sfx } from '../sfx.js';
import { h2 } from '../abbeyMap.js';
import {
  FLOOR, WALL, VOID, BLOOD, GOLD, WOOD, BONE, MOSS, IRON,
  SHADOW, shade, block, candleFlame,
} from '../palette.js';

const W = 208, H = 206;
const T = 10; // same tile size the abbey is drawn on, so both rooms match

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
    ctx.fillStyle = VOID;
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
    g.addColorStop(0.7, 'rgba(6,4,17,0.34)');
    g.addColorStop(1, 'rgba(6,4,17,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // prompt / hint
    ctx.textAlign = 'center';
    ctx.font = '6px "Courier New", monospace';
    ctx.fillStyle = GOLD.h;
    const bounce = Math.sin(this.t * 6) * 1.2;
    if (this._prompt === 'mint') ctx.fillText('[A] Mint a Cultist', W / 2, H - 16 + bounce);
    else if (this._prompt === 'docs') ctx.fillText('[A] Read the Doctrine', W / 2, H - 16 + bounce);
    else if (this._prompt === 'arch') ctx.fillText('Walk north to enter…', W / 2, H - 16 + bounce);

    ctx.textAlign = 'left';
  }

  // Same five passes the abbey's tile layer uses (web/js/scenes/courtyard.js):
  // flagstone slabs with grout every two tiles, the crimson runner, wall mass in
  // staggered courses, a lit face where the wall meets the floor, and a contact
  // shadow along every wall. The lobby used to be drawn on its own grey palette
  // in 8px squares, which is why it read as a different game to the sanctuary.
  _drawFloor(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(IN.x0, IN.y0, IN.x1 - IN.x0, IN.y1 - IN.y0);
    ctx.clip();
    for (let r = Math.floor(IN.y0 / T); r * T < IN.y1; r++) {
      for (let c = Math.floor(IN.x0 / T); c * T < IN.x1; c++) {
        const x = c * T, y = r * T, n = h2(c, r);
        const v = h2(c >> 1, r >> 1) % 3;
        ctx.fillStyle = v === 0 ? FLOOR.b : v === 1 ? shade(FLOOR.b, -9) : shade(FLOOR.b, 7);
        ctx.fillRect(x, y, T, T);
        if (r % 2 === 1) { ctx.fillStyle = FLOOR.o; ctx.fillRect(x, y + T - 2, T, 2); }
        else { ctx.fillStyle = shade(FLOOR.b, 16); ctx.fillRect(x, y, T, 1); }
        if (c % 2 === 1) { ctx.fillStyle = FLOOR.d; ctx.fillRect(x + T - 1, y, 1, T); }
        else { ctx.fillStyle = shade(FLOOR.b, 10); ctx.fillRect(x, y, 1, T); }
        if (n % 17 === 0) { ctx.fillStyle = FLOOR.d; ctx.fillRect(x + 3, y + 4, 4, 1); }
        if (n % 23 === 0) { ctx.fillStyle = FLOOR.h; ctx.fillRect(x + 5, y + 2, 2, 2); }
      }
    }
    this._drawRunner(ctx);
    // contact shadow where the floor meets each wall
    const iw = IN.x1 - IN.x0, ih = IN.y1 - IN.y0;
    ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fillRect(IN.x0, IN.y0, iw, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(IN.x0, IN.y0, 3, ih);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(IN.x1 - 3, IN.y0, 3, ih);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(IN.x0, IN.y1 - 3, iw, 3);
    ctx.restore();
  }

  // The aisle runner, built exactly like the nave's: crimson a step down from
  // the accent value, one lit edge, gold piping and a sparse woven diamond.
  _drawRunner(ctx) {
    const cx = W / 2, w = 9, y0 = IN.y0, y1 = IN.y1;
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(cx - w - 2, y0, w * 2 + 4, y1 - y0);
    ctx.fillStyle = BLOOD.o; ctx.fillRect(cx - w, y0, w * 2, y1 - y0);
    ctx.fillStyle = BLOOD.d; ctx.fillRect(cx - w + 1.5, y0, w * 2 - 3, y1 - y0);
    ctx.fillStyle = BLOOD.b; ctx.fillRect(cx - w + 1.5, y0, 1.2, y1 - y0);
    ctx.fillStyle = GOLD.o;
    ctx.fillRect(cx - w + 3.4, y0, 0.8, y1 - y0);
    ctx.fillRect(cx + w - 4.2, y0, 0.8, y1 - y0);
    for (let y = y0 + 8; y < y1 - 8; y += 28) {
      ctx.fillStyle = GOLD.o;
      ctx.beginPath();
      ctx.moveTo(cx, y); ctx.lineTo(cx + 2.4, y + 3.2);
      ctx.lineTo(cx, y + 6.4); ctx.lineTo(cx - 2.4, y + 3.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = GOLD.d; ctx.fillRect(cx - 0.8, y + 2.6, 1.6, 1.2);
    }
  }

  _drawWalls(ctx) {
    const bands = [
      [0, 0, W, IN.y0],            // north
      [0, IN.y1, W, H - IN.y1],    // south
      [0, 0, IN.x0, H],            // west
      [IN.x1, 0, W - IN.x1, H],    // east
    ];
    for (const [bx, by, bw, bh] of bands) {
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      for (let r = Math.floor(by / T); r * T < by + bh; r++) {
        for (let c = Math.floor(bx / T); c * T < bx + bw; c++) {
          const x = c * T, y = r * T, v = h2(c >> 1, r) % 3;
          ctx.fillStyle = v === 0 ? WALL.d : v === 1 ? shade(WALL.d, -7) : shade(WALL.d, 6);
          ctx.fillRect(x, y, T, T);
          ctx.fillStyle = shade(WALL.d, 14); ctx.fillRect(x, y, T, 1.6);
          ctx.fillStyle = WALL.o;
          ctx.fillRect(x, y + T - 2, T, 2);
          ctx.fillRect(x + (r % 2) * 5, y, 2, T);
        }
      }
      ctx.restore();
    }
    // The lit south face of the north band — the course that fronts open floor.
    // This is the pass that makes a 3/4 room read as built rather than flat.
    const fy = IN.y0 - T;
    for (let c = 0; c * T < W; c++) {
      const x = c * T;
      if (x + T > ARCH.x0 && x < ARCH.x1) continue;   // skip the opening
      ctx.fillStyle = WALL.o; ctx.fillRect(x, fy - 1, T, T + 1);
      ctx.fillStyle = WALL.b; ctx.fillRect(x, fy + 1, T, T - 3);
      ctx.fillStyle = WALL.l; ctx.fillRect(x, fy + 1, T, 2.4);
      ctx.fillStyle = WALL.h; ctx.fillRect(x, fy + 1, 3.5, 1.2);
      ctx.fillStyle = WALL.d; ctx.fillRect(x, fy + T - 4, T, 2);
      ctx.fillStyle = WALL.o; ctx.fillRect(x + ((c % 2) ? 3 : 7), fy + 3.4, 1.6, T - 7);
    }
  }

  // The way deeper in, drawn exactly like the abbey's way out: no arch, no
  // keystone — the wall simply stops, and the two cut ends are gilded.
  _drawArch(ctx) {
    const { x0, x1 } = ARCH;
    const cx = (x0 + x1) / 2, fy = IN.y0 - T;
    ctx.fillStyle = VOID;
    ctx.fillRect(x0, 0, x1 - x0, IN.y0);
    // red glow spilling from the sanctuary beyond
    const gl = ctx.createLinearGradient(0, 0, 0, IN.y0 + 12);
    gl.addColorStop(0, 'rgba(198,43,48,0.30)');
    gl.addColorStop(1, 'rgba(198,43,48,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(x0, 0, x1 - x0, IN.y0 + 12);
    // threshold: the floor darkens as it runs into the opening
    const th = ctx.createLinearGradient(0, IN.y0, 0, IN.y0 + 8);
    th.addColorStop(0, 'rgba(8,6,17,0.85)');
    th.addColorStop(1, 'rgba(8,6,17,0)');
    ctx.fillStyle = th;
    ctx.fillRect(x0, IN.y0, x1 - x0, 8);
    // the cut ends of the wall, gilded
    for (const ex of [x0 - 3, x1]) {
      ctx.fillStyle = GOLD.o; ctx.fillRect(ex, fy, 3, T);
      ctx.fillStyle = GOLD.d; ctx.fillRect(ex, fy + 1, 3, T - 2);
      ctx.fillStyle = GOLD.b; ctx.fillRect(ex, fy + 1, 3, 2);
      ctx.fillStyle = GOLD.h; ctx.fillRect(ex, fy + 1, 1.3, 1);
    }
    // beckoning arrow
    ctx.fillStyle = GOLD.b;
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲', cx, IN.y0 + 8 + (Math.floor(this.t * 3) % 2));
    ctx.textAlign = 'left';
  }

  _drawTable(ctx, tb) {
    const { cx, cy, w, h, id, label } = tb;
    // sign on a post, raised above the staffer's head
    const sy = cy - 34;
    ctx.fillStyle = WOOD.o; ctx.fillRect(cx - 1.8, sy + 6, 3.6, 30);   // post
    ctx.fillStyle = WOOD.b; ctx.fillRect(cx - 1.2, sy + 6, 2.4, 30);
    ctx.fillStyle = WOOD.l; ctx.fillRect(cx - 1.2, sy + 6, 0.8, 30);
    block(ctx, cx - 15, sy - 3, 30, 12, WOOD);                          // board
    const panel = id === 'mint' ? BLOOD : MOSS;
    ctx.fillStyle = panel.o; ctx.fillRect(cx - 13.5, sy - 1.5, 27, 9);
    ctx.fillStyle = panel.d; ctx.fillRect(cx - 13, sy - 1, 26, 8);
    ctx.fillStyle = panel.b; ctx.fillRect(cx - 13, sy - 1, 26, 1);
    ctx.fillStyle = BONE.h;
    ctx.font = '6px "Press Start 2P", "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, sy + 5);
    ctx.textAlign = 'left';

    // the cultist staffer standing behind the table
    ctx.save();
    ctx.globalAlpha = 1;
    const staffSheet = getCultistSprite(`staff-${id}`, id === 'mint' ? 'male' : 'female');
    ctx.fillStyle = SHADOW;
    ctx.beginPath(); ctx.ellipse(cx, cy - 3, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    drawCharacter(ctx, { sheet: staffSheet, dir: 'down', moving: false, animPhase: this.t + cx, x: cx, groundY: cy - 3, targetHeight: 21 });
    ctx.restore();

    // dressed-stone counter in front, gilded along its lit edge
    ctx.fillStyle = SHADOW;
    ctx.fillRect(cx - w / 2 + 1, cy + h - 1, w - 2, 3);
    block(ctx, cx - w / 2, cy, w, h, WALL);
    ctx.fillStyle = GOLD.d; ctx.fillRect(cx - w / 2, cy, w, 1.6);
    ctx.fillStyle = GOLD.b; ctx.fillRect(cx - w / 2, cy, w, 0.7);
    ctx.fillStyle = WALL.o;
    for (let x = cx - w / 2 + 5; x < cx + w / 2 - 2; x += 7) ctx.fillRect(x, cy + 3, 1, h - 5);

    // a candle on the counter
    const px = cx + w / 2 - 6, py = cy + 2;
    const flick = 0.7 + Math.sin(this.t * 11 + cx) * 0.2;
    const pool = ctx.createRadialGradient(px, py, 0.5, px, py, 11);
    pool.addColorStop(0, `rgba(255,170,70,${0.15 + flick * 0.08})`);
    pool.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = pool; ctx.fillRect(px - 11, py - 11, 22, 22);
    ctx.fillStyle = IRON.o; ctx.fillRect(px - 1.4, py - 4, 2.8, 5);
    ctx.fillStyle = IRON.d; ctx.fillRect(px - 1, py - 4, 2, 5);
    ctx.fillStyle = GOLD.d; ctx.fillRect(px - 2, py + 0.6, 4, 1.4);
    candleFlame(ctx, px, py - 6, this.t, cx);
  }

  _drawSpirit(ctx) {
    const p = this.pc;
    const x = Math.round(p.x);
    const bob = Math.sin(this.t * 2.2) * 1.4;
    const y = Math.round(p.y + bob);
    // spectral glow
    const glow = ctx.createRadialGradient(x, y - 4, 1, x, y - 4, 13);
    glow.addColorStop(0, 'rgba(154,114,220,0.32)');
    glow.addColorStop(1, 'rgba(154,114,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 13, y - 17, 26, 26);
    // faint wisp instead of a shadow
    ctx.fillStyle = 'rgba(154,114,220,0.14)';
    ctx.beginPath(); ctx.ellipse(x, y + 5, 5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    // translucent, cool-tinted body
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawCharacter(ctx, { sheet: this.sheet, dir: p.dir, moving: p.moving, animPhase: p.moving ? p.bob : this.t, x, groundY: y + 6, targetHeight: 21 });
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(200,174,242,1)';
    ctx.fillRect(x - 8, y - 16, 16, 22);
    ctx.restore();
  }
}
