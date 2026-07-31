// Entities: the player, peds, Cabal soldiers, cops, cars, bullets, pickups.
//
// Everything lives in flat world space (x, y in grid units) and is projected at
// draw time. Movement is arcade, not simulated: cars have grip and a turn rate
// that scales with speed, people have a flat top speed. It should feel like a
// 16-bit GTA, which means responsive over realistic.

import {
  solidAt, carSolidAt, nearestRoad, districtAtCell, surfaceAt as surfaceOf, CW, CH,
  signalOpen, stopLineDist, SURF,
} from './city.js';
import { BOYZ, CABAL, COP, ramp, NEON } from './palette.js';
import { dirFromVec } from './sprites.js';

export const PED_SPEED = 3.2;
export const RUN_SPEED = 5.4;

let nextId = 1;
export const uid = () => nextId++;

// --- car paints -----------------------------------------------------------
// Deliberately dark and desaturated: the neon and the lights carry the colour.
export const PAINTS = [
  ramp('#0a0a0c', '#16171c', '#22242c', '#31343f', '#454956'),  // black
  ramp('#0c0709', '#26121a', '#3d1d29', '#54293a', '#6f3a4f'),  // maroon
  ramp('#06090c', '#0f1a24', '#182a3a', '#233c53', '#33546f'),  // navy
  ramp('#0a0c07', '#181d10', '#262e1a', '#374126', '#4c5936'),  // olive
  ramp('#0c0a06', '#221b0e', '#372c17', '#4d3e22', '#665332'),  // tan
  ramp('#0b0b0d', '#1e1e22', '#303038', '#45454f', '#5e5e6b'),  // grey
];
export const COP_PAINT = ramp('#05070c', '#0d1626', '#16233c', '#203457', '#2f4a77');

// --- vehicle classes ------------------------------------------------------
// One handling model for every car meant a stolen van drove exactly like a
// stolen sports car, which quietly removed the whole reason to steal a
// different one. Each class trades along a different axis: the sports car is
// fast and grippy but folds on the first serious impact, the van is slow and
// clumsy but shrugs off a pursuit, muscle is quick in a straight line and
// terrible at corners.
//
// len/wid/ht are HALF-extents in world cells (the renderer draws corners at
// ±len, ±wid), so wid must stay under 0.5 — lane centres sit 1.0 apart and a
// wider car permanently overlaps its oncoming neighbour.
export const VEHICLES = {
  sedan: {
    name: 'Sedan', len: 1.22, wid: 0.45, ht: 0.55,
    topSpeed: 15, accel: 24, brake: 28, drag: 1.6, handling: 2.6, mass: 1.0, hp: 100,
    cab: [-0.45, 0.5], glassW: 0.72,
  },
  muscle: {
    name: 'Muscle', len: 1.4, wid: 0.46, ht: 0.5,
    topSpeed: 20, accel: 36, brake: 24, drag: 1.4, handling: 2.0, mass: 1.25, hp: 120,
    cab: [-0.55, 0.18], glassW: 0.7, stripe: true,
  },
  sports: {
    name: 'Sports', len: 1.18, wid: 0.42, ht: 0.38,
    topSpeed: 23, accel: 40, brake: 36, drag: 1.5, handling: 3.3, mass: 0.8, hp: 78,
    cab: [-0.6, 0.1], glassW: 0.74,
  },
  van: {
    name: 'Van', len: 1.56, wid: 0.46, ht: 0.98,
    topSpeed: 12, accel: 16, brake: 22, drag: 1.9, handling: 1.9, mass: 1.9, hp: 185,
    cab: [0.34, 0.86], glassW: 0.8,
  },
  pickup: {
    name: 'Pickup', len: 1.46, wid: 0.45, ht: 0.72,
    topSpeed: 14, accel: 21, brake: 25, drag: 1.7, handling: 2.2, mass: 1.5, hp: 145,
    cab: [-0.05, 0.6], glassW: 0.76, bed: [-0.92, -0.12],
  },
  cruiser: {
    name: 'Cruiser', len: 1.3, wid: 0.45, ht: 0.55,
    topSpeed: 19, accel: 31, brake: 33, drag: 1.5, handling: 3.0, mass: 1.15, hp: 145,
    cab: [-0.45, 0.45], glassW: 0.72,
  },
};

// Weighted draw for street traffic — sedans are the background, the fast and
// heavy classes are the ones worth going out of your way for.
const TRAFFIC_MIX = [
  ['sedan', 42], ['pickup', 16], ['van', 14], ['muscle', 16], ['sports', 12],
];
export function rollVehicleClass() {
  let n = Math.random() * TRAFFIC_MIX.reduce((a, r) => a + r[1], 0);
  for (const [id, w] of TRAFFIC_MIX) { n -= w; if (n <= 0) return id; }
  return 'sedan';
}

export function makeCar(x, y, ang = 0, opts = {}) {
  const cls = VEHICLES[opts.cls] || VEHICLES.sedan;
  const hp = opts.hp || cls.hp;
  return {
    id: uid(), kind: 'car', x, y, ang,
    vx: 0, vy: 0, speed: 0,
    paint: opts.paint || PAINTS[(Math.random() * PAINTS.length) | 0],
    hp, maxHp: hp,
    driver: null,               // entity currently driving
    ai: opts.ai || null,        // 'traffic' | 'chase' | null
    siren: !!opts.siren,
    cls: opts.cls && VEHICLES[opts.cls] ? opts.cls : 'sedan',
    className: cls.name,
    len: opts.len || cls.len, wid: opts.wid || cls.wid, ht: cls.ht,
    cab: cls.cab, glassW: cls.glassW, stripe: !!cls.stripe, bed: cls.bed || null,
    topSpeed: opts.topSpeed || cls.topSpeed,
    accel: cls.accel, brake: cls.brake, drag: cls.drag,
    handling: cls.handling, mass: cls.mass,
    dead: false, burn: 0, exploded: false, braking: false,
  };
}

export function makePerson(x, y, look, opts = {}) {
  return {
    id: uid(), kind: 'person', x, y,
    vx: 0, vy: 0, dir: 's', walk: 0,
    look, hp: opts.hp || 100, maxHp: opts.hp || 100,
    faction: opts.faction || 'ped',      // 'player' | 'crew' | 'ped' | 'cabal' | 'cop'
    weapon: opts.weapon || null,          // null | 'bat' | 'gun'
    fireCd: 0, flash: 0,
    ai: opts.ai || null,
    target: null,
    dead: false, deadT: 0,
    inCar: null,
    speed: opts.speed || PED_SPEED,
    wander: Math.random() * Math.PI * 2,
    name: opts.name || null,
  };
}

export function makeBullet(x, y, dx, dy, faction, dmg = 18) {
  const l = Math.hypot(dx, dy) || 1;
  return { id: uid(), kind: 'bullet', x, y, vx: dx / l * 46, vy: dy / l * 46, life: 0.7, faction, dmg };
}

export function makePickup(x, y, type, label) {
  return { id: uid(), kind: 'pickup', x, y, type, label, taken: false, bob: Math.random() * 6 };
}

// ---------------------------------------------------------------------------
// Movement with wall sliding: try each axis independently so a figure grazing a
// building slides along it instead of sticking. Without this, a top-down game
// feels like it's fighting you at every corner.
function moveWithSlide(e, nx, ny, solid) {
  if (!solid(nx, e.y)) e.x = nx;
  if (!solid(e.x, ny)) e.y = ny;
  e.x = Math.max(1, Math.min(CW - 2, e.x));
  e.y = Math.max(1, Math.min(CH - 2, e.y));
}

export function stepPerson(e, dt, dx, dy, run = false) {
  if (e.dead) { e.deadT += dt; return; }
  const sp = (run ? RUN_SPEED : e.speed);
  const l = Math.hypot(dx, dy);
  if (l > 0.01) {
    const ux = dx / l, uy = dy / l;
    moveWithSlide(e, e.x + ux * sp * dt, e.y + uy * sp * dt, solidAt);
    e.dir = dirFromVec(ux, uy);
    e.walk += dt * (run ? 1.5 : 1);
    e.moving = true;
  } else {
    e.moving = false;
  }
  if (e.fireCd > 0) e.fireCd -= dt;
  if (e.flash > 0) e.flash -= dt;
}

// Car-vs-car collision. Circle-based and O(n^2), which is fine at ~30 cars and
// far more predictable than swept boxes at these speeds. Momentum transfers so
// ramming a stationary car shunts it out of the way instead of passing through
// it — the single thing that most made traffic feel like scenery.
export function resolveCarCollisions(cars, onImpact) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (a.exploded) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (b.exploded) continue;
      // Approximate each car with two circles along its length, sized off its
      // WIDTH. A single circle sized off length is far too fat for a lane and
      // makes oncoming traffic permanently collide.
      const ra = a.wid * 1.05, rb = b.wid * 1.05;
      const aF = a.len * 0.45, bF = b.len * 0.45;
      let best = null, bestPen = 0;
      for (const sa2 of [-aF, aF]) {
        for (const sb2 of [-bF, bF]) {
          const ax2 = a.x + Math.cos(a.ang) * sa2, ay2 = a.y + Math.sin(a.ang) * sa2;
          const bx2 = b.x + Math.cos(b.ang) * sb2, by2 = b.y + Math.sin(b.ang) * sb2;
          const ddx = bx2 - ax2, ddy = by2 - ay2;
          const dd = Math.hypot(ddx, ddy);
          const pen = (ra + rb) - dd;
          if (dd > 0.0001 && pen > bestPen) { bestPen = pen; best = [ddx / dd, ddy / dd]; }
        }
      }
      if (!best) continue;
      let [nx, ny] = best;
      // Once two bodies overlap DEEPLY, the deepest circle pair can be one that
      // has already passed through the other — a nose sitting behind a tail —
      // and its normal points backwards. Resolving along it drives the cars
      // further into each other instead of apart, and they swap places. Guard
      // by flipping any normal that opposes the centre-to-centre direction,
      // which is always a valid separation axis.
      const cx = b.x - a.x, cy = b.y - a.y;
      if (nx * cx + ny * cy < 0) { nx = -nx; ny = -ny; }
      // Separate by mass share: a van shunts a sports car most of the way out
      // of the contact and barely moves itself, which is the whole point of
      // having classes.
      const ma = a.mass || 1, mb = b.mass || 1, mt = ma + mb;
      a.x -= nx * bestPen * (mb / mt); a.y -= ny * bestPen * (mb / mt);
      b.x += nx * bestPen * (ma / mt); b.y += ny * bestPen * (ma / mt);

      // closing speed along the contact normal decides the damage
      const av = a.speed, bv = b.speed;
      const aVx = Math.cos(a.ang) * av, aVy = Math.sin(a.ang) * av;
      const bVx = Math.cos(b.ang) * bv, bVy = Math.sin(b.ang) * bv;
      const rel = (aVx - bVx) * nx + (aVy - bVy) * ny;
      if (rel <= 0) continue;

      // The lighter car loses more of its speed and takes more of the damage.
      a.speed -= rel * 1.1 * (mb / mt);
      b.speed += rel * 1.1 * (ma / mt);
      const dmg = Math.max(0, rel - 4) * 2.4;
      if (dmg > 0) {
        a.hp -= dmg * 2 * (mb / mt); b.hp -= dmg * 2 * (ma / mt);
        onImpact?.(a, b, (a.x + b.x) / 2, (a.y + b.y) / 2, rel);
      }
    }
  }
}

// Damage states: a wrecked car smokes, then catches, then goes up. The delay is
// the point — it gives you a beat to get clear, and turns a wreck into a hazard
// rather than an instant kill.
export function stepWreck(car, dt, onExplode) {
  if (!car.dead || car.exploded) return;
  car.burn += dt;
  if (car.burn > 2.6) {
    car.exploded = true;
    onExplode?.(car);
  }
}

// Arcade car handling. Steering authority falls off at very low speed (so you
// can't pivot on the spot) and grip bleeds sideways velocity, which is what
// gives it the loose, slidey feel of the era.
export function stepCar(car, dt, throttle, steer) {
  if (car.dead) { car.burn += dt; return; }
  car.braking = throttle < 0 && car.speed > 0.5;
  const accel = car.accel || 26, brake = car.brake || 30, drag = car.drag || 1.6;
  if (throttle > 0) car.speed += accel * throttle * dt;
  else if (throttle < 0) car.speed += brake * throttle * dt;
  car.speed -= car.speed * drag * dt;
  car.speed = Math.max(-car.topSpeed * 0.4, Math.min(car.topSpeed, car.speed));

  // Steering authority falls off with speed as well as up from a standstill:
  // a van at full tilt understeers, which is what makes the heavy classes feel
  // heavy rather than just slow.
  const authority = Math.min(1, Math.abs(car.speed) / 4)
    * (1 - Math.min(0.45, Math.abs(car.speed) / car.topSpeed * 0.45));
  car.ang += steer * (car.handling || 2.6) * dt * authority * Math.sign(car.speed || 1);

  const nx = car.x + Math.cos(car.ang) * car.speed * dt;
  const ny = car.y + Math.sin(car.ang) * car.speed * dt;
  const hitX = carSolidAt(nx, car.y), hitY = carSolidAt(car.x, ny);
  if (hitX || hitY) {
    // scrape: lose most of the speed, take a little damage
    const impact = Math.abs(car.speed);
    if (impact > 6) car.hp -= (impact - 6) * 1.2;
    car.speed *= -0.15;
    if (car.hp <= 0 && !car.dead) { car.dead = true; car.speed = 0; }
  }
  if (!hitX) car.x = nx;
  if (!hitY) car.y = ny;
  car.x = Math.max(1, Math.min(CW - 2, car.x));
  car.y = Math.max(1, Math.min(CH - 2, car.y));
}

// --- AI -------------------------------------------------------------------
// Traffic drives in LANES. Each car commits to an axis and a direction, holds
// the correct side of the road (right-hand drive), and only reconsiders at a
// junction. The previous version drove straight until something blocked it,
// which read as bumper cars — cars drifting across both lanes and pinballing
// off buildings. Lane discipline is most of what makes a city look alive.
const PITCH = 8, RW = 2;

// Centre of the correct-side lane for a car travelling `dir` along `axis`.
function laneCentre(coord, dir) {
  const band = Math.floor(coord / PITCH) * PITCH;
  // two lanes inside the road band; right-hand side depends on travel direction
  return band + (dir > 0 ? RW - 0.5 : 0.5);
}
function onRoadBand(coord) { return (coord % PITCH) < RW; }

export function initTraffic(car) {
  // snap onto whichever road band it spawned in
  if (onRoadBand(car.x) && !onRoadBand(car.y)) car.axis = 'y';
  else if (onRoadBand(car.y) && !onRoadBand(car.x)) car.axis = 'x';
  else car.axis = Math.random() < 0.5 ? 'x' : 'y';
  car.tdir = Math.random() < 0.5 ? 1 : -1;
  car.junctionCd = 0;
  return car;
}

// Nose-in recovery. A car facing a wall used to flip to the other axis and
// pick a direction at random, which mid-block points it at the building on the
// far side just as often — so it reverses, re-noses, flips again, and sits
// there rocking forever. That single behaviour accounted for most of the
// stationary traffic in the city.
//
// Look instead: probe all four cardinal directions, take the one with the most
// clear road ahead, and break ties in favour of carrying straight on.
function reroute(car) {
  let bestClear = 0, best = null;
  for (const [ax, dir] of [['x', 1], ['x', -1], ['y', 1], ['y', -1]]) {
    const dx = ax === 'x' ? dir : 0, dy = ax === 'y' ? dir : 0;
    let clear = 0;
    for (let s = 1; s <= 6; s++) {
      if (carSolidAt(car.x + dx * s, car.y + dy * s)) break;
      clear = s;
    }
    const keep = ax === car.axis && dir === car.tdir ? 0.5 : 0;
    if (clear >= 2 && clear + keep > bestClear) { bestClear = clear + keep; best = [ax, dir]; }
  }
  if (!best) return false;
  car.axis = best[0]; car.tdir = best[1];
  return true;
}

export function stepTrafficCar(car, dt, cars, t = 0) {
  if (car.axis == null) initTraffic(car);

  let along = car.axis === 'x' ? car.x : car.y;
  let cross = car.axis === 'x' ? car.y : car.x;

  // INVARIANT: the cross coordinate must sit inside a road band, because that
  // band IS the carriageway we're driving down. If a junction turn or a shunt
  // left the axis pointing along the wrong one, laneCentre() starts aiming at a
  // lane on a different street entirely and the car thrashes in place forever —
  // it never recovers, because the only place the axis was reconsidered was at
  // a junction it can no longer reach. Re-derive it every frame instead.
  if (!onRoadBand(cross)) {
    if (onRoadBand(along)) {
      car.axis = car.axis === 'x' ? 'y' : 'x';
      along = car.axis === 'x' ? car.x : car.y;
      cross = car.axis === 'x' ? car.y : car.x;
    } else {
      // knocked clean off the road — head back to the nearest one
      const road = nearestRoad(car.x, car.y);
      const bx = road.x - car.x, by = road.y - car.y;
      let d2 = Math.atan2(by, bx) - car.ang;
      while (d2 > Math.PI) d2 -= Math.PI * 2;
      while (d2 < -Math.PI) d2 += Math.PI * 2;
      stepCar(car, dt, 0.5, Math.max(-1, Math.min(1, d2 * 2)));
      return;
    }
  }

  // at a junction, sometimes commit to a turn
  car.junctionCd -= dt;
  const atJunction = onRoadBand(along) && onRoadBand(cross);
  if (atJunction && car.junctionCd <= 0) {
    car.junctionCd = 2.2;
    if (Math.random() < 0.42) {
      car.axis = car.axis === 'x' ? 'y' : 'x';
      car.tdir = Math.random() < 0.5 ? 1 : -1;
    }
  }

  // Steer toward a desired VELOCITY VECTOR — forward along the lane plus a
  // lateral nudge back to the lane centre — rather than juggling angle signs
  // per axis. The sign-juggling version oscillated and cars ended up crawling.
  const want = laneCentre(cross, car.tdir);
  const off = cross - want;
  const lat = Math.max(-1, Math.min(1, -off * 0.7));
  const dx = car.axis === 'x' ? car.tdir : lat;
  const dy = car.axis === 'x' ? lat : car.tdir;
  let diff = Math.atan2(dy, dx) - car.ang;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, diff * 2.2));

  // Brake for whatever is directly ahead, but only if it is genuinely in front
  // and close — a fat radius made every car brake for its neighbours and the
  // whole grid ground to a halt. Both windows are sized off the two cars
  // involved rather than fixed, so a long van doesn't nose into the car ahead
  // and, more importantly, the side window stays UNDER the 1.0 lane spacing so
  // nobody brakes for oncoming traffic.
  let throttle = 0.9;
  if (cars) {
    const fx = Math.cos(car.ang), fy = Math.sin(car.ang);
    for (const o of cars) {
      if (o === car || o.exploded) continue;
      const rx = o.x - car.x, ry = o.y - car.y;
      const ahead = rx * fx + ry * fy;
      if (ahead < car.len * 0.6 || ahead > car.len + o.len + 1.4) continue;
      const side = Math.abs(rx * -fy + ry * fx);
      if (side < (car.wid + o.wid) * 0.98) { throttle = -0.3; car.queued = true; break; }
    }
  }

  // Traffic signals. A car stops at the line when its axis has the red, but
  // never once it is already inside the box — stopping there deadlocks the
  // junction against the cross traffic that just got the green. Same reason it
  // won't enter on a green if the queue beyond the junction is already backed
  // up to the line: blocking the box is how a grid gridlocks.
  car.waiting = false;
  const gap = stopLineDist(along, car.tdir);
  if (gap >= 0) {
    const bandAlong = Math.floor(along / PITCH);
    const jAlong = car.tdir > 0 ? bandAlong + 1 : bandAlong;
    const jCross = Math.floor(cross / PITCH);
    const jx = car.axis === 'x' ? jAlong : jCross;
    const jy = car.axis === 'x' ? jCross : jAlong;
    // brake early enough to actually stop: v^2 / 2a, with a margin
    const need = 0.55 + (car.speed * car.speed) / (2 * (car.brake || 28));
    const stop = !signalOpen(jx, jy, t, car.axis) || car.queued;
    if (stop && gap < need) {
      throttle = gap < 0.8 ? -1 : -0.5;
      car.waiting = true;
    }
  }
  car.queued = false;

  // and don't drive into a building — look further ahead the faster you're going
  const look = Math.max(2.0, car.len + Math.abs(car.speed) * 0.14);
  if (carSolidAt(car.x + Math.cos(car.ang) * look, car.y + Math.sin(car.ang) * look)) {
    throttle = -0.4;
    if (car.junctionCd <= 0) {
      car.junctionCd = 1.4;
      reroute(car);
    }
  }
  stepCar(car, dt, throttle, steer);
}

export function stepChaseCar(car, dt, tx, ty) {
  const dx = tx - car.x, dy = ty - car.y;
  const want = Math.atan2(dy, dx);
  let diff = want - car.ang;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, diff * 1.6));
  const dist = Math.hypot(dx, dy);
  stepCar(car, dt, dist > 5 ? 1 : 0.3, steer);
}

// Foot AI: hostiles advance and shoot inside their range; peds wander and flee
// when something goes off nearby.
// Shortest walkable way off the carriageway. Samples a ring of directions and
// takes the first that reaches pavement without a wall in between, preferring
// whichever is closest to the way the ped is already facing so they don't spin
// on the spot.
function escapeRoad(e) {
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ax = Math.cos(a), ay = Math.sin(a);
    if (solidAt(e.x + ax * 1.6, e.y + ay * 1.6)) continue;
    if (surfaceOf(e.x + ax * 1.6, e.y + ay * 1.6) === SURF.ROAD) continue;
    const score = ax * Math.cos(e.wander) + ay * Math.sin(e.wander);
    if (score > bestScore) { bestScore = score; best = [ax, ay]; }
  }
  return best;
}

// Is anything moving fast enough to matter within `r`? Used to decide whether
// stepping off the kerb is a crossing or a suicide.
function trafficNear(e, world, r) {
  for (const c of world.cars) {
    if (c.exploded || Math.abs(c.speed) < 3) continue;
    if (Math.hypot(c.x - e.x, c.y - e.y) < r) return true;
  }
  return false;
}

export function stepFootAI(e, dt, world) {
  if (e.dead) { e.deadT += dt; return; }
  const p = world.player;
  const d = Math.hypot(p.x - e.x, p.y - e.y);

  // A passive guard is part of a stealth objective: it patrols, and only turns
  // hostile once it has actually SEEN the player (range + facing arc + line of
  // sight, sustained for a beat) or the alarm has gone up some other way.
  if (e.passive && !e.alerted) {
    const w2 = world.stealth;
    e.wander += (Math.random() - 0.5) * dt * 2;
    stepPerson(e, dt, Math.cos(e.wander) * 0.5, Math.sin(e.wander) * 0.5);
    if (!w2 || w2.blown) { e.alerted = true; e.passive = false; return; }
    const seen = canSee(e, p, 13);
    e.suspicion = Math.max(0, (e.suspicion || 0) + (seen ? dt : -dt * 1.4));
    if (e.suspicion > 0.7) {
      w2.blown = true;
      e.alerted = true; e.passive = false;
      for (const o of world.people) if (o.passive) { o.passive = false; o.alerted = true; }
      world.onAlarm?.();
    }
    return;
  }

  if (e.faction === 'cabal' || e.faction === 'cop') {
    const range = e.weapon === 'gun' ? 11 : 1.6;
    if (d < 26) {
      const ux = (p.x - e.x) / (d || 1), uy = (p.y - e.y) / (d || 1);
      if (d > range * 0.8) stepPerson(e, dt, ux, uy, d > 8);
      else stepPerson(e, dt, 0, 0);
      e.dir = dirFromVec(ux, uy);
      if (d < range && e.fireCd <= 0) {
        e.fireCd = e.weapon === 'gun' ? 0.75 + Math.random() * 0.5 : 0.9;
        if (e.weapon === 'gun') {
          e.flash = 0.06;
          const sp = 0.12;   // a little spread so they're not laser-accurate
          world.bullets.push(makeBullet(e.x, e.y,
            ux + (Math.random() - 0.5) * sp, uy + (Math.random() - 0.5) * sp, e.faction, 9));
          world.sfx('shot', 'pistol');
        } else {
          p.hp -= 7; world.sfx('hit');
        }
      }
      return;
    }
  }

  if (e.faction === 'ped') {
    // Dodge traffic first — being run over should feel like the driver's fault,
    // not like the pedestrian was a bollard.
    for (const c of world.cars) {
      if (c.exploded || Math.abs(c.speed) < 4) continue;
      const cd = Math.hypot(c.x - e.x, c.y - e.y);
      if (cd > 6) continue;
      // only flee cars actually heading at us
      const tox = (e.x - c.x) / (cd || 1), toy = (e.y - c.y) / (cd || 1);
      if (Math.cos(c.ang) * tox + Math.sin(c.ang) * toy < 0.4) continue;
      stepPerson(e, dt, -Math.sin(c.ang), Math.cos(c.ang), true);
      return;
    }
    if (world.panic > 0 && d < 18) {
      const ux = (e.x - p.x) / (d || 1), uy = (e.y - p.y) / (d || 1);
      stepPerson(e, dt, ux, uy, true);
      return;
    }
    // Already committed to a crossing: hold the line and run, rather than
    // dithering in the carriageway. Ends once the far kerb is underfoot.
    if (e.crossing) {
      const [cx, cy] = e.crossing;
      stepPerson(e, dt, cx, cy, true);
      e.crossT -= dt;
      if (surfaceOf(e.x + cx * 0.9, e.y + cy * 0.9) !== SURF.ROAD || e.crossT <= 0) e.crossing = null;
      return;
    }

    // Shoved or spawned into the carriageway: get out by the shortest route
    // that is actually walkable. The old version aimed at the centre of the
    // block, which is the middle of a building — so the ped walked into a wall
    // and stood in the road, which is where most of them ended up.
    if (surfaceOf(e.x, e.y) === SURF.ROAD) {
      const esc = escapeRoad(e);
      if (esc) { stepPerson(e, dt, esc[0], esc[1], true); return; }
    }

    // Amble along the pavement, treating the kerb as a wall. Looking one step
    // AHEAD rather than reacting once already in the road is the whole fix:
    // a ped never enters the carriageway by accident, only on purpose.
    e.wander += (Math.random() - 0.5) * dt * 3;
    let wx = Math.cos(e.wander), wy = Math.sin(e.wander);
    const AHEAD = 0.9;
    const roadAt = (ax, ay) => surfaceOf(e.x + ax * AHEAD, e.y + ay * AHEAD) === SURF.ROAD;
    if (roadAt(wx, wy)) {
      // At the kerb. Now and then commit to crossing — a city where nobody
      // ever steps off the pavement is as wrong as one where everybody does —
      // but only when nothing quick is coming.
      if (Math.random() < dt * 0.7 && !trafficNear(e, world, 9)) {
        e.crossing = [wx, wy];
        e.crossT = 4;
      } else {
        // otherwise turn and follow the kerb, whichever way stays on pavement
        const turn = [[-wy, wx], [wy, -wx], [-wx, -wy]].find(([ax, ay]) => !roadAt(ax, ay));
        if (turn) { [wx, wy] = turn; e.wander = Math.atan2(wy, wx); }
      }
    }
    stepPerson(e, dt, wx, wy);
    return;
  }

  // crew members follow the player and engage what the player engages
  if (e.faction === 'crew') {
    const tgt = world.nearestHostile(e.x, e.y, 14);
    if (tgt) {
      const td = Math.hypot(tgt.x - e.x, tgt.y - e.y);
      const ux = (tgt.x - e.x) / (td || 1), uy = (tgt.y - e.y) / (td || 1);
      if (td > 7) stepPerson(e, dt, ux, uy, true); else stepPerson(e, dt, 0, 0);
      e.dir = dirFromVec(ux, uy);
      if (td < 12 && e.fireCd <= 0) {
        e.fireCd = 0.8;
        e.flash = 0.06;
        world.bullets.push(makeBullet(e.x, e.y, ux, uy, 'crew', 14));
        world.sfx('shot');
      }
      return;
    }
    if (d > 4) {
      const ux = (p.x - e.x) / (d || 1), uy = (p.y - e.y) / (d || 1);
      stepPerson(e, dt, ux, uy, d > 9);
    } else stepPerson(e, dt, 0, 0);
  }
}

// Line of sight on the grid: walk the segment and stop at the first wall. Cheap
// enough at these ranges and it means a guard genuinely can't see through a
// building, which is what makes sneaking readable rather than arbitrary.
export function canSee(from, to, range) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  // facing arc: guards don't have eyes in the back of their heads
  const f = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
    ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7] }[from.dir] || [0, 1];
  if ((dx / d) * f[0] + (dy / d) * f[1] < 0.35) return false;   // ~140 degree cone
  const steps = Math.ceil(d * 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(from.x + dx * t, from.y + dy * t)) return false;
  }
  return true;
}

// --- spawning -------------------------------------------------------------
export function spawnTraffic(world, n) {
  for (let i = 0; i < n; i++) {
    const p = nearestRoad(6 + Math.random() * (CW - 12), 6 + Math.random() * (CH - 12));
    const c = initTraffic(makeCar(p.x, p.y, Math.floor(Math.random() * 4) * (Math.PI / 2),
      { ai: 'traffic', cls: rollVehicleClass() }));
    c.speed = 4 + Math.random() * 4;
    world.cars.push(c);
  }
}

export function spawnPeds(world, n) {
  const looks = [BOYZ.pepe, BOYZ.brett, BOYZ.andy, BOYZ.landwolf];
  for (let i = 0; i < n; i++) {
    // spawn on pavement, not in the middle of a carriageway
    let x = 4 + Math.random() * (CW - 8), y = 4 + Math.random() * (CH - 8);
    let guard = 0;
    while (guard++ < 60) {
      if (!solidAt(x, y) && surfaceOf(x, y) !== 0) break;
      x = 4 + Math.random() * (CW - 8); y = 4 + Math.random() * (CH - 8);
    }
    if (solidAt(x, y)) continue;
    // civilians wear the crew palette's cloth but no bandana accent of note
    const base = looks[(Math.random() * looks.length) | 0];
    const look = { skin: base.skin, cloth: base.cloth, accent: base.cloth, cap: base.cloth };
    world.people.push(makePerson(x, y, look, { faction: 'ped', hp: 40 }));
  }
}

export function spawnCabal(world, x, y, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let px = x + Math.cos(a) * (1.5 + Math.random() * 3);
    let py = y + Math.sin(a) * (1.5 + Math.random() * 3);
    let guard = 0;
    while (solidAt(px, py) && guard++ < 20) { px = x + (Math.random() - 0.5) * 8; py = y + (Math.random() - 0.5) * 8; }
    if (solidAt(px, py)) { px = x; py = y; }
    const e = makePerson(px, py, CABAL, {
      faction: 'cabal', hp: opts.hp || 60,
      weapon: opts.weapon || (Math.random() < 0.65 ? 'gun' : 'bat'),
      speed: 3.0,
    });
    world.people.push(e);
    out.push(e);
  }
  return out;
}

export function spawnCops(world, x, y, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = nearestRoad(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24);
    const e = makePerson(p.x, p.y, COP, { faction: 'cop', hp: 70, weapon: 'gun', speed: 3.4 });
    world.people.push(e);
    out.push(e);
  }
  return out;
}

export function spawnCopCar(world, x, y) {
  const p = nearestRoad(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
  const c = makeCar(p.x, p.y, Math.random() * Math.PI * 2, {
    paint: COP_PAINT, ai: 'chase', siren: true, cls: 'cruiser',
  });
  world.cars.push(c);
  return c;
}
