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
//   a 2x2 grid of buttons    Wallet Connect / Play / Mint / Docs

import { drawPanel, PANEL_TILE } from '../dialogue.js';
import { drawCharacter, getCultistSprite } from '../spritesheet.js';
import { BLOOD, GOLD, BONE, IRON, VOID, SHADOW, block } from '../palette.js';
import { sfx } from '../sfx.js';

const W = 208, H = 208;
const BOX_W = 192, BOX_H = 176;
const BOX_X = (W - BOX_W) / 2, BOX_Y = (H - BOX_H) / 2;

const FACES = ['down', 'left', 'up', 'right'];   // the order a body turns in
const TURN = 1.15;                               // seconds a facing is held
const CULT_H = 58;                               // how tall the display Cultist is

// The grid. Two columns, two rows, in reading order.
const BUTTONS = [
  { id: 'wallet', label: 'WALLET' },
  { id: 'play', label: 'PLAY' },
  { id: 'mint', label: 'MINT' },
  { id: 'docs', label: 'DOCS' },
];
const BTN_W = 80, BTN_H = 22, BTN_GAP_X = 6, BTN_GAP_Y = 6;

export class MenuScene {
  constructor({ wallet = null, cultists = 0, seed = 'menu', sex = 'male',
    onConnect = () => {}, onPlay = () => {}, onMint = () => {}, onDocs = () => {} } = {}) {
    this.wallet = wallet;
    this.cultists = cultists;
    this.sheet = getCultistSprite(seed, sex);
    this.on = { wallet: onConnect, play: onPlay, mint: onMint, docs: onDocs };
    this.t = 0;
    this.sel = wallet ? 1 : 0;                   // land on PLAY if already bound
    this.busy = false;
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
    const gw = BTN_W * 2 + BTN_GAP_X;
    const x0 = (W - gw) / 2;
    const y0 = BOX_Y + BOX_H - PANEL_TILE - 10 - (BTN_H * 2 + BTN_GAP_Y);
    return {
      x: x0 + (i % 2) * (BTN_W + BTN_GAP_X),
      y: y0 + Math.floor(i / 2) * (BTN_H + BTN_GAP_Y),
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
    const b = BUTTONS[this.sel];
    sfx.bootConfirm();
    this.on[b.id]();
  }

  update(dt, input) {
    this.t += dt;
    const d = input.consumeDir ? input.consumeDir() : null;
    if (d === 'left' || d === 'right') { this.sel ^= 1; sfx.click(); }
    else if (d === 'up' || d === 'down') { this.sel ^= 2; sfx.click(); }
    if (input.consumeAPress()) this._fire();
    input.consumeBPress();
  }

  render(ctx) {
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, W, H);
    drawPanel(ctx, BOX_X, BOX_Y, BOX_W, BOX_H);

    const inX = BOX_X + PANEL_TILE + 7;
    const inW = BOX_W - (PANEL_TILE + 7) * 2;
    let y = BOX_Y + PANEL_TILE + 14;

    // --- title ---
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = 'rgba(20,6,10,0.8)';
    ctx.fillText('VITA AETERNA', W / 2 + 1, y + 1);
    ctx.fillStyle = BLOOD.l;
    ctx.fillText('VITA AETERNA', W / 2, y);
    ctx.fillStyle = 'rgba(232,90,74,0.30)';
    ctx.fillRect(inX, y + 4, inW, 1);

    // --- the wallet line ---
    y += 15;
    ctx.font = '9px "Courier New", monospace';
    const on = !!this.wallet;
    ctx.fillStyle = on ? GOLD.b : 'rgba(190,150,150,0.55)';
    ctx.fillText(on ? `BOUND  ${this.wallet}` : 'NO WALLET BOUND', W / 2, y);

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
    g.addColorStop(0, 'rgba(198,43,48,0.20)');
    g.addColorStop(1, 'rgba(198,43,48,0)');
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
    ctx.fillStyle = 'rgba(20,6,10,0.85)';
    ctx.fillText(cxt, cx + 25, cy - CULT_H * 0.42 + 1);
    ctx.fillStyle = this.cultists > 0 ? GOLD.h : 'rgba(190,170,150,0.45)';
    ctx.fillText(cxt, cx + 24, cy - CULT_H * 0.42);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = 'rgba(200,175,140,0.6)';
    ctx.fillText(this.cultists === 1 ? 'CULTIST' : 'CULTISTS', cx + 24, cy - CULT_H * 0.42 + 10);

    // --- the buttons ---
    for (let i = 0; i < BUTTONS.length; i++) this._button(ctx, i);
  }

  // A button is the same beveled block as everything else in the abbey, in IRON
  // when idle and GOLD when it is the one A will press. The selected one also
  // carries the gold mark the world uses for "something can be done here", so
  // the menu teaches that symbol before the player ever meets it on a floor.
  _button(ctx, i) {
    const r = this._btnRect(i);
    const b = BUTTONS[i];
    const on = this.sel === i;
    const dim = b.id === 'wallet' && !!this.wallet;

    ctx.fillStyle = 'rgba(10,4,8,0.5)';
    ctx.fillRect(r.x + 1, r.y + 2, r.w, r.h);
    block(ctx, r.x, r.y, r.w, r.h, IRON);
    if (on) {
      const pulse = 0.55 + Math.sin(this.t * 4) * 0.2;
      ctx.strokeStyle = `rgba(242,210,100,${pulse})`;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
      ctx.fillStyle = 'rgba(217,168,50,0.16)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = 'rgba(8,4,10,0.85)';
    ctx.fillText(b.label, r.x + r.w / 2 + 1, r.y + r.h / 2 + 5);
    ctx.fillStyle = dim ? 'rgba(190,175,145,0.45)' : on ? GOLD.h : BONE.b;
    ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 4);

    // a bound wallet gets a tick rather than a dead button
    if (dim) {
      ctx.strokeStyle = GOLD.b;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(r.x + 7, r.y + r.h / 2);
      ctx.lineTo(r.x + 10, r.y + r.h / 2 + 3.5);
      ctx.lineTo(r.x + 15, r.y + r.h / 2 - 4);
      ctx.stroke();
    }
  }
}
