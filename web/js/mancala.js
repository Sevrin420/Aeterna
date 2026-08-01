// The mancala table, drawn rather than marked up.
//
// It used to be fourteen HTML <button>s with a number in each — correct, and
// completely mute. You could not tell a board with eleven stones in a pit from
// one with three without reading, and a move happened as a set of numbers
// changing at once, so there was nothing to watch and nothing to understand.
//
// This is the same fourteen pits as a carved board on a canvas, filling the
// screen, with forty-eight individual stones in it. A move is SOWN: the stones
// come out of the pit you chose, and one is dropped into each pit around the
// board in turn, the same way a hand would do it. A capture is its own beat
// after the sowing stops.
//
// Everything obeys the abbey's five rules. The board is one WOOD ramp lit from
// the upper left with its outline in its own dark brown; the pits are recesses
// with the light on their far rim and the shadow on the near one, because that
// is what a hollow does; the slab drops a hard contact shadow. The stones are
// the one place colour is allowed to be loud, and they are the only thing on
// screen that is.

import { WOOD, GOLD, BLOOD, SOUL, MOSS, BONE, IRON, VOID, SHADOW } from './palette.js';

// Logical board, scaled to whatever the canvas turns out to be. Everything
// below is in these units and nothing anywhere else has to know the pixel size.
const BW = 232, BH = 104;
const PIT_R = 12.5;
const STORE_RX = 12.5, STORE_RY = 34;
const ROW_Y = [30, 74];             // top row, bottom row
const PIT_X0 = 62, PIT_DX = 21.6;   // six pits across the middle
const STORE_X = [212, 20];          // [seat 0's store (right), seat 1's (left)]

const HOP_MS = 190;                 // one stone dropped into one pit
const CAPTURE_MS = 620;
const SETTLE_MS = 260;              // beat after the last stone lands

// The stones. Five colours, and which one a stone gets is a pure function of
// where it is sitting, so the board is stable frame to frame with no per-stone
// bookkeeping. A stone in flight is drawn in the colour of the slot it is
// heading INTO, so it never changes colour on landing.
const STONE = [BLOOD, GOLD, SOUL, MOSS, BONE];
function stoneRamp(pit, i) { return STONE[(pit * 7 + i * 3) % STONE.length]; }

// Deterministic scatter inside a pit: a phyllotaxis spiral, which packs evenly
// and never leaves the middle bare the way random jitter does.
function stoneOffset(i, r) {
  const a = i * 2.399963;                       // golden angle
  const d = Math.sqrt(i / 13) * (r - 2.6);
  return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.86 };
}

const OWN_PITS = [[0, 1, 2, 3, 4, 5], [7, 8, 9, 10, 11, 12]];
const OWN_STORE = [6, 13];
const OPP_STORE = [13, 6];

// Replays a move against the previous board to find out exactly what happened,
// because the server sends only the resulting board. Every legal pit is tried
// in turn and simulated with the server's own rules (server/src/index.js,
// mancalaApplyMove); the one whose result matches is the move that was played,
// and its simulation is the animation. If nothing matches — a forfeit, a
// rejoin, a board arriving out of order — the caller falls back to snapping,
// which is what the old table did for every move.
export function deriveSow(prev, next) {
  for (let seat = 0; seat < 2; seat++) {
    for (const p of OWN_PITS[seat]) {
      if (!prev[p]) continue;
      const sim = prev.slice();
      const hops = [];
      let seeds = sim[p];
      sim[p] = 0;
      let idx = p;
      while (seeds > 0) {
        idx = (idx + 1) % 14;
        if (idx === OPP_STORE[seat]) continue;
        sim[idx] += 1;
        seeds -= 1;
        hops.push({ from: p, to: idx });
      }
      let capture = null;
      const landedInOwnStore = idx === OWN_STORE[seat];
      if (!landedInOwnStore && OWN_PITS[seat].includes(idx) && sim[idx] === 1) {
        const opp = 12 - idx;
        if (sim[opp] > 0) {
          capture = { pits: [idx, opp], to: OWN_STORE[seat], n: sim[opp] + 1 };
          sim[OWN_STORE[seat]] += sim[opp] + 1;
          sim[idx] = 0;
          sim[opp] = 0;
        }
      }
      if (sim.every((v, i) => v === next[i])) return { played: p, hops, capture };
    }
  }
  return null;
}

export class MancalaBoard {
  constructor(canvas, { onPit = () => {} } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPit = onPit;
    this.state = null;
    this.shown = null;        // the board the player is looking at right now
    this.anim = null;         // { board, queue, i, t, phase, inHand, played }
    this.t = 0;
    this.hoverPit = -1;
    this.raf = 0;
    this._last = 0;

    this._onClick = (e) => this._hit(e, true);
    this._onMove = (e) => this._hit(e, false);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerleave', () => { this.hoverPit = -1; });
  }

  destroy() {
    this.stop();
    this.cv.removeEventListener('click', this._onClick);
    this.cv.removeEventListener('pointermove', this._onMove);
  }

  start() {
    if (this.raf) return;
    this._last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.update(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // True while stones are still in the air. main.js holds the status line and
  // the pit locks until this clears, so the text never announces the result of
  // a move the player has not been shown yet.
  get busy() { return !!this.anim; }

  setState(state) {
    const prev = this.shown;
    this.state = state;
    if (!state || !state.board) { this.shown = null; this.anim = null; return; }
    // Animate only an ordinary move between two known boards. A first sight of
    // the table, a rejoin or a forfeit snaps.
    if (prev && !state.waiting && prev.length === 14) {
      const changed = state.board.some((v, i) => v !== prev[i]);
      if (!changed) return;
      const sow = deriveSow(prev, state.board);
      if (sow) {
        this.anim = {
          board: prev.slice(),
          queue: sow.hops,
          capture: sow.capture,
          i: 0,
          t: 0,
          phase: 'sow',
          played: sow.played,
          inHand: sow.hops.length,
        };
        this.anim.board[sow.played] = 0;
        this.shown = state.board.slice();
        return;
      }
    }
    this.shown = state.board.slice();
    this.anim = null;
  }

  update(dt) {
    this.t += dt;
    const a = this.anim;
    if (!a) return;
    a.t += dt * 1000;

    if (a.phase === 'sow') {
      while (a.t >= HOP_MS && a.i < a.queue.length) {
        a.t -= HOP_MS;
        a.board[a.queue[a.i].to] += 1;
        a.i += 1;
        a.inHand -= 1;
      }
      if (a.i >= a.queue.length) {
        a.phase = a.capture ? 'capture' : 'settle';
        a.t = 0;
      }
    } else if (a.phase === 'capture') {
      if (a.t >= CAPTURE_MS) {
        a.board[a.capture.to] += a.capture.n;
        a.board[a.capture.pits[0]] = 0;
        a.board[a.capture.pits[1]] = 0;
        a.phase = 'settle';
        a.t = 0;
      }
    } else if (a.t >= SETTLE_MS) {
      this.anim = null;
    }
  }

  // --- geometry ------------------------------------------------------------

  // Pixels per logical unit, and the offset that centres the board. Recomputed
  // every frame because the console can be resized at any time.
  _fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.cv.clientHeight * dpr));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    // A mancala board is more than twice as wide as it is tall. Laid out
    // horizontally on a portrait screen it becomes a thin strip across the
    // middle with the game too small to read and most of the screen wasted, so
    // on anything taller than it is wide the whole board is stood on its end:
    // two columns of six, stores at top and bottom. A real board would be
    // turned the same way for the same reason.
    const vertical = h > w;
    if (vertical) {
      const s = Math.min(w / (BH + 5), h / (BW + 5));
      return { s, vertical, ox: (w - BH * s) / 2, oy: (h - BW * s) / 2, w, h };
    }
    const s = Math.min(w / (BW + 5), h / (BH + 5));
    return { s, vertical, ox: (w - BW * s) / 2, oy: (h - BH * s) / 2, w, h };
  }

  // Where a pit sits, in logical units. Seat 1 sees the board turned round, so
  // whoever is playing always has their own six pits along the bottom — the
  // one thing a physical board gives you for free and a shared layout does not.
  _pos(i) {
    let x;
    let y;
    if (i === 6) { x = STORE_X[0]; y = BH / 2; } else if (i === 13) { x = STORE_X[1]; y = BH / 2; } else if (i <= 5) { x = PIT_X0 + i * PIT_DX; y = ROW_Y[1]; } else { x = PIT_X0 + (12 - i) * PIT_DX; y = ROW_Y[0]; }
    if (this.state && this.state.seat === 1) { x = BW - x; y = BH - y; }
    return { x, y };
  }

  _hit(e, click) {
    const fit = this._fit();
    const { s, ox, oy } = fit;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.cv.getBoundingClientRect();
    const cx = (e.clientX - r.left) * dpr, cy = (e.clientY - r.top) * dpr;
    const mx = fit.vertical ? (cy - oy) / s : (cx - ox) / s;
    const my = fit.vertical ? BH - (cx - ox) / s : (cy - oy) / s;
    let found = -1;
    for (let i = 0; i < 14; i++) {
      if (i === 6 || i === 13) continue;
      const p = this._pos(i);
      if (Math.hypot(mx - p.x, my - p.y) < PIT_R + 1.5) { found = i; break; }
    }
    if (click) {
      if (found >= 0 && this._playable(found)) this.onPit(found);
    } else {
      this.hoverPit = found >= 0 && this._playable(found) ? found : -1;
      this.cv.style.cursor = this.hoverPit >= 0 ? 'pointer' : 'default';
    }
  }

  _playable(i) {
    const st = this.state;
    if (!st || !st.board || st.waiting || this.anim) return false;
    if (st.type === 'end' || st.forfeited) return false;
    if (st.turn !== st.seat) return false;
    return OWN_PITS[st.seat].includes(i) && st.board[i] > 0;
  }

  // --- drawing -------------------------------------------------------------

  draw() {
    const fit = this._fit();
    const { s, ox, oy, w, h } = fit;
    this.vertical = fit.vertical;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Rotating the CONTEXT rather than the layout keeps every coordinate in
    // this file in board space: one matrix, and nothing below has to know
    // which way up the table is. Only the numerals opt out, in _label().
    this._table(ctx, w, h);
    if (fit.vertical) ctx.setTransform(0, s, -s, 0, ox + BH * s, oy);
    else ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'round';

    this._slab(ctx);
    const board = this.anim ? this.anim.board : (this.shown || new Array(14).fill(0));
    for (let i = 0; i < 14; i++) this._pit(ctx, i, board[i]);
    if (this.anim) this._flying(ctx);
  }

  // A board is two-and-a-bit times as wide as it is tall and no amount of
  // scaling changes that, so on almost any screen it letterboxes. Rather than
  // leave the remainder black, the remainder becomes the thing the board is
  // lying on: the abbey's own flagstones, lit by two candles just out of frame.
  // The screen is then full of table whatever shape it is, and the board is as
  // large as its proportions allow.
  _table(ctx, w, h) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = Math.max(w, h) / 26;                          // one flagstone
    ctx.fillStyle = '#241c2e';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y * g < h; y++) {
      for (let x = 0; x * g < w; x++) {
        // two-tile slabs with grout, offset every other course
        if ((x + (y % 2 ? 1 : 0)) % 2) continue;
        ctx.fillStyle = (x * 7 + y * 13) % 3 ? '#2c2338' : '#332942';
        ctx.fillRect(x * g + 0.5, y * g + 0.5, g * 2 - 1, g - 1);
      }
    }
    ctx.fillStyle = 'rgba(20,14,30,0.55)';                  // grout darkening
    for (let y = 0; y * g < h; y++) ctx.fillRect(0, y * g, w, 1);

    for (const [cx, cy] of [[w * 0.10, h * 0.14], [w * 0.90, h * 0.86]]) {
      const cand = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(w, h) * 0.55);
      cand.addColorStop(0, `rgba(255,180,80,${0.16 + Math.sin(this.t * 5 + cx) * 0.03})`);
      cand.addColorStop(1, 'rgba(255,180,80,0)');
      ctx.fillStyle = cand;
      ctx.fillRect(0, 0, w, h);
    }
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(4,2,10,0.82)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  _slab(ctx) {
    ctx.fillStyle = SHADOW;                                   // hard contact shadow
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(3, 5, BW - 4, BH - 2, 13); else ctx.rect(3, 5, BW - 4, BH - 2);
    ctx.fill();

    ctx.fillStyle = WOOD.o;                                   // outline in its own brown
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-1, -1, BW + 2, BH + 2, 14); else ctx.rect(-1, -1, BW + 2, BH + 2);
    ctx.fill();
    // Four flat bands down the slab, not a smooth ramp. A gradient is the one
    // thing that will not read as 16-bit however good the colours are: LttP
    // shades in steps, and the step edges are the shading.
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, BW, BH, 13); else ctx.rect(0, 0, BW, BH);
    ctx.clip();
    const bands = [[0, 0.14, WOOD.l], [0.14, 0.52, WOOD.b], [0.52, 0.86, WOOD.b], [0.86, 1, WOOD.d]];
    for (const [a, b2, col] of bands) {
      ctx.fillStyle = col;
      ctx.fillRect(0, BH * a, BW, BH * (b2 - a) + 0.5);
    }
    ctx.fillStyle = 'rgba(44,26,12,0.22)';                    // the seam between the halves
    ctx.fillRect(0, BH * 0.52 - 0.6, BW, 1.2);
    ctx.restore();

    ctx.fillStyle = WOOD.h;                                   // lit top edge
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 1.4, BW - 4, 2.2, 1.2); else ctx.rect(2, 1.4, BW - 4, 2.2);
    ctx.fill();
    ctx.fillStyle = WOOD.o;
    ctx.fillRect(2, BH - 3, BW - 4, 1.6);

    ctx.strokeStyle = 'rgba(44,26,12,0.30)';                  // grain
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 7; i++) {
      const y = 8 + i * 13.5;
      ctx.beginPath();
      ctx.moveTo(4, y);
      for (let x = 4; x < BW - 4; x += 12) ctx.lineTo(x, y + Math.sin((x + i * 40) * 0.06) * 1.1);
      ctx.stroke();
    }

    ctx.strokeStyle = GOLD.d;                                 // one gilt inlay line
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(5, 5, BW - 10, BH - 10, 10); else ctx.rect(5, 5, BW - 10, BH - 10);
    ctx.stroke();
  }

  _pit(ctx, i, n) {
    const store = i === 6 || i === 13;
    const p = this._pos(i);
    const rx = store ? STORE_RX : PIT_R;
    const ry = store ? STORE_RY : PIT_R;

    ctx.fillStyle = WOOD.o;                                   // the bored hole
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + 1.4, ry + 1.4, 0, 0, Math.PI * 2); ctx.fill();
    const hollow = ctx.createRadialGradient(p.x - rx * 0.3, p.y - ry * 0.3, 1, p.x, p.y, rx * 1.5);
    hollow.addColorStop(0, '#2a180a');
    hollow.addColorStop(1, VOID);
    ctx.fillStyle = hollow;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

    // A hollow catches the light on its FAR rim and shades the near one. Get
    // this backwards and the pit reads as a bump, which is the single easiest
    // way to lose a carved board.
    ctx.strokeStyle = WOOD.h;
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx - 0.3, ry - 0.3, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.strokeStyle = WOOD.d;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx - 0.3, ry - 0.3, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();

    if (this.hoverPit === i) {
      ctx.strokeStyle = GOLD.l;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + 2, ry + 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (this._playable(i)) {
      ctx.strokeStyle = `rgba(217,168,50,${0.30 + Math.sin(this.t * 3) * 0.16})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + 2, ry + 2, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // A pit being emptied by a capture has its stones drawn in flight by
    // _flying(); leaving them here too would draw every one of them twice.
    const looting = this.anim && this.anim.phase === 'capture' && this.anim.capture.pits.includes(i);
    const flash = false;
    const cap = store ? 26 : 13;
    for (let k = 0; looting ? false : k < Math.min(n, cap); k++) {
      const o = store ? stoneOffset(k, Math.min(rx, ry / 2.1) * 1.9) : stoneOffset(k, rx);
      const sy = store ? o.y * 2.4 : o.y;
      this._stone(ctx, p.x + o.x, p.y + sy, stoneRamp(i, k), flash);
    }
    if (n > cap) this._label(ctx, p.x, p.y + ry - 5, `+${n - cap}`, GOLD.h);

    // The count, on the wood below each pit and beside each store — a physical
    // board makes you count, and a wager should not.
    this._label(ctx, p.x, store ? p.y + ry + 6 : p.y + ry + 6.5, String(n), store ? GOLD.h : WOOD.h);
  }

  // A numeral, drawn upright even when the whole context is on its side.
  _label(ctx, x, y, txt, fill) {
    ctx.save();
    ctx.translate(x, y);
    if (this.vertical) ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(20,10,4,0.9)';
    ctx.fillText(txt, 0.4, 0.4);
    ctx.fillStyle = fill;
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  _stone(ctx, x, y, R, flash) {
    ctx.fillStyle = R.o;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? R.h : R.b;
    ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = R.l;                                      // lit from upper left
    ctx.beginPath(); ctx.arc(x - 0.5, y - 0.6, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = R.h;
    ctx.beginPath(); ctx.arc(x - 0.8, y - 0.9, 0.6, 0, Math.PI * 2); ctx.fill();
  }

  // The stone currently in the air, and the ones still in the hand. A sowing
  // that teleports each stone is just numbers changing again — the arc between
  // two pits is the entire reason this file exists.
  _flying(ctx) {
    const a = this.anim;
    if (a.phase === 'sow' && a.i < a.queue.length) {
      const hop = a.queue[a.i];
      const from = this._pos(a.i === 0 ? hop.from : a.queue[a.i - 1].to);
      const to = this._pos(hop.to);
      const u = Math.min(1, a.t / HOP_MS);
      const x = from.x + (to.x - from.x) * u;
      const y = from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 13;
      const R = stoneRamp(hop.to, a.board[hop.to]);
      ctx.fillStyle = 'rgba(20,10,4,0.35)';                   // its shadow on the board
      ctx.beginPath(); ctx.ellipse(x, to.y + (from.y - to.y) * (1 - u), 3, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      this._stone(ctx, x, y, R, false);

      // what is still in the hand, riding above the pit it came from
      const src = this._pos(a.played);
      for (let k = 0; k < Math.min(a.inHand - 1, 6); k++) {
        const o = stoneOffset(k, 6);
        this._stone(ctx, src.x + o.x, src.y + o.y - 15, stoneRamp(a.played, k), false);
      }
    } else if (a.phase === 'capture') {
      const u = Math.min(1, a.t / CAPTURE_MS);
      const to = this._pos(a.capture.to);
      for (const pit of a.capture.pits) {
        const from = this._pos(pit);
        const n = Math.min(a.board[pit], 8);
        for (let k = 0; k < n; k++) {
          const uu = Math.max(0, Math.min(1, (u - k * 0.05) / 0.6));
          if (uu <= 0) continue;
          const o = stoneOffset(k, PIT_R);
          const sx = from.x + o.x, sy = from.y + o.y;
          this._stone(ctx, sx + (to.x - sx) * uu, sy + (to.y - sy) * uu - Math.sin(uu * Math.PI) * 16,
            stoneRamp(pit, k), true);
        }
      }
    }
  }
}
