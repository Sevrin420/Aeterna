// Entities: the player, peds, Cabal soldiers, cops, cars, bullets, pickups.
//
// Everything lives in flat world space (x, y in grid units) and is projected at
// draw time. Movement is arcade, not simulated: cars have grip and a turn rate
// that scales with speed, people have a flat top speed. It should feel like a
// 16-bit GTA, which means responsive over realistic.

import { solidAt, carSolidAt, nearestRoad, districtAtCell, CW, CH } from './city.js';
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
    len: opts.len || 2.1, wid: opts.wid || 1.0,
    topSpeed: opts.topSpeed || 16,
    dead: false, burn: 0,
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

// Arcade car handling. Steering authority falls off at very low speed (so you
// can't pivot on the spot) and grip bleeds sideways velocity, which is what
// gives it the loose, slidey feel of the era.
export function stepCar(car, dt, throttle, steer) {
  if (car.dead) { car.burn += dt; return; }
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
export function stepTrafficCar(car, dt) {
  // Drive forward, and when the road ahead is blocked pick a new heading that
  // isn't. Crude, but on a grid city it produces traffic that mostly stays on
  // the road and turns at junctions.
  const look = 2.4;
  const ax = car.x + Math.cos(car.ang) * look, ay = car.y + Math.sin(car.ang) * look;
  if (carSolidAt(ax, ay)) {
    const opts = [car.ang + Math.PI / 2, car.ang - Math.PI / 2, car.ang + Math.PI];
    for (const a of opts) {
      if (!carSolidAt(car.x + Math.cos(a) * look, car.y + Math.sin(a) * look)) { car.ang = a; break; }
    }
  }
  stepCar(car, dt, 0.55, 0);
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
    if (world.panic > 0 && d < 18) {
      const ux = (e.x - p.x) / (d || 1), uy = (e.y - p.y) / (d || 1);
      stepPerson(e, dt, ux, uy, true);
      return;
    }
    e.wander += (Math.random() - 0.5) * dt * 3;
    stepPerson(e, dt, Math.cos(e.wander), Math.sin(e.wander));
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

// --- spawning -------------------------------------------------------------
export function spawnTraffic(world, n) {
  for (let i = 0; i < n; i++) {
    const p = nearestRoad(6 + Math.random() * (CW - 12), 6 + Math.random() * (CH - 12));
    const c = makeCar(p.x, p.y, Math.floor(Math.random() * 4) * (Math.PI / 2), { ai: 'traffic' });
    c.speed = 4 + Math.random() * 4;
    world.cars.push(c);
  }
}

export function spawnPeds(world, n) {
  const looks = [BOYZ.pepe, BOYZ.brett, BOYZ.andy, BOYZ.landwolf];
  for (let i = 0; i < n; i++) {
    let x = 4 + Math.random() * (CW - 8), y = 4 + Math.random() * (CH - 8);
    let guard = 0;
    while (solidAt(x, y) && guard++ < 40) { x = 4 + Math.random() * (CW - 8); y = 4 + Math.random() * (CH - 8); }
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
