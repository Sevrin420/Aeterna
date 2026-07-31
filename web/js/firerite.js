// The fire shrine, as a thing you do rather than a button you press.
//
// Lighting a brazier used to be two taps of A in the same spot, with the game
// telling you in words what the second tap should be. Now it is physical: the
// fuel is a stack of wood out in the aisle, the flame comes from a torch in a
// bracket on the wall, and both have to be carried to the niche. Nothing
// explains the order — a pile of wood, an empty iron bowl and a burning torch
// are enough for anyone to work out, and working it out is the point.
//
// Everything here is client-side and per-session on purpose. The wood is not
// an inventory item and the brazier is not a saved flag; only the completed
// rite reaches the server, through the existing daily-duty call. That keeps a
// prop-carrying puzzle from turning into a thing that has to be reconciled
// across reloads or between players.

import { WOOD, IRON, GOLD, FIRE, flame } from './palette.js';

export const WOOD_RESPAWN = 120;   // seconds before a taken stack is replaced
export const BURN_TIME = 60;       // seconds a lit brazier stays lit
const PICKUP_R = 16;               // reach for wood and for a wall torch
const BRAZIER_R = 18;              // reach for the bowl itself

export class FireRite {
  // `px` converts tile coords to pixels; passed in so this module never has to
  // know the map's tile size.
  constructor(alcoves, px) {
    this.alcoves = alcoves;
    this.px = px;
    // Per alcove: when the wood was taken (null = the stack is there), whether
    // wood is laid in the bowl, when the torch was taken, and when the fire
    // was lit.
    this.state = alcoves.map(() => ({ woodTakenAt: null, laid: false, torchOut: false, litAt: null }));
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    for (const st of this.state) {
      if (st.woodTakenAt != null && this.t - st.woodTakenAt >= WOOD_RESPAWN) st.woodTakenAt = null;
      if (st.litAt != null && this.t - st.litAt >= BURN_TIME) {
        // burns out completely: the bowl is empty again and needs fresh wood
        st.litAt = null;
        st.laid = false;
      }
    }
  }

  isLit(i) { return this.state[i].litAt != null; }
  hasWood(i) { return this.state[i].woodTakenAt == null; }
  isLaid(i) { return this.state[i].laid; }
  hasTorch(i) { return !this.state[i].torchOut; }

  // Seconds of flame left, for the burn-down on the brazier's glow.
  burnLeft(i) {
    const st = this.state[i];
    return st.litAt == null ? 0 : Math.max(0, BURN_TIME - (this.t - st.litAt));
  }

  _near(x, y, col, row, r) {
    return Math.hypot(x - this.px(col), y - this.px(row)) < r;
  }

  // Index of the alcove whose wood stack is in reach and still there.
  woodAt(x, y) {
    for (let i = 0; i < this.alcoves.length; i++) {
      const w = this.alcoves[i].wood;
      if (this.hasWood(i) && this._near(x, y, w.col, w.row, PICKUP_R)) return i;
    }
    return -1;
  }

  torchAt(x, y) {
    for (let i = 0; i < this.alcoves.length; i++) {
      const tc = this.alcoves[i].torch;
      if (this.hasTorch(i) && this._near(x, y, tc.col, tc.row, PICKUP_R)) return i;
    }
    return -1;
  }

  brazierAt(x, y) {
    for (let i = 0; i < this.alcoves.length; i++) {
      const b = this.alcoves[i].brazier;
      if (this._near(x, y, b.col, b.row, BRAZIER_R)) return i;
    }
    return -1;
  }

  takeWood(i) { this.state[i].woodTakenAt = this.t; }
  takeTorch(i) { this.state[i].torchOut = true; }
  // A carried torch always goes back to its own bracket, whether it lit
  // anything or was simply put down — a bracket left empty forever would
  // quietly break that alcove.
  returnTorch(i) { this.state[i].torchOut = false; }

  lay(i) { this.state[i].laid = true; }
  light(i) { this.state[i].litAt = this.t; }

  // --- drawing ------------------------------------------------------------
  // Both objects are built to the palette's rules: five-step ramps, lit from
  // the upper left, outlined in a dark version of their own hue.

  drawWood(ctx, x, y) {
    ctx.fillStyle = 'rgba(30,16,56,0.48)';
    ctx.beginPath(); ctx.ellipse(x, y + 4, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const ly = y - 3 + i * 2.6;
      ctx.fillStyle = WOOD.o; ctx.fillRect(x - 5.5, ly - 0.5, 11, 3.2);
      ctx.fillStyle = WOOD.b; ctx.fillRect(x - 5, ly, 10, 2.2);
      ctx.fillStyle = WOOD.l; ctx.fillRect(x - 5, ly, 10, 0.8);   // lit top face
      ctx.fillStyle = WOOD.d;                                      // sawn ends
      ctx.fillRect(x - 5, ly, 1.4, 2.2);
      ctx.fillRect(x + 3.6, ly, 1.4, 2.2);
    }
  }

  // A torch in its wall bracket. `side` places the flame clear of the wall.
  drawWallTorch(ctx, x, y, t, seed) {
    ctx.fillStyle = IRON.o; ctx.fillRect(x - 2, y - 1, 4, 7);      // bracket
    ctx.fillStyle = IRON.b; ctx.fillRect(x - 1.5, y - 0.5, 3, 6);
    ctx.fillStyle = IRON.l; ctx.fillRect(x - 1.5, y - 0.5, 3, 1);
    ctx.fillStyle = WOOD.o; ctx.fillRect(x - 1.5, y - 8, 3, 8);     // haft
    ctx.fillStyle = WOOD.b; ctx.fillRect(x - 1, y - 8, 2, 8);
    ctx.fillStyle = WOOD.h; ctx.fillRect(x - 1, y - 8, 0.8, 6);
    flame(ctx, x, y - 10, 0.55, t, seed);
  }

  // What the player is holding, drawn over their hands.
  drawCarried(ctx, x, y, kind, t) {
    if (kind === 'wood') {
      ctx.fillStyle = WOOD.o; ctx.fillRect(x - 6, y - 1, 12, 4);
      ctx.fillStyle = WOOD.b; ctx.fillRect(x - 5.5, y - 0.5, 11, 3);
      ctx.fillStyle = WOOD.l; ctx.fillRect(x - 5.5, y - 0.5, 11, 1);
      ctx.fillStyle = WOOD.d; ctx.fillRect(x - 5.5, y - 0.5, 1.4, 3);
      ctx.fillStyle = WOOD.d; ctx.fillRect(x + 4.1, y - 0.5, 1.4, 3);
    } else if (kind === 'torch') {
      ctx.fillStyle = WOOD.o; ctx.fillRect(x + 3, y - 9, 3, 10);
      ctx.fillStyle = WOOD.b; ctx.fillRect(x + 3.5, y - 9, 2, 10);
      flame(ctx, x + 4.5, y - 11, 0.5, t, 7);
    }
  }

  // Unlit wood sitting in the bowl, so a laid brazier reads as ready.
  drawLaid(ctx, x, y) {
    ctx.fillStyle = WOOD.o; ctx.fillRect(x - 4, y - 4, 8, 2);
    ctx.fillStyle = WOOD.b; ctx.fillRect(x - 3.5, y - 3.5, 7, 1.4);
    ctx.fillStyle = WOOD.d; ctx.fillRect(x - 2.5, y - 5.2, 5, 1.5);
    ctx.fillStyle = WOOD.l; ctx.fillRect(x - 2.5, y - 5.2, 5, 0.6);
  }

  // The flame, guttering over its last few seconds so a player can see it is
  // about to go out rather than being surprised by it.
  drawFlame(ctx, x, y, i, t) {
    const left = this.burnLeft(i);
    const s = left < 8 ? 0.55 + (left / 8) * 0.5 : 1.05;
    flame(ctx, x, y, s, t, i * 7);
    if (left < 8) {
      ctx.fillStyle = FIRE.glow(0.10 + Math.sin(t * 14) * 0.06);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

export { GOLD };
