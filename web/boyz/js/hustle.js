// BOYZ N THE HOOD — side hustles.
//
// The campaign is ten missions long; the free-play loop has to carry the hours
// in between. Courier runs are that loop: a crate is always waiting somewhere
// on the block, you drive it to a drop before the clock runs out, and the run
// pays cash on a streak multiplier plus a server-priced `delivery` point event.
//
// The pressure comes from the route, not from an artificial difficulty knob.
// Drops are picked in *hostile* turf when it's available, so the interesting
// runs are the ones that make you drive through people who shoot at you, and
// every second you spend shedding heat is a second off the clock.
//
// Cash is client-side and cosmetic. Points are not: the client only ever posts
// the event, and the server prices it (60) and caps it (20/UTC-day). Nothing in
// this file can inflate a reward.

import { LANDMARKS, GARAGES, SAFEHOUSES, nearestRoad, isOwned, districtAtCell } from './city.js';
import { toScreen } from './iso.js';
import { WOOD, GOLD, SHADOW, withAlpha, pointLight } from './palette.js';

// How far a job is allowed to be from you when it's offered, and how far the
// drop is allowed to be from the pickup. Both in world cells.
const OFFER_MIN = 22, OFFER_MAX = 62;
const DROP_MIN = 30, DROP_MAX = 78;

// Cars top out at 16 cells/sec, but a grid route is longer than the straight
// line and you lose time to corners and traffic, so the clock budgets a little
// over half of top speed as the achievable average.
const DRIVE_SPEED = 8;
const GRACE = 14;           // plus this, so a short run isn't a coin flip
const UNATTENDED = 7;       // seconds out of the car before the cargo walks
const COOLDOWN = 9;         // seconds between jobs

// Every dispatch point in the city, pulled from the three site lists. Garages
// and safehouses make good depots; landmarks make good drops.
const SITES = [
  ...LANDMARKS.map((l) => ({ ...l, kind: 'landmark' })),
  ...GARAGES.map((g) => ({ ...g, kind: 'garage' })),
  ...SAFEHOUSES.map((s) => ({ ...s, kind: 'safehouse' })),
];

const CARGO = [
  'a crate of burner phones', 'six kilos of "flour"', 'a bag that ticks',
  'Vlad\'s missing paperwork', 'a cooler nobody opened', 'forty stolen catalytics',
  'a duffel of unmarked bills', 'somebody\'s cousin\'s TV', 'two crates of fireworks',
];

function pick(a) { return a[(Math.random() * a.length) | 0]; }

function siteNear(x, y, min, max, exclude) {
  const pool = SITES.filter((s) => {
    if (exclude && s.id === exclude.id) return false;
    const d = Math.hypot(s.x - x, s.y - y);
    return d >= min && d <= max;
  });
  if (!pool.length) return null;
  // Prefer hostile turf — the runs worth doing are the ones through gunfire.
  const risky = pool.filter((s) => s.district && !isOwned(s.district));
  return pick(risky.length ? risky : pool);
}

export class Hustle {
  constructor(world) {
    this.world = world;
    this.job = null;         // { stage, site, x, y, cargo, ... }
    this.cooldown = 3;
    this.streak = 0;
    this.done = 0;
    this.offFootT = 0;
  }

  // Serialised into the save alongside cash and turf, so a streak survives a
  // reload the same way progress does.
  snapshot() { return { streak: this.streak, done: this.done }; }
  restore(s) { if (s) { this.streak = s.streak | 0; this.done = s.done | 0; } }

  get carrying() { return this.job?.stage === 'carry'; }

  offer() {
    const w = this.world;
    const p = w.player;
    const from = siteNear(p.x, p.y, OFFER_MIN, OFFER_MAX)
      || siteNear(p.x, p.y, 8, 110);
    if (!from) return;
    const road = nearestRoad(from.x, from.y, 6);
    this.job = {
      stage: 'offer', site: from, x: road.x, y: road.y,
      cargo: pick(CARGO), bob: Math.random() * 6,
    };
    w.toast(`COURIER JOB — ${from.name}`);
  }

  load() {
    const w = this.world;
    const from = this.job.site;
    const to = siteNear(from.x, from.y, DROP_MIN, DROP_MAX, from)
      || siteNear(from.x, from.y, 10, 120, from);
    if (!to) { this.abandon('No drop available'); return; }
    const road = nearestRoad(to.x, to.y, 6);
    const dist = Math.hypot(road.x - this.job.x, road.y - this.job.y);
    const d = districtAtCell(road.x, road.y);
    const hot = d && !isOwned(d.id);
    this.job = {
      stage: 'carry', site: to, x: road.x, y: road.y,
      cargo: this.job.cargo, bob: 0,
      dist, limit: dist / DRIVE_SPEED + GRACE,
      timer: dist / DRIVE_SPEED + GRACE,
      base: Math.round(120 + dist * 9 + (hot ? 180 : 0)),
      hot,
    };
    this.offFootT = 0;
    w.setMarker(road.x, road.y, 'DROP');
    w.toast(`LOADED — ${this.job.cargo}`);
    w.briefing('landwolf', `${this.job.cargo.replace(/^./, (c) => c.toUpperCase())}. `
      + `${to.name}, ${Math.round(dist)} blocks${hot ? ', and it is not our turf' : ''}. Clock's running.`);
    w.sfx('pickup');
  }

  deliver() {
    const w = this.job, world = this.world;
    this.streak = Math.min(8, this.streak + 1);
    this.done++;
    const mult = 1 + this.streak * 0.25;
    const cash = Math.round(w.base * mult);
    world.cash += cash;
    world.toast(`DELIVERED — $${cash}${this.streak > 1 ? ` (x${mult.toFixed(2)} streak)` : ''}`);
    world.sfx('good');
    // The server prices and caps this; we only say that it happened.
    world.onDelivery(w.site.id);
    this.job = null;
    this.cooldown = COOLDOWN;
    world.clearMarker();
  }

  abandon(why) {
    if (this.streak) this.world.toast(`STREAK LOST — ${why}`);
    else this.world.toast(why);
    this.streak = 0;
    this.job = null;
    this.cooldown = COOLDOWN;
    this.world.clearMarker();
    this.world.sfx('hit');
  }

  update(dt) {
    const w = this.world, p = w.player;
    // A campaign mission owns the marker and the objective HUD. Courier work
    // waits its turn rather than fighting over both.
    if (w.campaignActive) {
      if (this.carrying) this.abandon('Job dropped for the crew');
      else this.job = null;
      this.cooldown = Math.max(this.cooldown, 2);
      return;
    }
    if (!this.job) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.offer();
      return;
    }

    if (this.job.stage === 'offer') {
      // Drive over it. On foot you can see it but not lift it — this is a
      // driving hustle, and making that legible is worth the small friction.
      const d = Math.hypot(p.x - this.job.x, p.y - this.job.y);
      if (d < 2.6 && p.inCar) this.load();
      else if (d < 2.0 && !p.inCar) w.hint('NEED A CAR TO HAUL THIS');
      return;
    }

    // carrying
    const j = this.job;
    j.timer -= dt;
    if (j.timer <= 0) { this.abandon('Cargo went cold'); return; }

    if (p.inCar) {
      this.offFootT = 0;
      j.car = p.inCar;
    } else {
      // The cargo is in the car, so walking away from it is a countdown.
      this.offFootT += dt;
      const left = UNATTENDED - this.offFootT;
      if (left <= 0) { this.abandon('Cargo walked off'); return; }
      if (left < 4) w.hint(`GET BACK IN — ${left.toFixed(0)}`);
    }
    if (j.car && j.car.dead) { this.abandon('Cargo burned with the car'); return; }

    if (Math.hypot(p.x - j.x, p.y - j.y) < 3.0 && p.inCar) this.deliver();
    else w.setMarker(j.x, j.y, 'DROP');
  }

  // The HUD line the game shows when no mission objective is up.
  label() {
    if (!this.job) return null;
    if (this.job.stage === 'offer') return `COURIER — ${this.job.site.name}`;
    return `DELIVER — ${this.job.site.name}`;
  }

  timer() { return this.job?.stage === 'carry' ? Math.max(0, this.job.timer) : 0; }

  // --- the crate ----------------------------------------------------------
  // Built to the same five rules as everything else: outlined in a dark version
  // of its own wood hue rather than black, a five-step ramp lit from the upper
  // left with one genuinely lit face, a hard contact shadow on the ground under
  // it, and exactly one saturated accent — the gold banding — against the
  // desaturated asphalt it sits on.
  draw(ctx, t) {
    if (!this.job || this.job.stage !== 'offer') return;
    const j = this.job;
    const s = toScreen(j.x, j.y, 0);
    const bob = Math.sin(t * 2.4 + j.bob) * 2;
    const y = s.y + bob;
    const w = 14, h = 12, lift = 4;

    // RULE 4 — hard contact shadow, tight to the crate and offset south-east
    // away from the key light. It sits on the ground, not on the bob.
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(s.x + 1.5, s.y + 1, w * 0.82, h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    pointLight(ctx, s.x, y - 6, 20, GOLD.b, 0.24);

    // body: two visible faces plus a lit top, the same construction drawBox uses
    const top = y - lift - h;
    // left face (away from the light) takes the shadow step
    ctx.fillStyle = WOOD.d;
    ctx.beginPath();
    ctx.moveTo(s.x - w, y - lift - 4);
    ctx.lineTo(s.x, y - lift);
    ctx.lineTo(s.x, top + 4);
    ctx.lineTo(s.x - w, top);
    ctx.closePath(); ctx.fill();
    // right face catches the key light
    ctx.fillStyle = WOOD.b;
    ctx.beginPath();
    ctx.moveTo(s.x, y - lift);
    ctx.lineTo(s.x + w, y - lift - 4);
    ctx.lineTo(s.x + w, top);
    ctx.lineTo(s.x, top + 4);
    ctx.closePath(); ctx.fill();
    // lid — the one surface the light actually lands on
    ctx.fillStyle = WOOD.l;
    ctx.beginPath();
    ctx.moveTo(s.x - w, top);
    ctx.lineTo(s.x, top - 4);
    ctx.lineTo(s.x + w, top);
    ctx.lineTo(s.x, top + 4);
    ctx.closePath(); ctx.fill();
    // highlight along the upper-left lid edge
    ctx.strokeStyle = WOOD.h; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - w + 1, top - 0.5);
    ctx.lineTo(s.x, top - 4.5);
    ctx.stroke();

    // RULE 1 — the outline is dark WOOD, never black
    ctx.strokeStyle = WOOD.o; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - w, top); ctx.lineTo(s.x, top - 4); ctx.lineTo(s.x + w, top);
    ctx.lineTo(s.x + w, y - lift - 4); ctx.lineTo(s.x, y - lift);
    ctx.lineTo(s.x - w, y - lift - 4); ctx.closePath();
    ctx.moveTo(s.x, top + 4); ctx.lineTo(s.x, y - lift);
    ctx.stroke();

    // RULE 5 — the single saturated accent: gold strapping, pulsing so the
    // crate reads as interactive from across the block.
    const pulse = 0.55 + Math.sin(t * 3) * 0.45;
    ctx.strokeStyle = withAlpha(GOLD.l, 0.5 + pulse * 0.5); ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s.x - w * 0.45, top + 2 - 0.4 * w * 0.45);
    ctx.lineTo(s.x - w * 0.45, y - lift - 2 - 0.4 * w * 0.45);
    ctx.moveTo(s.x + w * 0.45, top + 2 - 0.4 * w * 0.45);
    ctx.lineTo(s.x + w * 0.45, y - lift - 2 - 0.4 * w * 0.45);
    ctx.stroke();

    // beacon column, matched to the mission marker's language
    const hgt = 30 + Math.sin(t * 3) * 4;
    const grd = ctx.createLinearGradient(0, top - hgt, 0, top);
    grd.addColorStop(0, withAlpha(GOLD.h, 0));
    grd.addColorStop(1, withAlpha(GOLD.h, 0.45));
    ctx.fillStyle = grd;
    ctx.fillRect(s.x - 2, top - hgt, 4, hgt);
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD.h;
    ctx.fillText('CARGO', s.x, top - hgt - 4);
    ctx.textAlign = 'left';
  }
}

export { SITES };
