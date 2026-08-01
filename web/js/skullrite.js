// The shrine — a great skull lying on the floor of the east chamber, and the
// rite that lifts it.
//
// Two things live here because they are inseparable: the skull is not a prop
// that a rite happens next to, it is the thing the rite acts on. It sleeps on
// the flagstones with no fire on it at all. A drop of the worshipper's blood
// wakes it, blue fire kindles around it, and it climbs a step into the air
// with every line of the chant. At the top its sockets fill with fire, and
// then it goes back down to the floor to reset.
//
// The skull itself does not turn — the FIRE turns, faster the higher the skull
// gets, which is what sells the rise. The yaw machinery is still here and is
// still correct, because the drawing is built on a projection rather than on
// baked frames: every feature is placed in skull-space (u = left/right,
// v = up/down, w = front/back) and projected through one rotation about the
// vertical axis. It is simply held at zero now, facing whoever woke it.

import { BONE, BLOOD, VOID, SOUL, WALL, SHADOW, blueFlame, candleFlame, SOULFIRE } from './palette.js';

// How close you have to stand. This was 30, which sounds generous until you
// remember the skull's own 3x3 footprint is solid: the reachable ring was
// exactly one tile deep, so walking up to a very large skull and stopping a
// tile short showed no mark at all and read as "this does nothing". 44 gives
// two tiles of approach on every side and still cannot be triggered from
// across the chamber.
export const WORSHIP_R = 44;
const SKULL_S = 18;             // cranium half-width in pixels — deliberately large
const RISE = 34;                // how high it gets by the last line of the chant
// Even at rest the skull is drawn well above its tile centre. Centred on the
// tile it looked half-sunk into the flagstones, and the worshipper — who can
// only stand one tile south of it — appeared to be standing inside its jaw.
// This puts its chin on the floor where a skull's chin belongs.
const BASE_LIFT = 13;
const RING_N = 11;              // flames in the ring
const RING_R = 30;              // ring radius

// Beat lengths. The rite used to run in about sixteen seconds, which made a
// six-line chant feel like a list being read out. Every beat is now roughly
// half again as long and the gap between phrases has nearly trebled, so each
// line is typed out, held, and allowed to hang before the next one starts:
// about thirty seconds end to end.
const DISROBE = 4.0;
const OFFER = 2.6;              // the blood wells, falls, and lands
const LINE_GAP = 2.8;           // between phrases — the chant is the rite
const GLOW = 2.6;               // the sockets fill with fire
const DESCEND = 2.2;
const REROBE = 1.4;

// The kerb the skull lies inside: a ring of set stones with a pool of black
// ooze held in it, and candles burning on three of them. The kerb sits OUTSIDE
// the worshipper's circuit, so the dance happens ankle-deep in the pool rather
// than around the outside of it.
const KERB_N = 14;              // stones in the ring
const KERB_R = 41;              // how far out they are set
const POOL_R = 36;              // the ooze reaches almost to them
const KERB_SQUASH = 0.60;       // the abbey is drawn from slightly above
const CANDLE_ON = [1, 6, 10];   // which stones carry a candle

// How the worshipper moves while chanting: one full circuit of the skull over
// the chant, ending where they began, with two hops per phrase. The orbit is
// squashed vertically for the same reason the kerb is — a true circle reads as
// the player sliding rather than walking round.
const DANCE_R = 30;
const DANCE_SQUASH = 0.66;
const HOPS_PER_LINE = 2;
const HOP_H = 3.2;

// Two phrases, alternating, three times each: six lines and six steps of
// altitude, now spread across LINE_GAP seconds apiece.
const CHANT_LINES = ['Sanguis aeternus', 'Vita aeterna', 'Sanguis aeternus',
  'Vita aeterna', 'Sanguis aeternus', 'Vita aeterna'];
const CHANT = CHANT_LINES.length * LINE_GAP;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

// One point of the skull, rotated about the vertical axis and flattened.
// Returns the screen offset in skull radii plus the depth: z > 0 faces us.
function proj(u, w, c, s) {
  return { x: u * c + w * s, z: -u * s + w * c };
}

export class SkullShrine {
  constructor({ x, y, onChant = () => {}, onEvent = () => {}, onDone = () => {} }) {
    this.x = x;                 // world pixels: the centre of the chamber
    this.y = y;
    this.onChant = onChant;
    this.onEvent = onEvent;   // 'strip' | 'blood' | 'kindle' | 'glow' | 'land'
    this.onDone = onDone;

    this.t = 0;
    this.yaw = 0;               // held at zero: the skull faces you and does not turn
    this.ringA = 0;             // the fire's own angle — this is what spins
    this.phase = 'idle';
    this.pt = 0;
    this.active = false;        // true while the rite owns the scene
    this.done = false;          // already worshipped today
    this.awake = 0;             // 0 dark sockets, 1 full of fire
    this.fire = 0;              // 0 no ring at all, 1 burning
    this.hover = 0;             // it starts on the floor and ends there
    this.riseStep = 0;          // how many chant lines have lifted it
    this.naked = false;         // the player's robe is off
    this.robeAt = null;         // where the robe is lying, world pixels
    this.line = -1;             // which chant line has been spoken
    this.drop = null;           // the offered drop of blood, mid-flight
    this.splash = [];           // where it hit
    this.embers = [];
    this.dance = null;          // { x, y, dir, hop } while circling; null otherwise
    this.bubbles = [];          // the ooze, working
    this._bubT = 0;
  }

  // The ooze is never still. Bubbles rise somewhere in the pool, swell and go,
  // faster while the fire is up — the pool is the one thing in the chamber that
  // reacts to the skull without being lit by it.
  _ooze(dt) {
    this._bubT -= dt;
    if (this._bubT <= 0) {
      this._bubT = 0.55 + Math.random() * 1.5 - this.fire * 0.35;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * (POOL_R - 7);
      this.bubbles.push({
        x: this.x + Math.cos(a) * d,
        y: this.y + Math.sin(a) * d * KERB_SQUASH,
        r: 0, max: 1.4 + Math.random() * 2.4, t: 0, life: 1.1 + Math.random() * 0.9,
      });
      if (this.bubbles.length > 14) this.bubbles.shift();
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t += dt;
      const u = b.t / b.life;
      b.r = u < 0.75 ? b.max * (u / 0.75) : b.max * (1 - (u - 0.75) / 0.25);
      if (b.t >= b.life) this.bubbles.splice(i, 1);
    }
  }

  // The kerb and its pool. Drawn as its own depth item BELOW everything else in
  // the chamber, because it is floor: the worshipper dances inside the ring and
  // must always be in front of it, and the skull hangs above it.
  drawGround(ctx) {
    const t = this.t;
    const swell = 1 + this.fire * 0.03;

    // --- the pool ---------------------------------------------------------
    ctx.fillStyle = '#0b0713';                                  // the wet rim it has left
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, POOL_R * swell + 2, POOL_R * KERB_SQUASH * swell + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const oil = ctx.createRadialGradient(this.x - 8, this.y - 5, 2, this.x, this.y, POOL_R);
    oil.addColorStop(0, '#171030');
    oil.addColorStop(0.55, '#0d0819');
    oil.addColorStop(1, '#05030c');
    ctx.fillStyle = oil;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, POOL_R * swell, POOL_R * KERB_SQUASH * swell, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sheen. Two slow arcs drifting across the surface at different rates —
    // black ooze is only legible as a liquid because of what moves ON it.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, POOL_R * swell, POOL_R * KERB_SQUASH * swell, 0, 0, Math.PI * 2);
    ctx.clip();
    for (let k = 0; k < 2; k++) {
      const dx = Math.sin(t * (0.18 + k * 0.11) + k * 2.1) * 15;
      const dy = Math.cos(t * (0.13 + k * 0.09) + k) * 7;
      ctx.strokeStyle = k ? 'rgba(106,63,176,0.16)' : 'rgba(154,114,220,0.12)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(this.x + dx, this.y + dy, POOL_R * (0.42 + k * 0.26), POOL_R * KERB_SQUASH * (0.42 + k * 0.26),
        0, 0.6 + k, 2.4 + k);
      ctx.stroke();
    }
    for (const b of this.bubbles) {
      if (b.r <= 0.2) continue;
      ctx.fillStyle = 'rgba(8,5,16,0.9)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y, b.r, b.r * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(140,104,205,${0.30 * (1 - b.t / b.life)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.ellipse(b.x, b.y - b.r * 0.2, b.r * 0.8, b.r * 0.5, 0, 3.5, 5.9); ctx.stroke();
    }
    ctx.restore();

    // --- the kerb ---------------------------------------------------------
    // Back to front, so a near stone overlaps the far one behind it. Every
    // stone is the same block seeded differently, which is what a course of
    // roughly dressed kerb actually looks like.
    const stones = [];
    for (let i = 0; i < KERB_N; i++) {
      const a = (i / KERB_N) * Math.PI * 2 - Math.PI / 2;
      stones.push({ i, a, x: this.x + Math.cos(a) * KERB_R, y: this.y + Math.sin(a) * KERB_R * KERB_SQUASH });
    }
    stones.sort((p, q) => p.y - q.y);
    for (const s of stones) {
      const wob = ((s.i * 37) % 7) / 7;                        // stable per-stone variation
      const w = 8.5 + wob * 3.2, h = 6.4 + ((s.i * 53) % 5) / 5 * 2.6;
      const top = s.y - h;
      ctx.fillStyle = 'rgba(6,4,12,0.5)';                      // where it meets the ooze
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 1, w * 0.62, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = WALL.o;
      ctx.beginPath();
      ctx.moveTo(s.x - w / 2 - 1, s.y + 1.5); ctx.lineTo(s.x - w / 2 + 0.7 + wob, top - 1);
      ctx.lineTo(s.x + w / 2 - 0.5, top - 1.4); ctx.lineTo(s.x + w / 2 + 1, s.y + 1.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = WALL.b;
      ctx.beginPath();
      ctx.moveTo(s.x - w / 2 + 0.4, s.y + 0.6); ctx.lineTo(s.x - w / 2 + 1.6 + wob, top);
      ctx.lineTo(s.x + w / 2 - 1.2, top - 0.4); ctx.lineTo(s.x + w / 2 - 0.2, s.y + 0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = WALL.l;                                  // the lit cap
      ctx.beginPath();
      ctx.ellipse(s.x - 0.2, top + 0.4, w * 0.42, 1.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = WALL.h;
      ctx.fillRect(s.x - w * 0.34, top - 0.2, w * 0.32, 0.9);
      ctx.fillStyle = WALL.d;                                  // the shaded near face
      ctx.fillRect(s.x + w / 2 - 2.2, top + 1.2, 1.7, h - 1);

      if (CANDLE_ON.includes(s.i)) {
        const cy = top - 0.4;
        const ch = 5.2 + wob * 2;
        ctx.fillStyle = BONE.o; ctx.fillRect(s.x - 1.9, cy - ch, 3.8, ch);
        ctx.fillStyle = BONE.b; ctx.fillRect(s.x - 1.4, cy - ch, 2.8, ch);
        ctx.fillStyle = BONE.h; ctx.fillRect(s.x - 1.4, cy - ch, 0.9, ch - 1);
        ctx.fillStyle = BONE.d;                                // wax run down one side
        ctx.fillRect(s.x + 0.5, cy - ch + 1.6, 0.9, ch * 0.55);
        candleFlame(ctx, s.x, cy - ch - 2.2, t, s.i * 2.3);
        ctx.save();                                            // its light on the stone
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(s.x, cy - ch - 2, 1, s.x, cy - ch - 2, 16);
        g.addColorStop(0, 'rgba(255,178,80,0.20)');
        g.addColorStop(1, 'rgba(255,178,80,0)');
        ctx.fillStyle = g; ctx.fillRect(s.x - 16, cy - ch - 18, 32, 32);
        ctx.restore();
      }
    }
  }

  // Marks the day's rite as already performed. There is nothing to restore:
  // the skull's resting state and its finished state are the same, which is
  // the point of it going back down.
  settle() { this.done = true; }

  inReach(px, py) {
    return Math.hypot(px - this.x, py - this.y) < WORSHIP_R;
  }

  begin(px, py) {
    if (this.active || this.done) return false;
    this.active = true;
    this.phase = 'disrobe';
    this.pt = 0;
    this.dance = null;
    this.line = -1;
    this.riseStep = 0;
    this.naked = false;
    this.px = px; this.py = py;
    // The robe lands just to the player's left, where they dropped it.
    this.robeAt = { x: px - 9, y: py + 2 };
    return true;
  }

  update(dt) {
    this.t += dt;

    // The ring accelerates with altitude: nearly still on the floor, whipping
    // round by the time the skull is at the top of its climb.
    const lift = clamp01(this.hover / RISE);
    this.ringA += (0.8 + lift * 6.0) * dt;

    this._embers(dt, lift);
    this._splashes(dt);
    this._ooze(dt);

    if (!this.active) return;

    this.pt += dt;
    switch (this.phase) {
      case 'disrobe':
        // Four seconds, and the habit comes off a little over halfway through
        // so there is a beat of standing in it and a beat of standing without.
        if (this.pt > DISROBE * 0.55 && !this.naked) { this.naked = true; this.onEvent('strip'); }
        if (this.pt >= DISROBE) { this.phase = 'offer'; this.pt = 0; this._well(); this.onEvent('blood'); }
        break;

      case 'offer': {
        // 0.0-0.7  the drop wells at the hand
        // 0.7-1.4  it falls, arcing onto the crown of the skull
        // 1.4-1.9  it lands, and the fire takes
        // 1.9-2.6  the ring burns alone before the first word
        const d = this.drop;
        if (d) {
          if (this.pt < 0.7) {
            d.r = 0.8 + (this.pt / 0.7) * 1.4;
          } else if (this.pt < 1.4) {
            const u = (this.pt - 0.7) / 0.7;
            d.x = d.x0 + (this.x - d.x0) * u;
            // an arc, not a straight line — it is thrown, not dripped
            d.y = d.y0 + (this._cy() - SKULL_S * 0.9 - d.y0) * u - Math.sin(u * Math.PI) * 9;
            d.r = 2.2;
          } else if (this.drop) {
            this._splash(this.x, this._cy() - SKULL_S * 0.9);
            this.drop = null;
            this.onEvent('kindle');
          }
        }
        if (this.pt > 1.4) this.fire = easeOut(clamp01((this.pt - 1.4) / 0.5));
        if (this.pt >= OFFER) { this.phase = 'chant'; this.pt = 0; this.fire = 1; }
        break;
      }

      case 'chant': {
        // One line per LINE_GAP, and one step of altitude with each.
        const want = Math.min(CHANT_LINES.length - 1, Math.floor(this.pt / LINE_GAP));
        if (want > this.line) {
          this.line = want;
          this.riseStep = want + 1;
          this.onChant(CHANT_LINES[want], LINE_GAP);
        }
        const target = (this.riseStep / CHANT_LINES.length) * RISE;
        this.hover += (target - this.hover) * Math.min(1, dt * 4.5);
        this._dance(clamp01(this.pt / CHANT), this.pt);
        if (this.pt >= CHANT) { this.phase = 'glow'; this.pt = 0; }
        break;
      }

      case 'glow':
        this.dance = null;      // they stop, and watch it finish
        if (this.awake === 0) this.onEvent('glow');
        this.awake = easeOut(clamp01(this.pt / (GLOW * 0.55)));
        this.hover = RISE + Math.sin(this.t * 7) * 1.6;    // it shudders at the top
        if (this.pt >= GLOW) { this.phase = 'descend'; this.pt = 0; }
        break;

      case 'descend': {
        const u = easeInOut(clamp01(this.pt / DESCEND));
        this.hover = RISE * (1 - u);
        this.fire = 1 - u;
        this.awake = 1 - u;                                // the fire goes out of it
        if (this.pt >= DESCEND) {
          this.hover = 0; this.fire = 0; this.awake = 0;
          this.phase = 'robe'; this.pt = 0;
          this.onEvent('land');
        }
        break;
      }

      case 'robe':
        if (this.pt > REROBE * 0.5) { this.naked = false; this.robeAt = null; }
        if (this.pt >= REROBE) {
          this.phase = 'idle';
          this.active = false;
          this.done = true;
          this.onDone();
        }
        break;
    }
  }

  // The circuit. `u` runs 0..1 across the whole chant and `pt` is the raw beat
  // clock, so the orbit is driven by progress and the hop by tempo — the two
  // stay locked to the phrases however long a phrase is set to last.
  //
  // The worshipper always faces the skull, which is the reason this is a dance
  // and not a pirouette: on the near side they have their back to you, and the
  // rite is meant to be looked at from behind a naked man.
  _dance(u, pt) {
    const a = Math.PI / 2 + u * Math.PI * 2;   // starts due south, one full turn
    const ox = Math.cos(a), oy = Math.sin(a);
    const beat = (pt / (LINE_GAP / HOPS_PER_LINE)) % 1;
    this.dance = {
      x: this.x + ox * DANCE_R,
      y: this.y + oy * DANCE_R * DANCE_SQUASH,
      // face inward: the direction from the worshipper back to the skull
      dir: Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 'left' : 'right') : (oy > 0 ? 'up' : 'down'),
      hop: Math.sin(beat * Math.PI) * HOP_H,
    };
  }

  // Where the skull is actually drawn, floor lift included. Anything that has
  // to meet it — the falling drop, the splash, the embers — asks for this
  // rather than working from this.y.
  _cy() { return this.y - BASE_LIFT - this.hover; }

  // A bead of blood on the worshipper's hand. There is blood to give because
  // the Abbot has already opened their back — the order of the day's duties is
  // the reason this beat can exist at all.
  _well() {
    this.drop = { x: this.px + 5, y: this.py - 4, x0: this.px + 5, y0: this.py - 4, r: 0.8 };
  }

  _splash(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI + Math.random() * Math.PI;
      const sp = 14 + Math.random() * 30;
      this.splash.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8,
        t: 0, life: 0.4 + Math.random() * 0.4,
      });
    }
    this.stain = { x, y };
  }

  _splashes(dt) {
    for (let i = this.splash.length - 1; i >= 0; i--) {
      const s = this.splash[i];
      s.t += dt;
      if (s.t >= s.life) { this.splash.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 120 * dt;
    }
  }

  _embers(dt, lift) {
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.t += dt; e.y -= e.vy * dt; e.x += e.vx * dt;
      if (e.t >= e.life) this.embers.splice(i, 1);
    }
    if (this.fire > 0.3 && this.embers.length < 20 && Math.random() < dt * 26) {
      const a = Math.random() * Math.PI * 2;
      this.embers.push({
        x: this.x + Math.cos(a) * RING_R, y: this._cy() + Math.sin(a) * RING_R * 0.32,
        vx: (Math.random() - 0.5) * 5, vy: 10 + Math.random() * 14 + lift * 12,
        t: 0, life: 0.8 + Math.random() * 0.7,
      });
    }
  }

  // --- drawing --------------------------------------------------------------

  // The whole shrine as one depth-sorted item: the floor shadow, the half of
  // the fire ring behind the skull, the skull, then the half in front. Sorting
  // the ring around the skull by its own depth is what makes it read as a ring
  // rather than as a halo painted on — and it is the only thing here that
  // moves in a circle, so it has to be convincing.
  draw(ctx) {
    const cy = this._cy();
    const sp = clamp01(this.hover / RISE);

    ctx.fillStyle = `rgba(20,12,44,${0.5 - sp * 0.26})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 7, SKULL_S * (0.8 + sp * 0.5), SKULL_S * (0.26 + sp * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();

    const ring = [];
    if (this.fire > 0.02) {
      for (let i = 0; i < RING_N; i++) {
        const a = this.ringA + (i / RING_N) * Math.PI * 2;
        ring.push({
          x: this.x + Math.cos(a) * RING_R,
          y: cy + Math.sin(a) * RING_R * 0.32 + 4,
          z: Math.sin(a),
          seed: i * 3.7,
        });
      }
    }
    const flame = (f) => {
      const s = (0.52 + (f.z + 1) * 0.22) * this.fire;
      if (s > 0.05) blueFlame(ctx, f.x, f.y, s, this.t, f.seed);
    };
    for (const f of ring) if (f.z <= 0) flame(f);

    this._drawSkull(ctx, this.x, cy, SKULL_S, this.yaw, 1);

    for (const f of ring) if (f.z > 0) flame(f);

    // the offered blood, and what it left behind
    if (this.drop) {
      const d = this.drop;
      ctx.fillStyle = BLOOD.o;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r + 0.6, d.r * 1.25 + 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BLOOD.b;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 1.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BLOOD.l;
      ctx.fillRect(d.x - d.r * 0.4, d.y - d.r * 0.9, Math.max(0.6, d.r * 0.4), Math.max(0.6, d.r * 0.5));
    }
    for (const s of this.splash) {
      ctx.fillStyle = s.t / s.life < 0.5 ? BLOOD.b : BLOOD.d;
      ctx.fillRect(s.x, s.y, 1, 1);
    }

    for (const e of this.embers) {
      const a = (1 - e.t / e.life) * 0.85 * this.fire;
      ctx.fillStyle = `rgba(143,220,255,${a})`;
      ctx.fillRect(e.x, e.y, 1, 1);
    }
  }

  // The robe lying on the flagstones while its owner stands without it.
  drawRobe(ctx) {
    if (!this.robeAt) return;
    const { x, y } = this.robeAt;
    ctx.fillStyle = SHADOW;
    ctx.beginPath(); ctx.ellipse(x, y + 1, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#171220'; ctx.fillRect(x - 5, y - 3.5, 10, 5);
    ctx.fillStyle = '#2b2438'; ctx.fillRect(x - 4.5, y - 3, 9, 3.4);
    ctx.fillStyle = '#3b3350'; ctx.fillRect(x - 4.5, y - 3, 9, 1);
    ctx.fillStyle = '#171220'; ctx.fillRect(x - 2, y - 3, 1.2, 3.4);   // a fold
  }

  // --- the skull ------------------------------------------------------------
  //
  // The silhouette is the whole job. A filled ellipse with sockets punched in
  // it reads as a ball with holes, so the outline is built from a stack of
  // half-widths down the skull's height — a wide cranial dome, the temples at
  // the widest point, a pinch under the cheekbones, then a narrower jaw and a
  // squared chin. Turning the head blends that profile toward a SIDE profile
  // (longer front-to-back) and leans the lower face in the direction it is
  // pointing, which is what gives it a muzzle and a chin from three-quarters.

  // half-width at each height, front-on and side-on, plus how far that level
  // juts forward when the head is in profile. v runs -1 (crown) to +1 (chin).
  static get PROFILE() {
    return [
      // v      front  side   lean
      [-1.00, 0.30, 0.32, 0.00],
      [-0.86, 0.62, 0.66, 0.00],
      [-0.66, 0.86, 0.94, 0.01],
      [-0.42, 0.98, 1.08, 0.02],
      [-0.14, 0.96, 1.06, 0.06],
      [ 0.10, 0.84, 0.96, 0.11],
      [ 0.30, 0.68, 0.82, 0.15],
      [ 0.54, 0.60, 0.74, 0.18],
      [ 0.78, 0.54, 0.64, 0.19],
      [ 0.94, 0.42, 0.48, 0.18],
      [ 1.00, 0.26, 0.30, 0.17],
    ];
  }

  _outline(ctx, x, y, S, c, s, grow) {
    const P = SkullShrine.PROFILE;
    const a = Math.abs(s);
    const H = S * 1.06;
    ctx.beginPath();
    for (let i = 0; i < P.length; i++) {
      const [v, fw, sw, lean] = P[i];
      const hw = (fw + (sw - fw) * a) * S + grow;
      const cx = x + s * lean * S;
      const py = y + v * H + (v > 0 ? grow : -grow) * 0.6;
      i === 0 ? ctx.moveTo(cx + hw, py) : ctx.lineTo(cx + hw, py);
    }
    for (let i = P.length - 1; i >= 0; i--) {
      const [v, fw, sw, lean] = P[i];
      const hw = (fw + (sw - fw) * a) * S + grow;
      const cx = x + s * lean * S;
      ctx.lineTo(cx - hw, y + v * H + (v > 0 ? grow : -grow) * 0.6);
    }
    ctx.closePath();
  }

  _drawSkull(ctx, x, y, S, yaw, lit) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const front = Math.max(0, c);
    const H = S * 1.06;

    this._outline(ctx, x, y, S, c, s, 1.3);
    ctx.fillStyle = BONE.o; ctx.fill();
    this._outline(ctx, x, y, S, c, s, 0);
    ctx.fillStyle = BONE.b; ctx.fill();

    // Everything below is clipped to the silhouette, so shading can be laid in
    // with plain shapes without softening the edge that defines the form.
    ctx.save();
    this._outline(ctx, x, y, S, c, s, 0);
    ctx.clip();

    // lit from the upper left in hard steps, LttP rather than airbrush
    ctx.fillStyle = BONE.l;
    ctx.beginPath(); ctx.ellipse(x - S * 0.30, y - H * 0.34, S * 0.78, H * 0.60, -0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BONE.h;
    ctx.beginPath(); ctx.ellipse(x - S * 0.44, y - H * 0.56, S * 0.32, H * 0.22, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BONE.d;
    ctx.beginPath(); ctx.ellipse(x + S * 0.78, y + H * 0.46, S * 0.66, H * 0.60, 0.2, 0, Math.PI * 2); ctx.fill();

    // coronal suture, swinging round the crown with the head
    ctx.strokeStyle = BONE.d; ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const u = -1 + (i / 10) * 2;
      const pj = proj(u, 0, c, s);
      const sx = x + pj.x * S * 0.94;
      const sy = y - H * 0.60 + Math.abs(u) * H * 0.20 + (i % 2 ? 0.6 : -0.6);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // temporal hollows behind the eyes — they survive far round the turn and
    // are most of what stops the cranium reading as a sphere
    for (const side of [-1, 1]) {
      const p = proj(side * 0.80, 0.16, c, s);
      if (p.z <= 0) continue;
      ctx.fillStyle = BONE.d;
      ctx.beginPath();
      ctx.ellipse(x + p.x * S, y - H * 0.16, S * 0.19 * (0.3 + 0.7 * Math.abs(c)), H * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // zygomatic arch: a lit ridge running back from each cheek
    for (const side of [-1, 1]) {
      const p = proj(side * 0.74, 0.30, c, s);
      if (p.z <= 0.02) continue;
      ctx.fillStyle = BONE.l;
      ctx.fillRect(x + p.x * S - S * 0.14, y + H * 0.06, S * 0.28, 1.6);
    }
    ctx.restore();

    // --- eye sockets ---
    const eyes = [];
    for (const side of [-1, 1]) {
      const p = proj(side * 0.40, 0.62, c, s);
      if (p.z <= 0.04) continue;
      const ex = x + p.x * S, ey = y - H * 0.14;
      const ew = S * 0.29 * (0.26 + 0.74 * Math.abs(c));
      const eh = H * 0.26;
      // A socket is not a circle: it is squarer at the top where the brow sits
      // and drawn toward the nose at the bottom inner corner.
      ctx.fillStyle = BONE.o;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(ex - ew - 1, ey - eh - 1, (ew + 1) * 2, (eh + 1) * 2, [2.5, 2.5, ew, ew]);
      else ctx.ellipse(ex, ey, ew + 1, eh + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = VOID;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(ex - ew, ey - eh, ew * 2, eh * 2, [2, 2, ew * 0.9, ew * 0.9]);
      else ctx.ellipse(ex, ey, ew, eh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BONE.h;                                   // brow shelf
      ctx.fillRect(ex - ew - 0.5, ey - eh - 2.4, ew * 2 + 1, 1.4);
      eyes.push({ ex, ey, ew, eh });
    }

    // Waking is carried entirely by the sockets now that the mouth is fixed, so
    // they have to do all the work: not painted red but LIT, built the way the
    // braziers are — a deep red body, a hot orange-red inside it and a pale
    // core, with an additive halo throwing that light back onto the bone
    // around them. Flat crimson read as two stickers; this reads as fire.
    if (this.awake > 0.01) {
      const a = this.awake;
      const flick = 0.86 + Math.sin(this.t * 13) * 0.14;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const e of eyes) {
        const R = e.ew * 4.2 * flick;
        const g = ctx.createRadialGradient(e.ex, e.ey, 0, e.ex, e.ey, R);
        g.addColorStop(0, `rgba(255,196,120,${0.85 * a})`);
        g.addColorStop(0.28, `rgba(232,90,74,${0.45 * a})`);
        g.addColorStop(1, 'rgba(198,43,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(e.ex - R, e.ey - R, R * 2, R * 2);
      }
      ctx.restore();
      for (const e of eyes) {
        const cyy = e.ey + e.eh * 0.1;
        ctx.fillStyle = `rgba(140,20,24,${a})`;
        ctx.beginPath(); ctx.ellipse(e.ex, cyy, e.ew * 0.82, e.eh * 0.72, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(214,52,44,${a})`;
        ctx.beginPath(); ctx.ellipse(e.ex, cyy, e.ew * 0.62 * flick, e.eh * 0.56 * flick, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(247,128,80,${a})`;
        ctx.beginPath(); ctx.ellipse(e.ex, cyy, e.ew * 0.34 * flick, e.eh * 0.30 * flick, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,226,170,${a * 0.9})`;
        ctx.beginPath(); ctx.ellipse(e.ex, cyy, e.ew * 0.15, e.eh * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // --- nasal aperture: an inverted heart, only from the front three-quarters
    const nz = proj(0, 0.78, c, s);
    if (nz.z > 0.12) {
      const nx = x + nz.x * S, ny = y + H * 0.20;
      const nw = S * 0.14 * (0.34 + 0.66 * front);
      ctx.fillStyle = VOID;
      ctx.beginPath();
      ctx.moveTo(nx, ny - S * 0.26);
      ctx.lineTo(nx - nw, ny + S * 0.05);
      ctx.lineTo(nx, ny - S * 0.02);
      ctx.lineTo(nx + nw, ny + S * 0.05);
      ctx.closePath(); ctx.fill();
    }

    // --- the mouth ---
    // One dark band with small teeth hanging into it from above and rising
    // from below. Placing them on a projected dental ARCH is what keeps them
    // on the muzzle as the head turns; clamping the width stops them
    // collapsing into a smear at three-quarters.
    //
    // The mouth is fixed. It used to curl into a grin when the skull woke, and
    // a smiling skull turned out to read as friendly, which is the opposite of
    // what a thing that has just been fed blood should look like. Waking is now
    // carried entirely by the sockets.
    const mouthTop = y + H * 0.46;
    const mh = S * 0.26;
    const arch = [];
    for (let k = -3; k <= 3; k++) {
      const a = k * 0.30;
      const p = proj(Math.sin(a) * 0.44, Math.cos(a) * 0.54, c, s);
      if (p.z <= 0.02) continue;
      arch.push({ k, x: x + p.x * S });
    }
    if (arch.length) {
      const lo = Math.min(...arch.map(t => t.x)) - S * 0.09;
      const hi = Math.max(...arch.map(t => t.x)) + S * 0.09;
      const rise = () => 0;
      const band = (yTop, h, style) => {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(lo, yTop);
        for (const t of arch) ctx.lineTo(t.x, yTop);
        ctx.lineTo(hi, yTop);
        ctx.lineTo(hi, yTop + h);
        for (let i = arch.length - 1; i >= 0; i--) ctx.lineTo(arch[i].x, yTop + h);
        ctx.lineTo(lo, yTop + h);
        ctx.closePath(); ctx.fill();
      };
      band(mouthTop - 1, mh + 2, BONE.o);
      band(mouthTop, mh, 'rgba(8,6,17,0.9)');

      // Upper teeth hang from the top of the band and lower teeth rise from
      // the bottom, offset by half a tooth so they interlock instead of
      // stacking into one crowded row. A clear dark gap is left between them.
      const tw = Math.max(1.0, S * 0.095 * (0.45 + 0.55 * Math.abs(c)));
      for (const t of arch) {
        ctx.fillStyle = BONE.l;
        ctx.fillRect(t.x - tw, mouthTop, tw * 2 - 0.7, mh * 0.38);
      }
      for (let i = 0; i < arch.length - 1; i++) {
        const mid = (arch[i].x + arch[i + 1].x) / 2;
        ctx.fillStyle = BONE.l;
        ctx.fillRect(mid - tw * 0.75, mouthTop + mh * 0.70, tw * 1.5 - 0.7, mh * 0.30);
      }
    }

    // --- the back of the head, once it has turned past three-quarters ---
    if (c < -0.15) {
      const back = Math.min(1, (-c - 0.15) / 0.5);
      ctx.save();
      ctx.globalAlpha = back;
      ctx.strokeStyle = BONE.d; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(x, y + H * 0.06, S * 0.58, H * 0.30, 0, Math.PI * 0.10, Math.PI * 0.90);
      ctx.stroke();
      const fm = proj(0, -0.5, c, s);
      ctx.fillStyle = VOID;
      ctx.beginPath();
      ctx.ellipse(x + fm.x * S * 0.4, y + H * 0.66, S * 0.16, H * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
