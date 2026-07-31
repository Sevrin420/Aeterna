// The shrine — a great skull hanging in the middle of the east chamber, turning
// slowly inside a ring of blue fire, and the rite of worshipping it.
//
// Two things live here because they are inseparable: the skull is not a prop
// that a rite happens next to, it is the thing the rite acts on. It floats, it
// spins, it wakes up, it grins, and at the end of the rite it comes down and
// rests on the floor for the remainder of the day.
//
// The skull is drawn procedurally at an arbitrary yaw rather than as a set of
// baked frames. Every feature is placed in skull-space (u = left/right,
// v = up/down, w = front/back) and projected through one rotation about the
// vertical axis, so a socket slides toward the silhouette and narrows as the
// head turns, the nasal aperture disappears at three-quarters, and the back of
// the cranium comes round with its suture and its spine-hole. Baked frames
// would have needed a dozen drawings and would still have popped between them.

import { BONE, BLOOD, VOID, SOUL, SHADOW, blueFlame, SOULFIRE } from './palette.js';

export const WORSHIP_R = 30;    // how close you have to stand
const SKULL_S = 18;             // cranium half-width in pixels — deliberately large
const HOVER = 30;               // resting height above the floor
const RING_N = 11;              // flames in the ring
const RING_R = 30;              // ring radius
const SPIN = 0.52;              // rad/s at rest — a full turn in about twelve seconds

// Beat lengths. Only the chant is fixed by the design (six seconds); the rest
// are the shortest each can be and still land.
const DISROBE = 1.1;
const CHANT = 6.0;
const AWAKEN = 1.6;
const DESCEND = 2.0;
const REROBE = 1.0;

// Five lines over six seconds. Short enough that a bubble is fully readable
// before the next one replaces it.
const CHANT_LINES = [
  'Sanguis aeternus',
  'Vita aeterna',
  'Ossa mea tua sunt',
  'Nudus veni',
  'Nudus abeo',
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

// One point of the skull, rotated about the vertical axis and flattened.
// Returns the screen offset in skull radii plus the depth: z > 0 faces us.
function proj(u, w, c, s) {
  return { x: u * c + w * s, z: -u * s + w * c };
}

export class SkullShrine {
  constructor({ x, y, onChant = () => {}, onDone = () => {} }) {
    this.x = x;                 // world pixels: the centre of the chamber
    this.y = y;
    this.onChant = onChant;
    this.onDone = onDone;

    this.t = 0;
    this.yaw = 0;
    this.phase = 'idle';
    this.pt = 0;
    this.active = false;        // true while the rite owns the scene
    this.grounded = false;      // it has already come down today
    this.awake = 0;             // 0 sleeping, 1 red-eyed and grinning
    this.hover = HOVER;
    this.naked = false;         // the player's robe is off
    this.robeAt = null;         // where the robe is lying, world pixels
    this.line = -1;             // which chant line has been spoken
    this.embers = [];
  }

  // Restores the shrine to "already worshipped today" without replaying the
  // rite — used when the scene is entered and the server says it is done.
  settle() {
    this.grounded = true;
    this.hover = 0;
    this.awake = 1;
  }

  inReach(px, py) {
    return Math.hypot(px - this.x, py - this.y) < WORSHIP_R;
  }

  begin(px, py) {
    if (this.active || this.grounded) return false;
    this.active = true;
    this.phase = 'disrobe';
    this.pt = 0;
    this.line = -1;
    this.naked = false;
    // The robe lands just to the player's left, where they dropped it.
    this.robeAt = { x: px - 9, y: py + 2 };
    return true;
  }

  update(dt) {
    this.t += dt;

    // It turns faster the closer it is to waking, and stops dead once it is
    // down: a skull resting on the floor that kept spinning would look like it
    // had never landed.
    const spin = this.phase === 'chant' ? SPIN * (1 + this.pt / CHANT * 2.2)
      : this.phase === 'awaken' ? SPIN * 3.4
        : this.grounded ? 0 : SPIN;
    this.yaw = (this.yaw + spin * dt) % (Math.PI * 2);

    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.t += dt; e.y -= e.vy * dt; e.x += e.vx * dt;
      if (e.t >= e.life) this.embers.splice(i, 1);
    }
    if (!this.grounded && this.embers.length < 18 && Math.random() < dt * 22) {
      const a = Math.random() * Math.PI * 2;
      this.embers.push({
        x: this.x + Math.cos(a) * RING_R, y: this.y - this.hover + Math.sin(a) * RING_R * 0.32,
        vx: (Math.random() - 0.5) * 5, vy: 9 + Math.random() * 12,
        t: 0, life: 0.9 + Math.random() * 0.8,
      });
    }

    if (!this.active) {
      if (!this.grounded) this.hover = HOVER + Math.sin(this.t * 1.1) * 2.6;
      return;
    }

    this.pt += dt;
    switch (this.phase) {
      case 'disrobe':
        this.hover = HOVER + Math.sin(this.t * 1.1) * 2.6;
        if (this.pt > 0.55) this.naked = true;
        if (this.pt >= DISROBE) { this.phase = 'chant'; this.pt = 0; }
        break;

      case 'chant': {
        this.hover = HOVER + Math.sin(this.t * 1.1) * 2.6;
        // One line every CHANT/5 seconds, spoken the moment its slot opens.
        const want = Math.min(CHANT_LINES.length - 1, Math.floor(this.pt / (CHANT / CHANT_LINES.length)));
        if (want > this.line) { this.line = want; this.onChant(CHANT_LINES[want]); }
        if (this.pt >= CHANT) { this.phase = 'awaken'; this.pt = 0; }
        break;
      }

      case 'awaken': {
        const u = easeOut(clamp01(this.pt / (AWAKEN * 0.7)));
        this.awake = u;
        // It turns to face whoever woke it and then holds there.
        const target = 0;
        const d = ((target - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        if (this.pt > AWAKEN * 0.45) this.yaw += d * Math.min(1, dt * 6);
        this.hover = HOVER + 3 + Math.sin(this.t * 6) * 1.4;   // it shudders
        if (this.pt >= AWAKEN) { this.phase = 'descend'; this.pt = 0; this.yaw = 0; }
        break;
      }

      case 'descend': {
        const u = easeInOut(clamp01(this.pt / DESCEND));
        this.hover = (HOVER + 3) * (1 - u);
        this.yaw = 0;
        if (this.pt >= DESCEND) {
          this.hover = 0;
          this.grounded = true;
          this.phase = 'robe';
          this.pt = 0;
        }
        break;
      }

      case 'robe':
        if (this.pt > REROBE * 0.5) { this.naked = false; this.robeAt = null; }
        if (this.pt >= REROBE) {
          this.phase = 'idle';
          this.active = false;
          this.onDone();
        }
        break;
    }
  }

  // --- drawing --------------------------------------------------------------

  // The whole shrine as one depth-sorted item: the floor shadow, the half of
  // the fire ring behind the skull, the skull, then the half in front. Sorting
  // the ring around the skull by its own depth is what makes it read as a ring
  // rather than as a halo painted on.
  draw(ctx) {
    const cy = this.y - this.hover;
    const lit = 1 - clamp01(this.hover / HOVER) * 0.35;

    // ground shadow: tight and dark when it is down, wide and faint aloft
    const sp = clamp01(this.hover / HOVER);
    ctx.fillStyle = `rgba(20,12,44,${0.5 - sp * 0.28})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 7, SKULL_S * (0.8 + sp * 0.5), SKULL_S * (0.26 + sp * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();

    const ring = [];
    for (let i = 0; i < RING_N; i++) {
      const a = this.t * 0.9 + (i / RING_N) * Math.PI * 2;
      ring.push({
        x: this.x + Math.cos(a) * RING_R,
        y: cy + Math.sin(a) * RING_R * 0.32 + 4,
        z: Math.sin(a),
        seed: i * 3.7,
      });
    }
    const flame = (f) => {
      // near flames are bigger; the ring dies down as the skull settles
      const s = (0.52 + (f.z + 1) * 0.22) * (this.grounded ? 0.55 : 1);
      blueFlame(ctx, f.x, f.y, s, this.t, f.seed);
    };
    for (const f of ring) if (f.z <= 0) flame(f);

    this._drawSkull(ctx, this.x, cy, SKULL_S, this.yaw, lit);

    for (const f of ring) if (f.z > 0) flame(f);

    for (const e of this.embers) {
      const a = (1 - e.t / e.life) * 0.85;
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

    if (this.awake > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const e of eyes) {
        const g = ctx.createRadialGradient(e.ex, e.ey, 0, e.ex, e.ey, e.ew * 3.6);
        g.addColorStop(0, `rgba(232,90,74,${0.9 * this.awake})`);
        g.addColorStop(0.4, `rgba(198,43,48,${0.34 * this.awake})`);
        g.addColorStop(1, 'rgba(198,43,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(e.ex - e.ew * 3.6, e.ey - e.ew * 3.6, e.ew * 7.2, e.ew * 7.2);
      }
      ctx.restore();
      for (const e of eyes) {
        ctx.fillStyle = `rgba(198,43,48,${this.awake})`;
        ctx.beginPath(); ctx.ellipse(e.ex, e.ey + e.eh * 0.1, e.ew * 0.72, e.eh * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(247,154,120,${this.awake})`;
        ctx.beginPath(); ctx.ellipse(e.ex, e.ey + e.eh * 0.1, e.ew * 0.30, e.eh * 0.26, 0, 0, Math.PI * 2); ctx.fill();
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
    const grin = this.awake;
    const mouthTop = y + H * 0.46;
    const mh = S * 0.26 + grin * S * 0.05;
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
      // How far this tooth's corner of the mouth lifts. Grinning raises the
      // ends of the whole band, not just the teeth, or the smile reads as a
      // row of loose blocks floating over a straight slot.
      const rise = (k) => grin * Math.abs(k) * S * 0.05;
      const band = (yTop, h, style) => {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.moveTo(lo, yTop - rise(3));
        for (const t of arch) ctx.lineTo(t.x, yTop - rise(t.k));
        ctx.lineTo(hi, yTop - rise(3));
        ctx.lineTo(hi, yTop - rise(3) + h);
        for (let i = arch.length - 1; i >= 0; i--) ctx.lineTo(arch[i].x, yTop - rise(arch[i].k) + h);
        ctx.lineTo(lo, yTop - rise(3) + h);
        ctx.closePath(); ctx.fill();
      };
      band(mouthTop - 1, mh + 2, BONE.o);
      band(mouthTop, mh, `rgba(8,6,17,${0.86 + grin * 0.14})`);

      // Upper teeth hang from the top of the band and lower teeth rise from
      // the bottom, offset by half a tooth so they interlock instead of
      // stacking into one crowded row. A clear dark gap is left between them.
      const tw = Math.max(1.0, S * 0.095 * (0.45 + 0.55 * Math.abs(c)));
      for (const t of arch) {
        const top = mouthTop - rise(t.k);
        ctx.fillStyle = grin > 0.4 ? BONE.h : BONE.l;
        ctx.fillRect(t.x - tw, top, tw * 2 - 0.7, mh * 0.38);
      }
      for (let i = 0; i < arch.length - 1; i++) {
        const mid = (arch[i].x + arch[i + 1].x) / 2;
        const top = mouthTop - rise((arch[i].k + arch[i + 1].k) / 2);
        ctx.fillStyle = BONE.l;
        ctx.fillRect(mid - tw * 0.75, top + mh * 0.70, tw * 1.5 - 0.7, mh * 0.30);
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
