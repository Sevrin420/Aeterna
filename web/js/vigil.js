// The vigil — what happens the moment the day's first fire catches.
//
// Lighting the brazier used to be the whole of the duty: torch touches wood,
// a toast appears, ten Devotion. The act with the most physical build-up in
// the abbey — walk for the wood, lay it, walk for the torch, bring it back —
// paid out with less ceremony than reading a signpost.
//
// So the fire is now a rite. The scene is taken over, the room goes dark
// around the one thing burning in it, and the cultist kneels and says the
// mantra three times through while the flame answers each line. It is not a
// warm scene. The fire climbs with every phrase, the light it throws goes from
// hearth-orange to something closer to arterial, and by the last line the
// shadow it casts up the wall is much larger than the person casting it.
//
// Same shape as the scourge and the shrine: this module owns the pose, the
// camera framing and the timing, and the scene hands over input while it runs.

import { FIRE, BLOOD, GOLD, VOID, SHADOW } from './palette.js';

// The mantra, three times through. Slow on purpose — the shrine's chant is
// spaced the same way, and the two rites should feel like the same liturgy
// said at different altars.
const PAIR = ['Sanguis aeternus', 'Vita aeterna'];
export const VIGIL_LINES = [...PAIR, ...PAIR, ...PAIR];
const LINE_GAP = 2.8;

const KNEEL = 1.6;                      // going down
const CHANT = VIGIL_LINES.length * LINE_GAP;
const SEAL = 2.2;                       // the flame takes it
const RISE = 1.4;

// Where the worshipper ends up kneeling, measured from the bowl. Without this
// the rite framed itself wherever the player happened to be standing when the
// torch touched the wood — which is inside the brazier's reach, so at full roar
// the flame was drawn straight over the top of them and the shot had nobody in
// it. They now walk to a mark, on the side they came from.
const MARK = 17;

const BARS = 24;                        // letterbox, as the scourge does it
const DIM = 0.72;                       // how far the rest of the room goes down

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);

export class FireVigil {
  constructor({ onChant = () => {}, onLine = () => {}, onDone = () => {} } = {}) {
    this.onChant = onChant;
    this.onLine = onLine;              // fired per phrase, for the sound
    this.onDone = onDone;
    this._reset();
  }

  _reset() {
    this.active = false;
    this.phase = 'kneel';
    this.pt = 0;
    this.t = 0;
    this.line = -1;
    this.kneel = 0;                    // 0 standing, 1 down
    this.flare = 0;                    // per-line kick, decaying
    this.roar = 0;                     // 0..1, how big the fire has grown
    this.bars = 0;
    this.dim = 0;
    this.blood = 0;                    // how far the light has gone red
    this.embers = [];
    this.bx = 0; this.by = 0;          // the brazier
    this.px = 0; this.py = 0;          // the cultist
  }

  // (bx, by) the brazier's bowl in world pixels; (px, py) where the cultist is
  // standing when the fire catches.
  begin(bx, by, px, py) {
    if (this.active) return false;
    this._reset();
    this.active = true;
    this.bx = bx; this.by = by;
    this.fromX = px; this.fromY = py;
    const dx = px - bx, dy = py - by;
    const d = Math.max(1, Math.hypot(dx, dy));
    this.markX = bx + (dx / d) * MARK;
    this.markY = by + (dy / d) * MARK + 3;
    this.px = px; this.py = py;
    return true;
  }

  // The camera sits between the fire and the worshipper rather than on either,
  // so both are in frame for the whole rite without the view ever cutting.
  get focusX() { return (this.bx + this.px) / 2; }
  get focusY() { return (this.by + this.py) / 2 - 4; }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.pt += dt;
    this.flare = Math.max(0, this.flare - dt * 2.6);

    const want = this.phase === 'kneel' || this.phase === 'rise' ? 0 : 1;
    this.bars += (want * BARS - this.bars) * Math.min(1, dt * 5);
    this.dim += (want * DIM - this.dim) * Math.min(1, dt * 4);

    switch (this.phase) {
      case 'kneel': {
        const u = easeOut(clamp01(this.pt / KNEEL));
        this.kneel = u;
        this.px = this.fromX + (this.markX - this.fromX) * u;
        this.py = this.fromY + (this.markY - this.fromY) * u;
        if (this.pt >= KNEEL) { this.phase = 'chant'; this.pt = 0; }
        break;
      }

      case 'chant': {
        const want2 = Math.min(VIGIL_LINES.length - 1, Math.floor(this.pt / LINE_GAP));
        if (want2 > this.line) {
          this.line = want2;
          this.flare = 1;
          // The fire answers every phrase and never goes back down.
          this.roar = (want2 + 1) / VIGIL_LINES.length;
          this._spit(10 + want2 * 4);
          this.onChant(VIGIL_LINES[want2], LINE_GAP);
          this.onLine(want2);
        }
        // The colour of the light curdles across the chant. This is the whole
        // argument that the rite is unholy: nothing is said about it, the
        // flame simply stops being the colour a fire is.
        this.blood = clamp01((this.line + 1) / VIGIL_LINES.length) * 0.85;
        if (this.pt >= CHANT) { this.phase = 'seal'; this.pt = 0; this.flare = 1; this._spit(34); }
        break;
      }

      case 'seal':
        this.roar = 1 + Math.sin(this.pt * 9) * 0.06;
        if (this.pt >= SEAL) { this.phase = 'rise'; this.pt = 0; }
        break;

      case 'rise':
        this.kneel = 1 - easeOut(clamp01(this.pt / RISE));
        this.roar = Math.max(0, 1 - this.pt / RISE);
        this.blood = Math.max(0, this.blood - dt * 0.9);
        if (this.pt >= RISE) {
          this.active = false;
          this.onDone();
        }
        break;
    }

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.t += dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 26 * dt;                 // they slow, stall, and fall back
      if (e.t >= e.life) this.embers.splice(i, 1);
    }
  }

  _spit(n) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const sp = 22 + Math.random() * 46;
      this.embers.push({
        x: this.bx + (Math.random() - 0.5) * 6,
        y: this.by - 2,
        vx: Math.cos(a) * sp * 0.5,
        vy: Math.sin(a) * sp,
        t: 0, life: 0.7 + Math.random() * 1.1,
        r: 0.5 + Math.random() * 1.0,
      });
    }
  }

  // The colour the light has curdled to, for the halo and the floor wash.
  _hot(a) {
    const r = 255;
    const g = Math.round(170 - this.blood * 110);
    const b = Math.round(70 - this.blood * 52);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Everything under the props: the wash on the floor and the worshipper's
  // shadow thrown away from the fire. Drawn before the room's own props so the
  // light reads as lying on the flagstones rather than painted over them.
  drawGlow(ctx) {
    if (!this.active && this.roar <= 0.01) return;
    const R = 34 + this.roar * 58 + this.flare * 14;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.bx, this.by, 2, this.bx, this.by, R);
    g.addColorStop(0, this._hot(0.42 + this.flare * 0.20));
    g.addColorStop(0.5, this._hot(0.16));
    g.addColorStop(1, this._hot(0));
    ctx.fillStyle = g;
    ctx.fillRect(this.bx - R, this.by - R, R * 2, R * 2);
    ctx.restore();

    // The shadow. It is cast directly away from the flame and it grows with
    // the fire — by the last phrase it is several times the person.
    const dx = this.px - this.bx, dy = this.py - this.by;
    const d = Math.max(1, Math.hypot(dx, dy));
    const len = 12 + this.roar * 40;
    ctx.save();
    ctx.globalAlpha = 0.30 + this.roar * 0.34;
    ctx.fillStyle = VOID;
    ctx.beginPath();
    ctx.ellipse(this.px + (dx / d) * len * 0.5, this.py + (dy / d) * len * 0.5,
      3.5 + this.roar * 3, len * 0.5, Math.atan2(dy, dx) - Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The flame itself, the embers, and the letterbox. Drawn after the props so
  // the fire is in front of the brazier it is burning in.
  drawFire(ctx) {
    if (!this.active && this.roar <= 0.01) return;
    const s = 0.85 + this.roar * 1.05 + this.flare * 0.22;
    const f = 0.86 + Math.sin(this.t * 13) * 0.14;
    const x = this.bx, y = this.by - 3 - this.roar * 5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, 1, x, y, 30 * s);
    halo.addColorStop(0, this._hot(0.5));
    halo.addColorStop(0.45, this._hot(0.18));
    halo.addColorStop(1, this._hot(0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - 34 * s, y - 40 * s, 68 * s, 68 * s);
    ctx.restore();

    // Four nested tongues. The deep one is pushed toward BLOOD as the rite
    // goes on; the core stays white, because a flame with no white centre
    // reads as a painted shape rather than as something burning.
    const deep = this.blood > 0.35 ? BLOOD.d : FIRE.deep;
    const mid = this.blood > 0.6 ? BLOOD.b : FIRE.mid;
    ctx.fillStyle = deep;
    ctx.beginPath(); ctx.ellipse(x, y, 4.6 * s * f, 10 * s * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mid;
    ctx.beginPath(); ctx.ellipse(x, y + 1, 3.4 * s * f, 7.6 * s * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = FIRE.hot;
    ctx.beginPath(); ctx.ellipse(x, y + 2, 2.1 * s * f, 4.6 * s * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = FIRE.core;
    ctx.beginPath(); ctx.ellipse(x, y + 3, 1.1 * s * f, 2.4 * s * f, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const a = 1 - e.t / e.life;
      ctx.fillStyle = this._hot(a * 0.85);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Screen-space: the dark closing on the room, and the bars.
  //
  // The dark is RADIAL and centred on the flame, not a flat fill. A flat one
  // takes the worshipper down with the room — they are standing a tile from the
  // fire, so they went as black as the far wall and the rite played out with
  // nobody visibly in it. Centred on the fire, the only thing still lit is the
  // fire and whoever is kneeling in front of it, which is the shot.
  drawFrame(ctx, w, h, camX = 0, camY = 0) {
    if (this.dim > 0.01) {
      const fx = this.bx - camX, fy = this.by - camY;
      const clear = 26 + this.roar * 20;
      const g = ctx.createRadialGradient(fx, fy, clear, fx, fy, clear + 76);
      g.addColorStop(0, 'rgba(4,2,10,0)');
      g.addColorStop(0.45, `rgba(4,2,10,${this.dim * 0.55})`);
      g.addColorStop(1, `rgba(4,2,10,${this.dim})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.bars > 0.4) {
      ctx.fillStyle = VOID;
      ctx.fillRect(0, 0, w, this.bars);
      ctx.fillRect(0, h - this.bars, w, this.bars);
      ctx.fillStyle = `rgba(198,43,48,${0.25 + this.blood * 0.4})`;
      ctx.fillRect(0, this.bars - 0.6, w, 0.6);
      ctx.fillRect(0, h - this.bars, w, 0.6);
    }
  }
}
