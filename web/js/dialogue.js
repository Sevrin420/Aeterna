// The abbey's dialogue box.
//
// One box for everything the player reads: the Doctrine, the mint rite, the
// bulletin, the prayers, and the instructions. Before this, that content was
// split between DOM overlays floating above the console and one-line toasts
// that scrolled away before they could be read — neither of which is inside
// the game's own world. A single in-canvas box means lore is read on the
// console screen, in the abbey's own palette, under the same rules as
// everything else in it.
//
// Construction follows the palette's five rules exactly (web/js/palette.js):
//
//   · The frame is built from discrete square TILES, each beveled — lit along
//     its top and left, shadowed along its bottom and right, and ringed in a
//     dark version of its own hue rather than black. That per-tile bevel is
//     what makes a border read as carved stone instead of a drawn rectangle,
//     and it is how LttP builds every frame it has.
//   · The frame is IRON, the palette's blue-violet gray, so it belongs to the
//     abbey's indigo world instead of looking pasted in from elsewhere.
//   · The interior is muted BLOOD, dark enough that gold text sits on it at
//     full contrast, with a lit inner lip along the top edge so the panel
//     reads as recessed.
//   · Text is GOLD — one saturated accent against the desaturated frame,
//     which keeps the crimson/gold pair the abbey already lives by.

import { IRON, BLOOD, GOLD, BONE, shade } from './palette.js';
import { sfx } from './sfx.js';

const W = 208, H = 208;          // logical console screen
const TILE = 8;                  // one border square
const BOX_W = 192, BOX_H = 176;  // 24 x 22 tiles — nearly the whole screen
const BOX_X = (W - BOX_W) / 2;
const BOX_Y = (H - BOX_H) / 2;

const PAD = 7;                   // interior padding inside the frame
const IN_X = BOX_X + TILE + PAD;
const IN_Y = BOX_Y + TILE + PAD;
const IN_W = BOX_W - (TILE + PAD) * 2;
const IN_H = BOX_H - (TILE + PAD) * 2;

const FONT = '6px "Courier New", monospace';
const LINE_H = 9;
const SPEAKER_H = 12;            // extra top offset when a page names a speaker
const CPS = 42;                  // characters per second — a readable crawl

// A single frame square. The bevel is drawn rather than blitted so the frame
// can be any size without a spritesheet, and so every tile is guaranteed to
// agree with the palette if the ramp is ever retuned.
function bevelTile(ctx, x, y) {
  ctx.fillStyle = IRON.o;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = IRON.b;
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  // lit top and left
  ctx.fillStyle = IRON.l;
  ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
  ctx.fillRect(x + 1, y + 1, 1, TILE - 2);
  ctx.fillStyle = IRON.h;
  ctx.fillRect(x + 1, y + 1, 2, 1);
  // shadowed bottom and right
  ctx.fillStyle = IRON.d;
  ctx.fillRect(x + 1, y + TILE - 2, TILE - 2, 1);
  ctx.fillRect(x + TILE - 2, y + 1, 1, TILE - 2);
}

export class DialogueBox {
  constructor() {
    this.pages = [];
    this.page = 0;
    this.t = 0;            // seconds since this page started printing
    this.open = false;
    this.onClose = null;
    this._lines = [];
    this._blink = 0;
    this._clickT = 0;
  }

  get active() { return this.open; }

  // `pages` is a string, or an array of strings, or an array of
  // { speaker, text }. Anything longer than the box is split across pages
  // automatically, so callers never have to think about layout.
  show(pages, { speaker = null, onClose = null } = {}) {
    const raw = Array.isArray(pages) ? pages : [pages];
    this.pages = [];
    for (const p of raw) {
      const text = typeof p === 'string' ? p : p.text;
      const who = typeof p === 'string' ? speaker : (p.speaker ?? speaker);
      const room = Math.floor((IN_H - (who ? SPEAKER_H : 0)) / LINE_H);
      const lines = this._wrap(text);
      // long entries spill onto further pages rather than overflowing the frame
      for (let i = 0; i < lines.length; i += room) {
        this.pages.push({ speaker: i === 0 ? who : null, lines: lines.slice(i, i + room) });
      }
    }
    this.page = 0;
    this.t = 0;
    this.open = true;
    this.onClose = onClose;
    this._lines = this.pages[0]?.lines || [];
    // The box is meant to be the only thing you are looking at, so the DOM
    // HUD sitting above the canvas steps aside. A class on <body> rather than
    // a callback keeps every scene free of HUD plumbing.
    document.body.classList.add('dialogue-open');
    sfx.click();
  }

  close() {
    this.open = false;
    this.pages = [];
    document.body.classList.remove('dialogue-open');
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  }

  // Measured against the real font so wrapping matches what is drawn, rather
  // than guessing a character width and hoping.
  _wrap(text) {
    const cv = DialogueBox._measure || (DialogueBox._measure =
      document.createElement('canvas').getContext('2d'));
    cv.font = FONT;
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (cv.measureText(next).width > IN_W && line) { out.push(line); line = word; }
        else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  }

  get _charsOnPage() {
    return this._lines.reduce((n, l) => n + l.length, 0);
  }

  get _printed() { return Math.floor(this.t * CPS); }
  get _pageDone() { return this._printed >= this._charsOnPage; }

  // Returns true if it consumed the input, so the scene underneath knows not
  // to also act on the same press.
  update(dt, input) {
    if (!this.open) return false;
    this.t += dt;
    this._blink += dt;

    // a soft tick while letters land, throttled so it reads as a voice rather
    // than a buzz
    if (!this._pageDone) {
      this._clickT += dt;
      if (this._clickT > 0.055) { this._clickT = 0; sfx.click(); }
    }

    if (input.consumeAPress()) {
      if (!this._pageDone) {
        this.t = this._charsOnPage / CPS;      // first press finishes the page
      } else if (this.page < this.pages.length - 1) {
        this.page++;
        this.t = 0;
        this._lines = this.pages[this.page].lines;
      } else {
        this.close();
      }
    } else if (input.consumeBPress()) {
      this.close();
    }
    return true;
  }

  render(ctx) {
    if (!this.open) return;

    // darken the world behind, so the box is plainly a separate surface
    ctx.fillStyle = 'rgba(8,6,17,0.55)';
    ctx.fillRect(0, 0, W, H);

    // --- interior: muted blood, lit at the top lip ---
    const ix = BOX_X + TILE, iy = BOX_Y + TILE;
    const iw = BOX_W - TILE * 2, ih = BOX_H - TILE * 2;
    const g = ctx.createLinearGradient(0, iy, 0, iy + ih);
    g.addColorStop(0, '#4a1119');
    g.addColorStop(1, '#2c0a10');
    ctx.fillStyle = g;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(198,43,48,0.22)';
    ctx.fillRect(ix, iy, iw, 1);
    ctx.fillStyle = 'rgba(20,6,10,0.5)';
    ctx.fillRect(ix, iy + ih - 1, iw, 1);

    // --- frame: a ring of beveled squares ---
    const cols = BOX_W / TILE, rows = BOX_H / TILE;
    for (let c = 0; c < cols; c++) {
      bevelTile(ctx, BOX_X + c * TILE, BOX_Y);
      bevelTile(ctx, BOX_X + c * TILE, BOX_Y + (rows - 1) * TILE);
    }
    for (let r = 1; r < rows - 1; r++) {
      bevelTile(ctx, BOX_X, BOX_Y + r * TILE);
      bevelTile(ctx, BOX_X + (cols - 1) * TILE, BOX_Y + r * TILE);
    }

    // --- text ---
    const pg = this.pages[this.page];
    if (!pg) return;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = FONT;

    let y = IN_Y + 6;
    if (pg.speaker) {
      ctx.fillStyle = BLOOD.l;
      ctx.fillText(pg.speaker.toUpperCase(), IN_X, y);
      ctx.fillStyle = 'rgba(232,90,74,0.32)';
      ctx.fillRect(IN_X, y + 3, IN_W, 1);
      y += SPEAKER_H;
    }

    // print character by character across the page's lines
    let budget = this._printed;
    ctx.fillStyle = GOLD.l;
    for (const line of pg.lines) {
      if (budget <= 0) break;
      const shown = line.slice(0, budget);
      budget -= line.length;
      if (shown) ctx.fillText(shown, IN_X, y);
      y += LINE_H;
    }

    // continue / close indicator, only once the page has finished printing
    if (this._pageDone && Math.floor(this._blink * 2) % 2 === 0) {
      const last = this.page >= this.pages.length - 1;
      ctx.fillStyle = GOLD.h;
      const cx = BOX_X + BOX_W - TILE - 9;
      const cy = BOX_Y + BOX_H - TILE - 7;
      if (last) {
        // a small filled square: "close"
        ctx.fillRect(cx, cy - 3, 4, 4);
      } else {
        // a down chevron: "more"
        ctx.beginPath();
        ctx.moveTo(cx - 1, cy - 4); ctx.lineTo(cx + 5, cy - 4); ctx.lineTo(cx + 2, cy);
        ctx.closePath(); ctx.fill();
      }
    }

    // page count, quiet, only when there is more than one
    if (this.pages.length > 1) {
      ctx.fillStyle = shade(BONE.d, -40);
      ctx.textAlign = 'left';
      ctx.fillText(`${this.page + 1}/${this.pages.length}`, IN_X, BOX_Y + BOX_H - TILE - 4);
    }
    ctx.textAlign = 'left';
  }
}

// The gold "!" that floats over a character when something can be done where
// they stand. It replaces the line of prompt text that used to sit along the
// bottom of the screen: the information belongs at the player's feet, where
// they are already looking, not in a caption bar away from the action.
//
// Drawn as pixels rather than set as a font glyph — at 6px a typographic "!"
// is three grey smudges, while a built mark keeps a hard outline and a lit
// face like every other object in the abbey.
export function drawBang(ctx, x, y, t) {
  const bob = Math.sin(t * 5) * 1.2;
  const by = y + bob;
  ctx.save();
  // dark halo so it holds against a lit brazier or a pale floor
  ctx.fillStyle = 'rgba(20,12,4,0.45)';
  ctx.fillRect(x - 3, by - 11, 6, 13);
  // outline in dark gold, never black
  ctx.fillStyle = GOLD.o;
  ctx.fillRect(x - 2, by - 10, 4, 8);
  ctx.fillRect(x - 2, by - 1, 4, 3);
  // body
  ctx.fillStyle = GOLD.b;
  ctx.fillRect(x - 1, by - 9, 2, 6);
  ctx.fillRect(x - 1, by, 2, 2);
  // lit upper-left edge, matching the key light everything else uses
  ctx.fillStyle = GOLD.h;
  ctx.fillRect(x - 1, by - 9, 1, 4);
  ctx.fillRect(x - 1, by, 1, 1);
  ctx.restore();
}
