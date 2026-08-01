// The scourge — the Abbot's rite, replacing the parcel you used to hand him.
//
// Bundles of cut switches stand against the north wall of the nave, behind the
// Abbot. You take one, walk it around the altar, and put it in his hands. He
// uses it. Five times. The pain is the offering; the Devotion is what is left
// of you afterwards.
//
// The whole thing is a cutscene: while it runs the scene hands over movement,
// input and the camera, and this module drives the pose of both figures, the
// arc of the switch, the shake, the hit-stop, the blood and the light. It is
// deliberately one file — a five-beat sequence whose timings only make sense
// read together, and splitting it across the scene would scatter the rhythm.
//
// Nothing here is explained to the player anywhere. A bundle of sticks by a
// wall and a man who does not look up are the whole tutorial.

import { WOOD, BLOOD, GOLD, BONE, IRON, VOID, SHADOW } from './palette.js';
import { drawCharacter } from './spritesheet.js';

// ---------------------------------------------------------------------------
// The switches, standing against the nave's north wall behind the Abbot.
// ---------------------------------------------------------------------------

export const STICK_RESPAWN = 90;   // seconds before a cut switch is replaced
const STICK_R = 16;                // reach

export class StickPile {
  constructor(spots, px) {
    this.spots = spots;
    this.px = px;
    this.state = spots.map(() => ({ takenAt: null }));
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    for (const s of this.state) {
      if (s.takenAt != null && this.t - s.takenAt >= STICK_RESPAWN) s.takenAt = null;
    }
  }

  has(i) { return this.state[i].takenAt == null; }
  take(i) { this.state[i].takenAt = this.t; }
  // A switch carried off and dropped is simply gone; the pile replenishes on
  // its own timer, exactly like the firewood.
  give() {}

  at(x, y) {
    for (let i = 0; i < this.spots.length; i++) {
      if (!this.has(i)) continue;
      const s = this.spots[i];
      if (Math.hypot(x - this.px(s.col), y - this.px(s.row)) < STICK_R) return i;
    }
    return -1;
  }

  // Three switches leaning butt-down against the wall, bound at the waist with
  // a leather thong. Drawn on the WOOD ramp and outlined in its
  // own dark brown, never black.
  draw(ctx, x, y, seed = 0) {
    ctx.fillStyle = SHADOW;
    ctx.beginPath(); ctx.ellipse(x, y + 4, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const lean = -0.42 - i * 0.07;            // leaning back against the wall
      const len = 15 - i * 1.2;
      ctx.save();
      ctx.translate(x - 1 + i * 1.6, y + 3);
      ctx.rotate(lean);
      ctx.fillStyle = WOOD.o; ctx.fillRect(-1.1, -len, 2.2, len);
      ctx.fillStyle = WOOD.b; ctx.fillRect(-0.6, -len + 0.5, 1.2, len - 0.5);
      ctx.fillStyle = WOOD.l; ctx.fillRect(-0.6, -len + 0.5, 0.5, len - 2);
      ctx.fillStyle = WOOD.h; ctx.fillRect(-0.6, -len + 0.5, 0.5, 3);
      ctx.restore();
    }
    ctx.fillStyle = IRON.o; ctx.fillRect(x - 2.5, y - 4, 6, 1.6);   // thong
    ctx.fillStyle = WOOD.d; ctx.fillRect(x - 2.5, y - 4, 6, 0.6);
  }

  // In the penitent's hands as they walk it up the nave.
  drawCarried(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.5);
    ctx.fillStyle = WOOD.o; ctx.fillRect(-8, -1.2, 16, 2.4);
    ctx.fillStyle = WOOD.b; ctx.fillRect(-7.5, -0.7, 15, 1.4);
    ctx.fillStyle = WOOD.l; ctx.fillRect(-7.5, -0.7, 15, 0.5);
    ctx.fillStyle = WOOD.d; ctx.fillRect(5.5, -0.7, 2, 1.4);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// The rite itself.
// ---------------------------------------------------------------------------

const LASHES = 5;
const MARK_DY = 18;      // pixels south of the Abbot the penitent kneels

// Per-lash beat lengths. The first four accelerate — he finds a rhythm and
// gets faster and harder — and the fifth breaks the rhythm the other way: a
// long, slow, dreadful windup in half-speed, then the heaviest stop of all.
const RAISE  = [0.55, 0.48, 0.42, 0.38, 0.85];
const STRIKE = [0.10, 0.09, 0.08, 0.08, 0.30];
const HIT    = [0.07, 0.09, 0.11, 0.13, 0.26];   // hit-stop: the world freezes
const REC    = [0.34, 0.32, 0.30, 0.28, 0.60];

const EYE_R  = [2.4, 3.2, 4.1, 5.0, 6.5];        // how far the eyes come out
const SHAKE  = [2.0, 2.6, 3.3, 4.1, 5.8];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

// Switch angles in the Abbot's local space, measured clockwise from +x.
// He carries it low and to his right, takes it up over his shoulder, and
// brings it down across the shoulders of the figure kneeling below him.
// The pivot is his fist at chest height, not his shoulder: at -7 the grip
// block sat across his face at the bottom of the arc. HIT_A and STICK_LEN are
// solved from it — from (4,-4) to the penitent's shoulders at (0,10) is 14.6px
// at 1.85 rad, so the tip lands on the back rather than short of it or through
// the floor.
const REST_A = 1.15, TOP_A = -2.05, HIT_A = 1.85;
const PIVOT_X = 4, PIVOT_Y = -4;                 // his fist, in local space
const STICK_LEN = 16;

const APPROACH = 0.6;    // walking the last step in and going down on the knees
const BREAK_T = 1.9;     // the switch snaps, the light comes back
const BARS = 26;         // letterbox height at full extension

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u;
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

export class Scourge {
  constructor({ onLash = () => {}, onDone = () => {} } = {}) {
    this.onLash = onLash;
    this.onDone = onDone;
    // Blood on the flagstones outlives the rite — the abbey does not clean up
    // after itself, and a returning player should be able to see where they
    // knelt yesterday. Everything else is reset per rite.
    this.stains = [];
    this._reset();
    this.active = false;
    this.mx = 0; this.my = 0;
  }

  // (ax, ay) is the Abbot's station centre in world pixels; (fx, fy) is where
  // the penitent was standing when they handed the switch over.
  begin(ax, ay, fx, fy) {
    this._reset();
    this.active = true;
    this.ax = ax; this.ay = ay;
    this.mx = ax; this.my = ay + MARK_DY;
    this.fromX = fx; this.fromY = fy;
    this.penX = fx; this.penY = fy;
  }

  // Every field the update and draw paths touch, so the module is safe to
  // call every frame from a scene that may never run the rite at all.
  _reset() {
    this.active = false;
    this.phase = 'approach';
    this.pt = 0;
    this.rt = 0;
    this.lash = 0;
    this.worldScale = 1;
    this.ax = 0; this.ay = 0;
    this.fromX = 0; this.fromY = 0;
    this.penX = 0; this.penY = 0;

    this.stickA = REST_A;
    this.ghosts = [];      // trailing copies of the switch during a strike
    this.abbotLean = 0;
    this.abbotFlash = 0;
    this.penFlash = 0;
    this.penLurch = 0;     // forward jolt on contact, decaying
    this.penSquash = 1;
    this.kneel = 0;        // 0 standing, 1 fully down

    this.eyeR = 0.9;
    this.eyeTarget = 0.9;
    this.shake = 0;
    this.flashes = [];
    this.rings = [];
    this.parts = [];
    this.motes = [];
    this.splinters = [];
    this.numeral = null;
    this.bars = 0;
    this.dim = 0;          // how far the nave has been dimmed for the rite
    this.bloom = 0;        // the gold that comes up out of them at the end
    this.broken = false;
  }

  // The scene multiplies its own world dt by this, so the braziers, the crowd
  // and the flames slow with the fifth lash and stop dead on every impact.
  _scaleFor() {
    if (this.phase === 'hit') return 0;
    if (this.lash === LASHES - 1 && (this.phase === 'raise' || this.phase === 'strike')) return 0.32;
    return 1;
  }

  update(dt) {
    if (!this.active) return;
    this.rt += dt;
    this.pt += dt;
    this.worldScale = this._scaleFor();

    const closing = this.phase === 'break' && this.pt > BREAK_T - 0.7;
    this.bars += ((closing ? 0 : 1) * BARS - this.bars) * Math.min(1, dt * 7);
    this.dim += ((closing ? 0 : 0.42) - this.dim) * Math.min(1, dt * 4);

    this._advance(dt);
    this._pose(dt);
    this._particles(dt);
  }

  _advance(dt) {
    const i = this.lash;
    switch (this.phase) {
      case 'approach':
        if (this.pt >= APPROACH) this._go('raise');
        break;
      case 'raise':
        if (this.pt >= RAISE[i]) this._go('strike');
        break;
      case 'strike':
        if (this.pt >= STRIKE[i]) { this._impact(); this._go('hit'); }
        break;
      case 'hit':
        if (this.pt >= HIT[i]) this._go('recover');
        break;
      case 'recover':
        if (this.pt >= REC[i]) {
          if (i + 1 >= LASHES) { this._go('break'); this.broken = true; this._snap(); }
          else { this.lash = i + 1; this._go('raise'); }
        }
        break;
      case 'break':
        if (this.pt >= BREAK_T) {
          this.active = false;
          this.worldScale = 1;
          this.onDone();
        }
        break;
    }
  }

  _go(phase) { this.phase = phase; this.pt = 0; }

  // --- the moment of contact ------------------------------------------------
  _impact() {
    const i = this.lash;
    const sx = this.mx, sy = this.my - 8;   // across the shoulders

    this.shake = SHAKE[i];
    this.eyeR = EYE_R[i];                   // the eyes go instantly, not eased
    this.eyeTarget = EYE_R[i];
    this.penFlash = 1;
    this.abbotFlash = 0.45;
    this.penLurch = 2.2 + i * 0.6;
    this.penSquash = 0.86;
    this.numeral = { n: i, t: 0 };

    // A one-frame white blowout, then a crimson wash that lingers — the white
    // sells the crack, the red sells what it did.
    this.flashes.push({ c: '255,255,255', a: 0.50 + i * 0.05, d: 8.5 });
    this.flashes.push({ c: '198,43,48', a: 0.13 + i * 0.032, d: 2.4 });
    this.rings.push({ x: sx, y: sy, r: 2, a: 0.9 });

    for (let k = 0; k < 8 + i * 3; k++) {
      const dir = k % 2 ? 1 : -1;
      const sp = 46 + Math.random() * 60 + i * 8;
      const ang = -0.15 - Math.random() * 0.7;   // flatter: it sprays sideways
      this.parts.push({
        x: sx + dir * (3 + Math.random() * 3),
        y: sy + Math.random() * 3,
        vx: Math.cos(ang) * sp * dir,
        vy: Math.sin(ang) * sp,
        t: 0, life: 0.45 + Math.random() * 0.45,
        r: Math.random() < 0.25 ? 1.4 : 0.9,
      });
    }
    for (let k = 0; k < 2 + i; k++) {
      this.stains.push({
        x: sx + (Math.random() - 0.5) * 16,
        y: this.my + 3 + Math.random() * 5,
        r: 0.9 + Math.random() * 1.6,
      });
    }
    this.onLash(i);
  }

  _snap() {
    // The fifth blow takes the switch with it. Two halves and a burst of
    // splinters — and no sixth lash is possible, because there is nothing
    // left to swing.
    const hx = this.ax + PIVOT_X, hy = this.ay + PIVOT_Y;
    for (let k = 0; k < 14; k++) {
      this.splinters.push({
        x: hx + Math.cos(HIT_A) * (6 + Math.random() * 12),
        y: hy + Math.sin(HIT_A) * (6 + Math.random() * 12),
        vx: (Math.random() - 0.5) * 70,
        vy: -20 - Math.random() * 50,
        t: 0, life: 0.7 + Math.random() * 0.5,
        rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 14,
      });
    }
    this.flashes.push({ c: '216,168,50', a: 0.22, d: 2.2 });
  }

  // --- continuous pose ------------------------------------------------------
  _pose(dt) {
    const i = this.lash;
    const k = Math.min(1, dt * 9);

    // penitent walks the last step in, then stays on the mark
    if (this.phase === 'approach') {
      const u = easeInOut(clamp01(this.pt / APPROACH));
      this.penX = this.fromX + (this.mx - this.fromX) * u;
      this.penY = this.fromY + (this.my - this.fromY) * u;
      this.kneel = u;
    } else {
      this.penX = this.mx; this.penY = this.my; this.kneel = 1;
    }

    switch (this.phase) {
      case 'approach':
        this.stickA = REST_A;
        this.abbotLean = 0;
        break;
      case 'raise': {
        // Up, with a held beat at the top: the pause before a blow is what
        // makes the blow land.
        const u = easeOut(clamp01(this.pt / (RAISE[i] * 0.72)));
        this.stickA = REST_A + (TOP_A - REST_A) * u;
        this.abbotLean = -0.05 * u;      // weight back
        this.ghosts.length = 0;
        break;
      }
      case 'strike': {
        const u = easeIn(clamp01(this.pt / STRIKE[i]));
        this.stickA = TOP_A + (HIT_A - TOP_A) * u;
        this.abbotLean = -0.05 + 0.11 * u;
        // motion blur: three copies strung back along the arc travelled
        this.ghosts.length = 0;
        for (let g = 1; g <= 3; g++) {
          const gu = easeIn(clamp01(u - g * 0.09));
          this.ghosts.push({ a: TOP_A + (HIT_A - TOP_A) * gu, alpha: 0.34 - g * 0.09 });
        }
        break;
      }
      case 'hit':
        this.stickA = HIT_A;
        this.abbotLean = 0.06;
        // The trail is left standing through the freeze but bleeds off, so the
        // hit-stop shows where the switch came from without leaving two solid
        // extra sticks hanging in the air.
        for (const g of this.ghosts) g.alpha *= 0.80;
        break;
      case 'recover': {
        const u = easeOut(clamp01(this.pt / REC[i]));
        this.stickA = HIT_A + (REST_A - HIT_A) * u;
        this.abbotLean = 0.06 * (1 - u);
        this.ghosts.length = 0;
        this.eyeTarget = 1.1 + i * 0.55;   // the shock never fully goes back down
        break;
      }
      case 'break':
        this.stickA = REST_A;
        this.abbotLean = 0;
        this.eyeTarget = 1.4;
        this.ghosts.length = 0;
        this.bloom = easeOut(clamp01((this.pt - 0.35) / 0.9));
        break;
    }

    this.eyeR += (this.eyeTarget - this.eyeR) * Math.min(1, dt * 7);
    this.penLurch += (0 - this.penLurch) * k;
    this.penSquash += (1 - this.penSquash) * k;
    this.penFlash = Math.max(0, this.penFlash - dt * 7);
    this.abbotFlash = Math.max(0, this.abbotFlash - dt * 5);
    this.shake = Math.max(0, this.shake - dt * (this.phase === 'hit' ? 0 : 14));
  }

  _particles(dt) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.a -= f.a * f.d * dt + 0.004;
      if (f.a <= 0.005) this.flashes.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += dt * 170; r.a -= dt * 5.2;
      if (r.a <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 165 * dt;
    }
    for (let i = this.splinters.length - 1; i >= 0; i--) {
      const s = this.splinters[i];
      s.t += dt;
      if (s.t >= s.life) { this.splinters.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 150 * dt; s.rot += s.spin * dt;
    }
    if (this.numeral) {
      this.numeral.t += dt;
      if (this.numeral.t > 1.0) this.numeral = null;
    }
    if (this.bloom > 0 && this.motes.length < 26 && Math.random() < dt * 40) {
      this.motes.push({
        x: this.mx + (Math.random() - 0.5) * 13,
        y: this.my + 2, t: 0, life: 1.1 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 5, seed: Math.random() * 6.3,
      });
    }
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      if (m.t >= m.life) { this.motes.splice(i, 1); continue; }
      m.y -= 15 * dt; m.x += m.vx * dt;
    }
  }

  // Camera offset. A hit-stop with a shaking camera is the whole trick: the
  // action freezes and the frame does not.
  shakeOffset() {
    if (this.shake <= 0.02) return { x: 0, y: 0 };
    const s = this.shake;
    return {
      x: Math.round(Math.sin(this.rt * 71) * s),
      y: Math.round(Math.cos(this.rt * 53) * s * 0.7),
    };
  }

  // --- drawing --------------------------------------------------------------

  // Blood that has already hit the floor. Drawn under everything, right after
  // the floor blit, so figures stand on it rather than in front of it.
  drawGround(ctx) {
    for (const s of this.stains) {
      ctx.fillStyle = 'rgba(74,13,22,0.55)';
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,26,34,0.45)';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - 0.2, s.r * 0.55, s.r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Called from the Abbot's station draw, in his local space (origin at the
  // station centre, his feet at y = +7). Wraps his sprite so his whole body
  // leans into the blow.
  drawAbbot(ctx, sheet, t, drawShadow) {
    ctx.save();
    ctx.translate(0, 7);
    ctx.rotate(this.abbotLean);
    ctx.translate(0, -7);
    drawShadow();
    const opts = { sheet, dir: 'down', moving: false, animPhase: t, x: 0, groundY: 7, targetHeight: 22.4 };
    drawCharacter(ctx, opts);
    if (this.abbotFlash > 0) {
      // Additive self-blend: the same sprite drawn over itself blows its own
      // colours toward white without needing a silhouette mask.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.abbotFlash;
      drawCharacter(ctx, opts);
      ctx.restore();
    }
    this._drawStick(ctx);
    ctx.restore();
  }

  _switch(ctx, a, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(PIVOT_X, PIVOT_Y);
    ctx.rotate(a);
    ctx.fillStyle = WOOD.o; ctx.fillRect(-2, -1.3, STICK_LEN + 2, 2.6);
    ctx.fillStyle = WOOD.b; ctx.fillRect(-1.5, -0.8, STICK_LEN + 1, 1.6);
    ctx.fillStyle = WOOD.l; ctx.fillRect(-1.5, -0.8, STICK_LEN * 0.72, 0.6);
    ctx.fillStyle = WOOD.h; ctx.fillRect(0, -0.8, 4, 0.6);
    ctx.fillStyle = IRON.o; ctx.fillRect(-2, -1.3, 3, 2.6);      // his grip
    ctx.restore();
  }

  _drawStick(ctx) {
    if (this.broken) {
      // two halves, dropped
      ctx.save();
      ctx.translate(PIVOT_X, PIVOT_Y + 14);
      ctx.fillStyle = WOOD.o; ctx.fillRect(-7, -0.8, 8, 1.8);
      ctx.fillStyle = WOOD.b; ctx.fillRect(-6.5, -0.4, 7, 1);
      ctx.rotate(0.5);
      ctx.fillStyle = WOOD.o; ctx.fillRect(1, 0.4, 9, 1.8);
      ctx.fillStyle = WOOD.b; ctx.fillRect(1.5, 0.8, 8, 1);
      ctx.restore();
      return;
    }
    for (const g of this.ghosts) if (g.alpha > 0) this._switch(ctx, g.a, g.alpha);
    this._switch(ctx, this.stickA, 1);
  }

  // The kneeling figure, in world space. Replaces the scene's normal player
  // draw for the duration.
  drawPenitent(ctx, sheet, t) {
    const x = Math.round(this.penX);
    const y = Math.round(this.penY) + this.penLurch;
    const h = 21 - 4.5 * this.kneel;          // down on the knees

    ctx.fillStyle = SHADOW;
    ctx.beginPath(); ctx.ellipse(x, this.penY + 5, 5, 2, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y + 6);
    ctx.scale(1 + (1 - this.penSquash) * 0.9, this.penSquash);
    ctx.translate(-x, -(y + 6));
    const opts = { sheet, dir: 'down', moving: false, animPhase: t, x, groundY: y + 6, targetHeight: h };
    drawCharacter(ctx, opts);
    if (this.penFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.penFlash * 0.85;
      drawCharacter(ctx, opts);
      ctx.restore();
    }
    ctx.restore();

    // 0.654 is measured, not guessed: the generator stamps one iris-coloured
    // mark per eye and those are the only pixels of that colour on the figure,
    // so sampling them gives the eye line exactly — 0.654 of the drawn height
    // above the ground line, half-spread 0.0875 of it. The bug eyes therefore
    // start life sitting exactly on top of the sprite's own eyes and swell out
    // from there, which is the whole gag; anchored anywhere else they read as
    // two balloons floating near a head.
    this._drawEyes(ctx, x, y + 6 - h * 0.654);
  }

  // The eyes. They start as ordinary dots and by the fifth blow they are out
  // past the edge of the head, pupils shrunk to pinpricks, veined red — the
  // one piece of pure cartoon in an otherwise straight-faced abbey, and the
  // reason the rite is funny as well as horrible.
  _drawEyes(ctx, cx, cy) {
    const r = this.eyeR;
    if (r < 1) return;
    // 1.9 is the sprite's own half-spread at the rite's draw height (0.0875 of
    // 21px), so the smallest eye lands dead on the real one and each blow
    // pushes the pair further apart. The lift is small on purpose — enough that
    // big eyes bulge up out of the face, not so much that they leave it.
    const spread = 1.9 + r * 0.46;
    const lift = r * 0.14;
    for (const side of [-1, 1]) {
      const ex = cx + side * spread, ey = cy - lift;
      ctx.fillStyle = BLOOD.o;
      ctx.beginPath(); ctx.arc(ex, ey, r + 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BONE.h;
      ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
      if (r > 2.6) {
        ctx.strokeStyle = 'rgba(198,43,48,0.75)';
        ctx.lineWidth = 0.5;
        for (let v = 0; v < 3; v++) {
          const a = 2.3 + v * 1.5 + side * 0.4;
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(a) * r * 0.35, ey + Math.sin(a) * r * 0.35);
          ctx.lineTo(ex + Math.cos(a) * r * 0.92, ey + Math.sin(a) * r * 0.92);
          ctx.stroke();
        }
      }
      // pupil shrinks as the eye swells — terror, not attention
      const pr = Math.max(0.55, r * 0.30 - (r - 2.4) * 0.10);
      ctx.fillStyle = VOID;
      ctx.beginPath(); ctx.arc(ex + side * 0.15, ey + r * 0.16, pr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = GOLD.h;
      ctx.fillRect(ex - r * 0.42, ey - r * 0.5, Math.max(0.6, r * 0.24), Math.max(0.6, r * 0.24));
    }
    if (r > 3) {
      const mw = (r - 2.6) * 1.5, mh = (r - 2.6) * 1.15;
      ctx.fillStyle = BLOOD.o;
      ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.95 + 1.4, mw, mh, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Blood in the air, splinters, the impact ring and the gold at the end.
  // Drawn after the depth sort so nothing occludes it.
  drawWorldFx(ctx) {
    for (const r of this.rings) {
      ctx.strokeStyle = `rgba(255,243,184,${Math.max(0, r.a)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of this.parts) {
      const u = p.t / p.life;
      ctx.fillStyle = u < 0.35 ? BLOOD.l : u < 0.7 ? BLOOD.b : BLOOD.d;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    for (const s of this.splinters) {
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.globalAlpha = 1 - s.t / s.life;
      ctx.fillStyle = WOOD.b; ctx.fillRect(-1.6, -0.4, 3.2, 0.8);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (this.bloom > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(this.mx, this.my - 6, 1, this.mx, this.my - 6, 30);
      g.addColorStop(0, `rgba(242,210,100,${0.30 * this.bloom})`);
      g.addColorStop(1, 'rgba(242,210,100,0)');
      ctx.fillStyle = g;
      ctx.fillRect(this.mx - 32, this.my - 38, 64, 64);
      ctx.restore();
      for (const m of this.motes) {
        const u = m.t / m.life;
        ctx.fillStyle = `rgba(255,243,184,${(1 - u) * 0.9})`;
        ctx.fillRect(m.x + Math.sin(this.rt * 3 + m.seed) * 1.5, m.y, 1, 1);
      }
    }
  }

  // Screen space: the spotlight on the pair, the flashes, the letterbox and
  // the count. Drawn last, over the scene's own vignette.
  drawScreenFx(ctx, W, H) {
    if (this.dim > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2 - 6, 22, W / 2, H / 2 - 6, H * 0.62);
      g.addColorStop(0, 'rgba(6,4,17,0)');
      g.addColorStop(1, `rgba(6,4,17,${this.dim})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    for (const f of this.flashes) {
      ctx.fillStyle = `rgba(${f.c},${Math.max(0, f.a)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.bars > 0.5) {
      ctx.fillStyle = '#05040c';
      ctx.fillRect(0, 0, W, this.bars);
      ctx.fillRect(0, H - this.bars, W, this.bars);
      ctx.fillStyle = 'rgba(93,59,12,0.55)';
      ctx.fillRect(0, this.bars - 1, W, 1);
      ctx.fillRect(0, H - this.bars, W, 1);
    }
    if (this.numeral) {
      const n = this.numeral;
      // punches in oversized and settles — the count is the drum
      const s = 1 + 1.2 * (1 - easeOut(clamp01(n.t / 0.3)));
      const a = 1 - clamp01((n.t - 0.35) / 0.65);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const ny = H * 0.245;   // clear of the top bar and clear of both figures
      ctx.font = `bold ${Math.round(20 * s)}px "Courier New", monospace`;
      ctx.fillStyle = GOLD.o;
      for (const [dx, dy] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
        ctx.fillText(NUMERALS[n.n], W / 2 + dx, ny + dy);
      }
      ctx.fillStyle = GOLD.l;
      ctx.fillText(NUMERALS[n.n], W / 2, ny);
      ctx.fillStyle = GOLD.h;
      ctx.globalAlpha = a * 0.5;
      ctx.fillText(NUMERALS[n.n], W / 2 - 0.6, ny - 0.6);
      ctx.restore();
    }
  }
}
