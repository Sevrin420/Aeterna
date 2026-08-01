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

import { BONE, BLOOD, VOID, SOUL, SHADOW, blueFlame, SOULFIRE } from './palette.js';

export const WORSHIP_R = 30;    // how close you have to stand
const SKULL_S = 18;             // cranium half-width in pixels — deliberately large
const RISE = 34;                // how high it gets by the last line of the chant
// Even at rest the skull is drawn well above its tile centre. Centred on the
// tile it looked half-sunk into the flagstones, and the worshipper — who can
// only stand one tile south of it — appeared to be standing inside its jaw.
// This puts its chin on the floor where a skull's chin belongs.
const BASE_LIFT = 13;
const RING_N = 11;              // flames in the ring
const RING_R = 30;              // ring radius

// Beat lengths. Two are fixed by the design — four seconds to undress and one
// second between chant lines — and the rest are the shortest each can be and
// still land.
const DISROBE = 4.0;
const OFFER = 1.9;              // the blood wells, falls, and lands
const LINE_GAP = 1.0;           // one second between phrases
const GLOW = 1.8;               // the sockets fill with fire
const DESCEND = 1.6;
const REROBE = 1.0;

// Two phrases, alternating, three times each: six lines, six seconds, and six
// steps of altitude.
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
        // One line a second, and one step of altitude with each.
        const want = Math.min(CHANT_LINES.length - 1, Math.floor(this.pt / LINE_GAP));
        if (want > this.line) {
          this.line = want;
          this.riseStep = want + 1;
          this.onChant(CHANT_LINES[want]);
        }
        const target = (this.riseStep / CHANT_LINES.length) * RISE;
        this.hover += (target - this.hover) * Math.min(1, dt * 4.5);
        if (this.pt >= CHANT) { this.phase = 'glow'; this.pt = 0; }
        break;
      }

      case 'glow':
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
