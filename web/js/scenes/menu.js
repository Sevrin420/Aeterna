// The title menu — what the console shows once the title card is dismissed.
//
// This replaces the entrance courtyard, which was a whole walkable scene whose
// only job was to hold two signposts (docs, mint) and a door north. A player
// had to learn the controls and cross a courtyard before finding out what the
// game was, and the two things they most needed — is my wallet on, and how many
// Cultists do I hold — were nowhere in it.
//
// It is built out of the dialogue box's own frame and ground (drawPanel), not a
// lookalike: the box is the abbey's one piece of chrome, and the first screen of
// the game should plainly be made of the same stuff as the last.
//
// Layout, top to bottom:
//   the wallet line          connected / not, and the address if it is
//   a large rotating Cultist turning through all four facings, x N beside it
//   a grid of buttons        Wallet / Play / Mint / Docs / Lines

import { drawPanel, PANEL_TILE, THEMES } from '../dialogue.js';
import { drawCharacter, getCultistSprite } from '../spritesheet.js';
import { BLOOD, GOLD, BONE, VOID, SHADOW, block } from '../palette.js';
import { sfx } from '../sfx.js';
import { GAME_NAME } from '../config.js';

// The title over the mint/wallet panel, in the panel's own capitals. Taken from
// the one name in config.js, so ?oldName=1 rolls this back with everything else.
const TITLE = GAME_NAME.toUpperCase();

const W = 208, H = 208;
const BOX_W = 192, BOX_H = 176;
const BOX_X = (W - BOX_W) / 2, BOX_Y = (H - BOX_H) / 2;

const FACES = ['down', 'left', 'up', 'right'];   // the order a body turns in
const TURN = 1.15;                               // seconds a facing is held
// How tall the display Cultist is. Came down from 58 when the grid grew a
// third row: the buttons rise to meet it, and at 58 the bird stood with its
// feet behind WALLET and PLAY.
const CULT_H = 44;

// The grid, two columns wide, in reading order. It no longer has to be square:
// ACCOUNT is a fifth entry and sits alone on the bottom row.
const BUTTONS = [
  { id: 'wallet', label: 'WALLET' },
  { id: 'play', label: 'PLAY' },
  { id: 'mint', label: 'MINT' },
  { id: 'docs', label: 'DOCS' },
  // The id stays 'lines' — it is what main.js dispatches on and what the
  // screen it opens is still called in the code. Only the word on the
  // button changed: LINES meant nothing to anyone who had not already been
  // told what it meant.
  { id: 'lines', label: 'ACCOUNT' },
];
const COLS = 2;
const ROWS = Math.ceil(BUTTONS.length / COLS);
const BTN_W = 64, BTN_H = 18, BTN_GAP_X = 6, BTN_GAP_Y = 6;   // 20% smaller

export class MenuScene {
  constructor({ wallet = null, cultists = 0, seed = 'menu', sex = 'male',
    onConnect = () => {}, onPlay = () => {}, onMint = () => {}, onDocs = () => {},
    onLines = () => {} } = {}) {
    this.wallet = wallet;
    this.cultists = cultists;
    this.sheet = getCultistSprite(seed, sex);
    this.on = { wallet: onConnect, play: onPlay, mint: onMint, docs: onDocs, lines: onLines };
    this.t = 0;
    this.sel = wallet ? 1 : 0;                   // land on PLAY if already bound
    this.busy = false;
    this.status = null;     // a line under the title while connecting, or why it failed
  }

  // Called when the wallet connects or the holdings come back, so the panel
  // updates in place rather than being rebuilt.
  setWallet(wallet, cultists, seed, sex) {
    this.wallet = wallet;
    if (cultists != null) this.cultists = cultists;
    if (seed) this.sheet = getCultistSprite(seed, sex || 'male');
  }

  enter() {}
  exit() {}

  _btnRect(i) {
    const gh = BTN_H * ROWS + BTN_GAP_Y * (ROWS - 1);
    const y0 = BOX_Y + BOX_H - PANEL_TILE - 8 - gh;
    const col = i % COLS, row = Math.floor(i / COLS);
    // A lone button on the last row is centred rather than left-hanging.
    const inRow = Math.min(COLS, BUTTONS.length - row * COLS);
    const rowW = BTN_W * inRow + BTN_GAP_X * (inRow - 1);
    return {
      x: (W - rowW) / 2 + col * (BTN_W + BTN_GAP_X),
      y: y0 + row * (BTN_H + BTN_GAP_Y),
      w: BTN_W, h: BTN_H,
    };
  }

  // Pointer support, so the menu works by tapping as well as by d-pad. The
  // console's own canvas is scaled, so the caller passes logical coordinates.
  pointerAt(lx, ly, click) {
    for (let i = 0; i < BUTTONS.length; i++) {
      const r = this._btnRect(i);
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) {
        if (this.sel !== i) { this.sel = i; sfx.click(); }
        if (click) this._fire();
        return true;
      }
    }
    return false;
  }

  _fire() {
    if (this.busy) return;
    this.status = null;
    const b = BUTTONS[this.sel];
    sfx.bootConfirm();
    this.on[b.id]();
  }

  update(dt, input) {
    this.t += dt;
    const d = input.consumeDir ? input.consumeDir() : null;
    // Real grid arithmetic rather than the bit flips this used to do. `sel ^= 1`
    // and `sel ^= 2` are only a grid while there are exactly four buttons; on
    // five they walk off the end onto a button that is not there.
    if (d) {
      const n = BUTTONS.length;
      let col = this.sel % COLS, row = Math.floor(this.sel / COLS);
      if (d === 'left') col = (col + COLS - 1) % COLS;
      else if (d === 'right') col = (col + 1) % COLS;
      else if (d === 'up') row = (row + ROWS - 1) % ROWS;
      else if (d === 'down') row = (row + 1) % ROWS;
      let next = row * COLS + col;
      // The last row can be short. Landing on a hole falls back to a real one.
      if (next >= n) next = (d === 'left' || d === 'right') ? row * COLS : n - 1;
      if (next !== this.sel) { this.sel = next; sfx.click(); }
    }
    if (input.consumeAPress()) this._fire();
    input.consumeBPress();
  }

  render(ctx) {
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, W, H);
    // Bitumen here, not the abbey's crimson field: this screen is looked at
    // while the console itself is still the object in the player's hands, and
    // its olive-lime buttons fight a full red panel. On near-black the title's
    // blood red survives as the one mark that matters. Inside the abbey the
    // crimson ground stays.
    const TH = THEMES.bitumen;
    drawPanel(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, TH);

    const inX = BOX_X + PANEL_TILE + 7;
    const inW = BOX_W - (PANEL_TILE + 7) * 2;
    let y = BOX_Y + PANEL_TILE + 14;

    // --- title ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = 'rgba(4,4,7,0.85)';
    ctx.fillText(TITLE, W / 2 + 1, y + 1);
    ctx.fillStyle = TH.title.l;
    ctx.fillText(TITLE, W / 2, y);
    ctx.fillStyle = TH.rule;
    ctx.fillRect(inX, y + 4, inW, 1);

    // --- the wallet line ---
    y += 15;
    ctx.font = '9px "Courier New", monospace';
    const on = !!this.wallet;
    // While a connection is in flight — or after one has failed — the wallet
    // line says so instead of flatly reporting "no wallet bound", which is true
    // but useless when the player has just pressed the button.
    if (this.status) {
      ctx.fillStyle = this.busy ? GOLD.b : BLOOD.l;
      ctx.fillText(this.status, W / 2, y);
    } else {
      ctx.fillStyle = on ? GOLD.b : 'rgba(178,172,158,0.55)';
      ctx.fillText(on ? `BOUND  ${this.wallet}` : 'NO WALLET BOUND', W / 2, y);
    }

    // --- the Cultist, turning ---
    // Held for over a second a side rather than spun: at four facings a fast
    // rotation is a flicker, and the point is to look at the character you own.
    const cy = y + 12 + CULT_H;
    const face = FACES[Math.floor(this.t / TURN) % FACES.length];
    const bob = Math.sin(this.t * 2.2) * 1.6;
    const cx = W / 2 - 16;

    ctx.save();                                   // a lit disc for it to stand on
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, cy - CULT_H * 0.4, 2, cx, cy - CULT_H * 0.4, 46);
    g.addColorStop(0, `rgba(${TH.glow},0.20)`);
    g.addColorStop(1, `rgba(${TH.glow},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - 48, cy - CULT_H - 10, 96, CULT_H + 40);
    ctx.restore();

    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 13, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    drawCharacter(ctx, {
      sheet: this.sheet, dir: face, moving: false, animPhase: this.t * 6,
      x: cx, groundY: cy - bob, targetHeight: CULT_H,
    });

    // --- the holding, beside it ---
    ctx.textAlign = 'left';
    ctx.font = 'bold 17px "Courier New", monospace';
    const cxt = `×${this.cultists}`;
    ctx.fillStyle = 'rgba(4,4,7,0.85)';
    ctx.fillText(cxt, cx + 25, cy - CULT_H * 0.42 + 1);
    ctx.fillStyle = this.cultists > 0 ? GOLD.h : 'rgba(178,172,158,0.45)';
    ctx.fillText(cxt, cx + 24, cy - CULT_H * 0.42);

    // --- the buttons ---
    for (let i = 0; i < BUTTONS.length; i++) this._button(ctx, i);
  }

  // A button is the same beveled block as everything else in the abbey, in the
  // panel's own frame ramp when idle and GOLD when it is the one A will press. The selected one also
  // carries the gold mark the world uses for "something can be done here", so
  // the menu teaches that symbol before the player ever meets it on a floor.
  _button(ctx, i) {
    const r = this._btnRect(i);
    const b = BUTTONS[i];
    const on = this.sel === i;
    const dim = b.id === 'wallet' && !!this.wallet;

    ctx.fillStyle = 'rgba(3,3,5,0.55)';
    ctx.fillRect(r.x + 1, r.y + 2, r.w, r.h);
    block(ctx, r.x, r.y, r.w, r.h, THEMES.bitumen.frame);
    if (on) {
      const pulse = 0.55 + Math.sin(this.t * 4) * 0.2;
      ctx.strokeStyle = `rgba(242,210,100,${pulse})`;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
      ctx.fillStyle = 'rgba(217,168,50,0.16)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = 'rgba(3,3,5,0.85)';
    ctx.fillText(b.label, r.x + r.w / 2 + 1, r.y + r.h / 2 + 4.5);
    ctx.fillStyle = dim ? 'rgba(178,172,158,0.45)' : on ? GOLD.h : BONE.b;
    ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 3.5);

    // a bound wallet gets a tick rather than a dead button
    if (dim) {
      ctx.strokeStyle = GOLD.b;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(r.x + 5, r.y + r.h / 2);
      ctx.lineTo(r.x + 7.5, r.y + r.h / 2 + 3);
      ctx.lineTo(r.x + 12, r.y + r.h / 2 - 3.5);
      ctx.stroke();
    }
  }
}
