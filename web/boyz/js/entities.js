// Entities: the player, peds, Cabal soldiers, cops, cars, bullets, pickups.
//
// Everything lives in flat world space (x, y in grid units) and is projected at
// draw time. Movement is arcade, not simulated: cars have grip and a turn rate
// that scales with speed, people have a flat top speed. It should feel like a
// 16-bit GTA, which means responsive over realistic.

import { solidAt, carSolidAt, nearestRoad, districtAtCell, surfaceAt as surfaceOf, CW, CH } from './city.js';
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

export function makeCar(x, y, ang = 0, opts = {}) {
  return {
    id: uid(), kind: 'car', x, y, ang,
    vx: 0, vy: 0, speed: 0,
    paint: opts.paint || PAINTS[(Math.random() * PAINTS.length) | 0],
    hp: opts.hp || 100, maxHp: opts.hp || 100,
    driver: null,               // entity currently driving
    ai: opts.ai || null,        // 'traffic' | 'chase' | null
    siren: !!opts.siren,
    // Sized to fit a lane. Roads are 2 cells wide, so lane centres sit 1.0
    // apart — a car half-width of 1.0 (the old value) meant every car
    // permanently overlapped its oncoming neighbour.
    len: opts.len || 1.5, wid: opts.wid || 0.45,
    topSpeed: opts.topSpeed || 16,
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
      const dx = best[0], dy = best[1];
      const d = 1;
      const nx = dx, ny = dy;
      const push = bestPen / 2;
      // separate, weighting the moving car less so parked cars get shoved
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;

      // closing speed along the contact normal decides the damage
      const av = a.speed, bv = b.speed;
      const aVx = Math.cos(a.ang) * av, aVy = Math.sin(a.ang) * av;
      const bVx = Math.cos(b.ang) * bv, bVy = Math.sin(b.ang) * bv;
      const rel = (aVx - bVx) * nx + (aVy - bVy) * ny;
      if (rel <= 0) continue;

      a.speed -= rel * 0.55;
      b.speed += rel * 0.55;
      const dmg = Math.max(0, rel - 4) * 2.4;
      if (dmg > 0) {
        a.hp -= dmg; b.hp -= dmg;
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
  const accel = 26, brake = 30, drag = 1.6;
  if (throttle > 0) car.speed += accel * throttle * dt;
  else if (throttle < 0) car.speed += brake * throttle * dt;
  car.speed -= car.speed * drag * dt;
  car.speed = Math.max(-car.topSpeed * 0.4, Math.min(car.topSpeed, car.speed));

  const authority = Math.min(1, Math.abs(car.speed) / 4);
  car.ang += steer * 2.6 * dt * authority * Math.sign(car.speed || 1);

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

export function stepTrafficCar(car, dt, cars) {
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
  // whole grid ground to a halt.
  let throttle = 0.9;
  if (cars) {
    const fx = Math.cos(car.ang), fy = Math.sin(car.ang);
    for (const o of cars) {
      if (o === car || o.exploded) continue;
      const rx = o.x - car.x, ry = o.y - car.y;
      const ahead = rx * fx + ry * fy;
      if (ahead < 0.5 || ahead > 3.6) continue;
      const side = Math.abs(rx * -fy + ry * fx);
      if (side < 1.1) { throttle = -0.3; break; }
    }
  }
  // and don't drive into a building
  if (carSolidAt(car.x + Math.cos(car.ang) * 2.0, car.y + Math.sin(car.ang) * 2.0)) {
    throttle = -0.4;
    if (car.junctionCd <= 0) {
      car.junctionCd = 1.4;
      car.axis = car.axis === 'x' ? 'y' : 'x';
      car.tdir = Math.random() < 0.5 ? 1 : -1;
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
          world.sfx('shot');
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
    // amble, but prefer the pavement — steer back if we drift into the road
    e.wander += (Math.random() - 0.5) * dt * 3;
    let wx = Math.cos(e.wander), wy = Math.sin(e.wander);
    if (surfaceOf(e.x, e.y) === 0) {           // SURF.ROAD — get off it
      const bx = Math.floor(e.x / 8) * 8 + 4, by = Math.floor(e.y / 8) * 8 + 4;
      wx = bx - e.x; wy = by - e.y;
      const l2 = Math.hypot(wx, wy) || 1;
      wx /= l2; wy /= l2;
      stepPerson(e, dt, wx, wy, true);
      return;
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
    const c = initTraffic(makeCar(p.x, p.y, Math.floor(Math.random() * 4) * (Math.PI / 2), { ai: 'traffic' }));
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
    paint: COP_PAINT, ai: 'chase', siren: true, topSpeed: 18, hp: 140,
  });
  world.cars.push(c);
  return c;
}
