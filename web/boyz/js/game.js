// BOYZ N THE HOOD — main loop, world, camera, rendering, HUD.

import {
  CW, CH, SURF, surf, height, idx, DISTRICTS, LANDMARKS, ROAD_PITCH, ROAD_W,
  surfaceAt, solidAt, districtAtCell, nearestRoad, isOwned, owned, ownedIncome,
  districtOutline,
} from './city.js';
import { toScreen, toWorld, depth, drawBox, drawQuad, projectPath, TW, TH, ZH } from './iso.js';
import {
  ASPHALT, CONCRETE, BUILDING, WATER, PARK, SAND, VOID, NEON, BOYZ, BOYZ_ORDER,
  CABAL, COP, LAMP, SHADOW, MUZZLE, withAlpha, shade, neonLine, pointLight,
} from './palette.js';
import { drawPerson, drawCar, drawMarker, dirFromVec } from './sprites.js';
import {
  makePerson, makeCar, makeBullet, makePickup, stepPerson, stepCar, stepTrafficCar,
  stepChaseCar, stepFootAI, spawnTraffic, spawnPeds, spawnCabal, spawnCops,
  spawnCopCar, PAINTS, RUN_SPEED,
} from './entities.js';
import { Campaign, MISSIONS } from './missions.js';
import { api, sendEvent, flush, getWalletId } from './api.js';

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
let VW = 0, VH = 0, DPR = 1;

function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = Math.round(r.width); VH = Math.round(r.height);
  cv.width = VW * DPR; cv.height = VH * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

// --- input ----------------------------------------------------------------
const keys = new Set();
const input = { up: 0, down: 0, left: 0, right: 0, fire: false, action: false, run: false };
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (KEYMAP[e.code] || ['Space', 'KeyE', 'ShiftLeft', 'Enter'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE') world.tryAction();
  if (e.code === 'KeyM') ui.map = !ui.map;
  if (e.code === 'Tab') { e.preventDefault(); ui.map = !ui.map; }
});
addEventListener('keyup', (e) => keys.delete(e.code));

function readInput() {
  input.up = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  input.down = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  input.left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  input.right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  input.fire = keys.has('Space');
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // touch
  if (touch.active) {
    input.up = touch.dy < -0.3 ? 1 : 0; input.down = touch.dy > 0.3 ? 1 : 0;
    input.left = touch.dx < -0.3 ? 1 : 0; input.right = touch.dx > 0.3 ? 1 : 0;
    input.run = Math.hypot(touch.dx, touch.dy) > 0.75;
  }
  if (touch.fire) input.fire = true;
}

// touch stick + buttons
const touch = { active: false, dx: 0, dy: 0, fire: false, id: null, ox: 0, oy: 0 };
function bindTouch() {
  const stick = document.getElementById('stick');
  const btnFire = document.getElementById('btnFire');
  const btnAct = document.getElementById('btnAct');
  const start = (e) => {
    const t = e.changedTouches[0];
    const r = stick.getBoundingClientRect();
    touch.active = true; touch.id = t.identifier;
    touch.ox = r.left + r.width / 2; touch.oy = r.top + r.height / 2;
    move(e);
  };
  const move = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      const dx = (t.clientX - touch.ox) / 46, dy = (t.clientY - touch.oy) / 46;
      const l = Math.hypot(dx, dy) || 1;
      const c = Math.min(1, l);
      touch.dx = dx / l * c; touch.dy = dy / l * c;
    }
    e.preventDefault();
  };
  const end = () => { touch.active = false; touch.dx = 0; touch.dy = 0; touch.id = null; };
  stick.addEventListener('touchstart', start, { passive: false });
  stick.addEventListener('touchmove', move, { passive: false });
  stick.addEventListener('touchend', end);
  stick.addEventListener('touchcancel', end);
  const press = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { on(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { off?.(); e.preventDefault(); }, { passive: false });
    el.addEventListener('mousedown', on);
    el.addEventListener('mouseup', () => off?.());
  };
  press(btnFire, () => { touch.fire = true; }, () => { touch.fire = false; });
  press(btnAct, () => world.tryAction());
}

// --- world ----------------------------------------------------------------
const ui = { map: false, toasts: [], brief: null, briefT: 0 };

const world = {
  t: 0,
  player: null,
  boy: 'pepe',
  people: [], cars: [], bullets: [], pickups: [],
  cash: 0, points: 0, panic: 0,
  wanted: 0, wantedDecay: 0, copTimer: 0,
  marker: null, markerEntity: null,
  missionTimer: 0, hudTimer: 0, holdT: 0,
  missionEnemies: [], boss: null, missionVan: null,
  crew: [],
  income: 0,

  sfx(kind) { sfx(kind); },

  toast(text) { ui.toasts.push({ text, t: 3.4 }); },
  briefing(who, text) {
    const b = BOYZ[who];
    ui.brief = { name: b ? b.name.toUpperCase() : who.toUpperCase(), role: b?.role || '', text, tag: b?.tag || '#8fe021' };
    ui.briefT = 4.6;
  },

  setMarker(x, y, label) { this.marker = { x, y, label }; this.markerEntity = null; },
  setMarkerEntity(e, label) { this.markerEntity = { e, label }; this.marker = null; },
  clearMarker() { this.marker = null; this.markerEntity = null; },

  setWanted(n) { this.wanted = Math.max(this.wanted, n); this.wantedDecay = 14; },

  nearestHostile(x, y, r) {
    let best = null, bd = r;
    for (const p of this.people) {
      if (p.dead || (p.faction !== 'cabal' && p.faction !== 'cop')) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  despawnMissionEnemies() {
    for (const e of this.missionEnemies || []) e.dead = true;
    this.missionEnemies = [];
    this.pickups = this.pickups.filter((p) => p.type !== 'objective');
  },

  spawnCrew(ids) {
    for (const id of ids) {
      if (id === this.boy) continue;
      if (this.crew.some((c) => c.boyId === id)) continue;
      const c = makePerson(this.player.x + (Math.random() - 0.5) * 4, this.player.y + (Math.random() - 0.5) * 4,
        BOYZ[id], { faction: 'crew', hp: 140, weapon: 'gun', speed: 3.6, name: BOYZ[id].name });
      c.boyId = id;
      this.people.push(c);
      this.crew.push(c);
    }
  },

  award(points, why) {
    this.points += points;
    this.toast(`+${points} PTS — ${why}`);
    hudDirty = true;
  },

  tryAction() {
    const p = this.player;
    if (p.inCar) { exitCar(); return; }
    // enter the nearest car
    let best = null, bd = 3.2;
    for (const c of this.cars) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { enterCar(best); return; }
    // start an available mission when standing on the Pump Lounge
    const pump = LANDMARKS.find((l) => l.id === 'pump');
    if (Math.hypot(p.x - pump.x, p.y - pump.y) < 6 && !campaign.active) {
      if (!campaign.start()) this.toast('Nothing on the board right now.');
    }
  },

  onMissionComplete(m) {
    sendEvent('mission', String(m.id)).catch(() => {});
    ui.brief = null;
    if (m.id === MISSIONS.length) this.toast('THE BLOCK BELONGS TO THE BOYZ');
  },
  onMissionFail() { this.despawnMissionEnemies(); },
};

let campaign;

function enterCar(c) {
  const p = world.player;
  p.inCar = c; c.driver = p; c.ai = null;
  world.toast('Whip acquired');
  if (c.siren) world.setWanted(Math.max(world.wanted, 2));
  else if (Math.random() < 0.5) world.setWanted(Math.max(world.wanted, 1));
}
function exitCar() {
  const p = world.player, c = p.inCar;
  if (!c) return;
  p.inCar = null; c.driver = null;
  c.speed *= 0.3;
  // step out beside the car, never inside a wall
  const a = c.ang + Math.PI / 2;
  let nx = c.x + Math.cos(a) * 1.6, ny = c.y + Math.sin(a) * 1.6;
  if (solidAt(nx, ny)) { nx = c.x - Math.cos(a) * 1.6; ny = c.y - Math.sin(a) * 1.6; }
  if (!solidAt(nx, ny)) { p.x = nx; p.y = ny; }
}

// --- camera ---------------------------------------------------------------
const cam = { x: 0, y: 0, tx: 0, ty: 0 };
function updateCamera(dt) {
  const p = world.player;
  const anchor = p.inCar ? p.inCar : p;
  const s = toScreen(anchor.x, anchor.y, 0);
  cam.tx = s.x; cam.ty = s.y;
  // ease, but snap when far (respawn / mission jump)
  const k = Math.min(1, dt * 6);
  if (Math.hypot(cam.tx - cam.x, cam.ty - cam.y) > 400) { cam.x = cam.tx; cam.y = cam.ty; }
  else { cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; }
}

// --- audio (tiny WebAudio blips; no assets) -------------------------------
let actx = null;
function sfx(kind) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    const n = actx.currentTime;
    if (kind === 'shot') { o.type = 'square'; o.frequency.setValueAtTime(220, n); o.frequency.exponentialRampToValueAtTime(60, n + 0.09); g.gain.setValueAtTime(0.07, n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.1); o.start(n); o.stop(n + 0.11); }
    else if (kind === 'hit') { o.type = 'sawtooth'; o.frequency.setValueAtTime(120, n); g.gain.setValueAtTime(0.06, n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.14); o.start(n); o.stop(n + 0.15); }
    else if (kind === 'pickup') { o.type = 'triangle'; o.frequency.setValueAtTime(560, n); o.frequency.exponentialRampToValueAtTime(1100, n + 0.12); g.gain.setValueAtTime(0.07, n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.16); o.start(n); o.stop(n + 0.17); }
    else if (kind === 'good') { o.type = 'triangle'; o.frequency.setValueAtTime(440, n); o.frequency.setValueAtTime(660, n + 0.1); g.gain.setValueAtTime(0.08, n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.3); o.start(n); o.stop(n + 0.32); }
  } catch { /* audio is optional */ }
}

// --- update ---------------------------------------------------------------
function update(dt) {
  world.t += dt;
  readInput();
  const p = world.player;

  // movement — screen-relative, so "up" is up on screen, not north-east in
  // world space. Without this rotation isometric controls feel drunk.
  let ix = input.right - input.left, iy = input.down - input.up;
  let wx = 0, wy = 0;
  if (ix || iy) {
    wx = (ix / (TW * 2)) + (iy / (TH * 2));
    wy = (iy / (TH * 2)) - (ix / (TW * 2));
    const l = Math.hypot(wx, wy) || 1; wx /= l; wy /= l;
  }

  if (p.inCar) {
    const c = p.inCar;
    // steer relative to the car's heading
    let throttle = 0, steer = 0;
    if (ix || iy) {
      const want = Math.atan2(wy, wx);
      let diff = want - c.ang;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      throttle = Math.cos(diff) > -0.3 ? 1 : -1;
      steer = Math.max(-1, Math.min(1, diff * 2));
    }
    stepCar(c, dt, throttle, steer);
    p.x = c.x; p.y = c.y;
    if (c.dead) { exitCar(); p.hp -= 25; }
    // running people down
    for (const q of world.people) {
      if (q.dead || q === p) continue;
      if (Math.hypot(q.x - c.x, q.y - c.y) < 1.4 && Math.abs(c.speed) > 5) {
        q.hp -= Math.abs(c.speed) * 3;
        world.panic = 4;
        if (q.hp <= 0 && !q.dead) { q.dead = true; onKill(q); }
      }
    }
  } else {
    stepPerson(p, dt, wx, wy, input.run);
    if (input.fire && p.fireCd <= 0) {
      p.fireCd = 0.18;
      p.flash = 0.05;
      const f = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7] }[p.dir] || [0, 1];
      world.bullets.push(makeBullet(p.x, p.y, f[0], f[1], 'player', 24));
      world.panic = 4;
      sfx('shot');
    }
  }
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.flash > 0) p.flash -= dt;
  if (world.panic > 0) world.panic -= dt;

  // entities
  for (const c of world.cars) {
    if (c.driver) continue;
    if (c.ai === 'traffic') stepTrafficCar(c, dt);
    else if (c.ai === 'chase') {
      stepChaseCar(c, dt, p.x, p.y);
      if (Math.hypot(c.x - p.x, c.y - p.y) < 2.2 && Math.abs(c.speed) > 6) { p.hp -= 12; c.speed *= -0.3; }
    }
  }
  for (const e of world.people) {
    if (e === p) continue;
    stepFootAI(e, dt, world);
  }

  // bullets
  for (const b of world.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (solidAt(b.x, b.y)) { b.life = 0; continue; }
    for (const e of world.people) {
      if (e.dead || e.faction === b.faction) continue;
      if (b.faction === 'player' && e.faction === 'crew') continue;
      if (b.faction === 'crew' && (e.faction === 'player' || e.faction === 'crew')) continue;
      if ((b.faction === 'cabal' || b.faction === 'cop') && (e.faction === 'cabal' || e.faction === 'cop')) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < 0.8) {
        e.hp -= b.dmg; b.life = 0;
        if (e.hp <= 0) { e.dead = true; onKill(e); }
        break;
      }
    }
  }
  world.bullets = world.bullets.filter((b) => b.life > 0);

  // pickups
  for (const pk of world.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(pk.x - p.x, pk.y - p.y) < 1.6) {
      pk.taken = true;
      sfx('pickup');
      if (pk.type === 'cash') { world.cash += 250; world.toast('+$250'); }
      else world.toast(pk.label || 'Collected');
    }
  }
  world.pickups = world.pickups.filter((pk) => !pk.taken || pk.type === 'objective');

  // wanted level
  if (world.wanted > 0) {
    world.wantedDecay -= dt;
    world.copTimer -= dt;
    if (world.copTimer <= 0) {
      world.copTimer = Math.max(2.5, 9 - world.wanted * 1.4);
      spawnCops(world, p.x, p.y, Math.min(4, world.wanted));
      if (world.wanted >= 2) spawnCopCar(world, p.x, p.y);
    }
    if (world.wantedDecay <= 0) { world.wanted--; world.wantedDecay = 16; hudDirty = true; }
  }

  // territory income
  world.income = ownedIncome();
  world.cash += world.income * dt;

  // cull the dead and anything far away, so the sim stays cheap
  world.people = world.people.filter((e) => {
    if (e === p) return true;
    if (e.dead && e.deadT > 8) return false;
    return Math.hypot(e.x - p.x, e.y - p.y) < 90;
  });
  world.cars = world.cars.filter((c) => (c.dead ? c.burn < 12 : Math.hypot(c.x - p.x, c.y - p.y) < 110));
  if (world.people.filter((e) => e.faction === 'ped').length < 18) spawnPeds(world, 6);
  if (world.cars.filter((c) => c.ai === 'traffic').length < 12) spawnTraffic(world, 4);

  campaign.update(dt);
  updateCamera(dt);

  // player death -> respawn at the Pump Lounge
  if (p.hp <= 0) {
    const pump = LANDMARKS.find((l) => l.id === 'pump');
    p.hp = 100; p.x = pump.x; p.y = pump.y + 5;
    if (p.inCar) exitCar();
    world.wanted = 0;
    world.cash = Math.max(0, world.cash - 500);
    world.toast('Wasted — patched up at the Pump. -$500');
  }

  for (const t of ui.toasts) t.t -= dt;
  ui.toasts = ui.toasts.filter((t) => t.t > 0).slice(-4);
  if (ui.briefT > 0) { ui.briefT -= dt; if (ui.briefT <= 0) ui.brief = null; }
}

function onKill(e) {
  if (e.faction === 'cabal') { world.award(25, 'Cabal down'); world.panic = 4; }
  else if (e.faction === 'cop') { world.setWanted(Math.min(5, world.wanted + 1)); world.panic = 5; }
  else if (e.faction === 'ped') { world.setWanted(Math.min(5, world.wanted + 1)); world.panic = 5; }
  sfx('hit');
}

// --- render ---------------------------------------------------------------
// The city is baked into one big offscreen canvas at load: ground, buildings
// and neon never change except when turf flips, so redrawing 16k tiles every
// frame would be pure waste. The bake is re-run only on a territory change.
let cityCanvas = null, cityOx = 0, cityOy = 0, cityDirty = true;

function bakeCity() {
  const tl = toScreen(0, 0), tr = toScreen(CW, 0), br = toScreen(CW, CH), bl = toScreen(0, CH);
  const minX = Math.min(tl.x, tr.x, br.x, bl.x) - 40;
  const maxX = Math.max(tl.x, tr.x, br.x, bl.x) + 40;
  const minY = Math.min(tl.y, tr.y, br.y, bl.y) - 40 - 30 * ZH;
  const maxY = Math.max(tl.y, tr.y, br.y, bl.y) + 60;
  const w = Math.ceil(maxX - minX), h = Math.ceil(maxY - minY);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.translate(-minX, -minY);
  cityOx = minX; cityOy = minY;

  g.fillStyle = VOID; g.fillRect(minX, minY, w, h);

  // ground, painted in back-to-front diagonal order
  for (let s = 0; s < CW + CH; s++) {
    for (let x = Math.max(0, s - CH + 1); x < Math.min(CW, s + 1); x++) {
      const y = s - x;
      const i = idx(x, y);
      if (height[i] > 0) continue;
      const sf = surf[i];
      let R = sf === SURF.ROAD ? ASPHALT : sf === SURF.PAVE ? CONCRETE
        : sf === SURF.WATER ? WATER : sf === SURF.PARK ? PARK
          : sf === SURF.SAND ? SAND : CONCRETE;
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const v = n % 3;
      const fill = v === 0 ? R.b : v === 1 ? shade(R.b, -6) : shade(R.b, 5);
      drawQuad(g, x, y, 1, 1, fill);
      // lane markings down the middle of each road
      if (sf === SURF.ROAD) {
        const onX = (x % ROAD_PITCH) === 0, onY = (y % ROAD_PITCH) === 0;
        if ((onX || onY) && ((x + y) % 4 < 2)) {
          const p0 = toScreen(x + 0.5, y + 0.5);
          g.fillStyle = 'rgba(220,210,160,0.16)';
          g.fillRect(p0.x - 2, p0.y - 1, 4, 2);
        }
      }
    }
  }

  // buildings, same order so nearer blocks overlap further ones
  for (let s = 0; s < CW + CH; s++) {
    for (let x = Math.max(0, s - CH + 1); x < Math.min(CW, s + 1); x++) {
      const y = s - x;
      const i = idx(x, y);
      const hgt = height[i];
      if (!hgt) continue;
      // only draw a footprint once, from its min corner
      const left = x > 0 && height[idx(x - 1, y)] === hgt;
      const up = y > 0 && height[idx(x, y - 1)] === hgt;
      if (left || up) continue;
      let w2 = 1; while (x + w2 < CW && height[idx(x + w2, y)] === hgt) w2++;
      let d2 = 1;
      outer: while (y + d2 < CH) {
        for (let k = 0; k < w2; k++) if (height[idx(x + k, y + d2)] !== hgt) break outer;
        d2++;
      }
      const dd = districtAtCell(x, y);
      const R = (dd && (dd.id === 'blackbulls' || dd.id === 'docks')) ? { ...BUILDING } : BUILDING;
      drawBox(g, R, x, y, w2, d2, hgt);
      // lit windows — a sparse grid on the two visible faces
      const n = ((x * 2654435761) ^ (y * 40503)) >>> 0;
      for (let f = 0; f < 2; f++) {
        for (let wy2 = 1; wy2 < hgt - 0.5; wy2 += 1.6) {
          for (let wx2 = 0.6; wx2 < (f ? d2 : w2) - 0.4; wx2 += 1.4) {
            if (((n + wx2 * 31 + wy2 * 17) | 0) % 7 > 3) continue;
            const p1 = f ? toScreen(x, y + wx2, wy2) : toScreen(x + wx2, y + d2, wy2);
            g.fillStyle = ((n + wx2 + wy2) | 0) % 5 === 0 ? 'rgba(255,210,130,0.55)' : 'rgba(150,190,230,0.25)';
            g.fillRect(p1.x - 1.5, p1.y - 3, 3, 3);
          }
        }
      }
    }
  }

  // street lamps along the road grid
  for (let y = 0; y < CH; y += ROAD_PITCH) {
    for (let x = 0; x < CW; x += 4) {
      if (x >= CW || y >= CH) continue;
      if (surf[idx(x, y)] !== SURF.ROAD) continue;
      const p1 = toScreen(x + 0.5, y + 0.5, 0);
      pointLight(g, p1.x, p1.y, 34, LAMP.hot, 0.14);
      g.fillStyle = LAMP.core;
      g.fillRect(p1.x - 1, p1.y - 20, 2, 2);
      g.fillStyle = 'rgba(40,46,60,0.9)';
      g.fillRect(p1.x - 0.7, p1.y - 20, 1.4, 20);
    }
  }

  // neon turf borders — the flip to lime is the campaign's progress bar
  for (const d of DISTRICTS) {
    const col = isOwned(d.id) ? NEON.boyz : NEON[d.neon];
    neonLine(g, projectPath(districtOutline(d)), col, 2, 1);
    const c0 = toScreen((d.bounds[0] + d.bounds[2]) / 2, (d.bounds[1] + d.bounds[3]) / 2, 0);
    g.font = 'bold 13px "Courier New", monospace';
    g.textAlign = 'center';
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = withAlpha(col.mid, 0.5);
    g.fillText(d.name.toUpperCase(), c0.x, c0.y);
    g.restore();
    g.fillStyle = col.core;
    g.font = 'bold 12px "Courier New", monospace';
    g.fillText(d.name.toUpperCase(), c0.x, c0.y);
    g.textAlign = 'left';
  }

  // landmark labels
  for (const lm of LANDMARKS) {
    const p1 = toScreen(lm.x, lm.y, 0);
    g.font = '9px "Courier New", monospace';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(220,230,255,0.5)';
    g.fillText(lm.name.toUpperCase(), p1.x, p1.y + 14);
    g.textAlign = 'left';
  }

  cityCanvas = c;
  cityDirty = false;
}

let hudDirty = true;
let lastOwned = 0;

function render() {
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, VW, VH);

  if (owned.size !== lastOwned) { lastOwned = owned.size; cityDirty = true; }
  if (cityDirty || !cityCanvas) bakeCity();

  ctx.save();
  ctx.translate(VW / 2 - cam.x, VH / 2 - cam.y);
  ctx.drawImage(cityCanvas, cityOx, cityOy);

  // --- depth-sorted dynamic layer ---
  const items = [];
  for (const pk of world.pickups) if (!pk.taken) items.push({ d: depth(pk.x, pk.y), f: () => drawPickup(pk) });
  for (const c of world.cars) items.push({ d: depth(c.x, c.y, 0.6), f: () => drawCarEnt(c) });
  for (const e of world.people) {
    if (e.inCar) continue;
    items.push({ d: depth(e.x, e.y, 1), f: () => drawPersonEnt(e) });
  }
  for (const b of world.bullets) items.push({ d: depth(b.x, b.y, 1.2), f: () => drawBullet(b) });
  if (world.marker) items.push({ d: 1e9, f: () => drawMarker(ctx, world.marker.x, world.marker.y, NEON.boyz, world.t, world.marker.label) });
  if (world.markerEntity?.e && !world.markerEntity.e.dead) {
    const m = world.markerEntity;
    items.push({ d: 1e9, f: () => drawMarker(ctx, m.e.x, m.e.y, NEON.boyz, world.t, m.label) });
  }
  items.sort((a, b) => a.d - b.d);
  for (const it of items) it.f();

  ctx.restore();

  drawHUD();
  if (ui.map) drawMap();
}

function drawPickup(pk) {
  const s = toScreen(pk.x, pk.y, 0);
  const bob = Math.sin(world.t * 3 + pk.bob) * 3;
  const col = pk.type === 'objective' ? NEON.boyz : NEON.tungtungs;
  pointLight(ctx, s.x, s.y, 22, col.mid, 0.3);
  ctx.fillStyle = col.deep;
  ctx.fillRect(s.x - 5, s.y - 10 + bob, 10, 10);
  ctx.fillStyle = col.mid;
  ctx.fillRect(s.x - 4, s.y - 9 + bob, 8, 8);
  ctx.fillStyle = col.core;
  ctx.fillRect(s.x - 4, s.y - 9 + bob, 8, 2);
}

function drawBullet(b) {
  const s = toScreen(b.x, b.y, 1.1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = MUZZLE.hot;
  ctx.fillRect(s.x - 1.5, s.y - 1, 3, 2);
  ctx.fillStyle = withAlpha(MUZZLE.mid, 0.5);
  ctx.fillRect(s.x - 4, s.y - 0.5, 8, 1);
  ctx.restore();
}

function drawCarEnt(c) {
  if (c.dead) {
    drawCar(ctx, c.x, c.y, c.ang, { o: '#0a0708', d: '#170f0c', b: '#241713', l: '#31201a', h: '#3f2a22' },
      { lights: false, len: c.len, wid: c.wid });
    const s = toScreen(c.x, c.y, 0.8);
    pointLight(ctx, s.x, s.y, 30 + Math.sin(world.t * 9) * 6, '#ff7a2a', 0.5);
    return;
  }
  drawCar(ctx, c.x, c.y, c.ang, c.paint, {
    siren: c.siren, sirenPhase: world.t, len: c.len, wid: c.wid,
  });
}

function drawPersonEnt(e) {
  // A lime ring under the player. The city is dark and dense enough that a
  // 26px figure genuinely gets lost in it — without this you spend the first
  // minute of every session hunting for yourself.
  if (e === world.player && !e.inCar) {
    const s = toScreen(e.x, e.y, 0);
    const puls = 0.55 + Math.sin(world.t * 4) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = withAlpha(NEON.boyz.mid, 0.5 * puls);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(s.x, s.y, TW * 0.7, TH * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = withAlpha(NEON.boyz.core, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(s.x, s.y, TW * 0.7, TH * 0.7, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if (e.dead) {
    const s = toScreen(e.x, e.y, 0);
    ctx.fillStyle = 'rgba(60,10,16,0.55)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }
  drawPerson(ctx, e.x, e.y, 0, e.look, e.dir, e.walk, e === world.player ? 28 : 25, {
    weapon: e.weapon, flash: e.flash > 0,
  });
  if (e.faction === 'crew' && e.name) {
    const s = toScreen(e.x, e.y, 0);
    ctx.font = '8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = e.look.accent.l;
    ctx.fillText(e.name, s.x, s.y - 34);
    ctx.textAlign = 'left';
  }
}

// --- HUD ------------------------------------------------------------------
function drawHUD() {
  const pad = 10;
  ctx.font = 'bold 13px "Courier New", monospace';

  // points + cash
  ctx.fillStyle = 'rgba(6,10,18,0.72)';
  ctx.fillRect(pad, pad, 186, 46);
  ctx.strokeStyle = NEON.boyz.mid; ctx.lineWidth = 1;
  ctx.strokeRect(pad + 0.5, pad + 0.5, 185, 45);
  ctx.fillStyle = NEON.boyz.core;
  ctx.fillText(`${Math.floor(world.points)} PTS`, pad + 8, pad + 19);
  ctx.fillStyle = '#f0ca4e';
  ctx.font = '12px "Courier New", monospace';
  ctx.fillText(`$${Math.floor(world.cash)}`, pad + 8, pad + 36);
  if (world.income) {
    ctx.fillStyle = 'rgba(200,255,120,0.65)';
    ctx.font = '9px "Courier New", monospace';
    ctx.fillText(`+$${world.income}/s turf`, pad + 92, pad + 36);
  }

  // wanted stars
  ctx.font = '15px "Courier New", monospace';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < world.wanted ? '#ff2a4a' : 'rgba(120,130,150,0.25)';
    ctx.fillText('★', VW - pad - 22 - i * 17, pad + 20);
  }

  // health
  const hw = 130;
  ctx.fillStyle = 'rgba(6,10,18,0.72)';
  ctx.fillRect(pad, VH - pad - 16, hw, 12);
  const hp = Math.max(0, world.player.hp) / 100;
  ctx.fillStyle = hp > 0.5 ? '#3fc94a' : hp > 0.25 ? '#f0a020' : '#e0233a';
  ctx.fillRect(pad + 1, VH - pad - 15, (hw - 2) * hp, 10);
  ctx.strokeStyle = 'rgba(180,200,230,0.4)';
  ctx.strokeRect(pad + 0.5, VH - pad - 16.5, hw, 12);

  // objective
  const label = campaign.objectiveLabel();
  if (label) {
    ctx.font = 'bold 12px "Courier New", monospace';
    const tw = ctx.measureText(label).width;
    const bx = VW / 2 - tw / 2 - 10;
    ctx.fillStyle = 'rgba(6,10,18,0.78)';
    ctx.fillRect(bx, pad, tw + 20, 24);
    ctx.strokeStyle = NEON.boyz.mid;
    ctx.strokeRect(bx + 0.5, pad + 0.5, tw + 19, 23);
    ctx.fillStyle = NEON.boyz.core;
    ctx.textAlign = 'center';
    ctx.fillText(label, VW / 2, pad + 16);
    ctx.textAlign = 'left';
  }
  if (world.hudTimer > 0) {
    ctx.font = 'bold 17px "Courier New", monospace';
    ctx.fillStyle = world.hudTimer < 10 ? '#e0233a' : '#f0ca4e';
    ctx.textAlign = 'center';
    ctx.fillText(world.hudTimer.toFixed(1), VW / 2, pad + 46);
    ctx.textAlign = 'left';
  }

  // district name
  const d = districtAtCell(world.player.x, world.player.y);
  if (d) {
    const col = isOwned(d.id) ? NEON.boyz : NEON[d.neon];
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = col.mid;
    ctx.textAlign = 'right';
    ctx.fillText(d.name.toUpperCase() + (isOwned(d.id) ? ' — BOYZ' : ''), VW - pad, VH - pad - 4);
    ctx.textAlign = 'left';
  }

  // briefing card
  if (ui.brief) {
    const b = ui.brief;
    const bw = Math.min(430, VW - 40), bh = 74;
    const bx = VW / 2 - bw / 2, by = VH - bh - 58;
    ctx.fillStyle = 'rgba(6,10,18,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = b.tag; ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    ctx.fillStyle = b.tag;
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillText(b.name, bx + 12, by + 20);
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = 'rgba(200,215,240,0.6)';
    ctx.fillText(b.role, bx + 12 + ctx.measureText(b.name).width + 34, by + 20);
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = '#dbe4f5';
    wrap(ctx, b.text, bx + 12, by + 40, bw - 24, 14);
  }

  // toasts
  ctx.font = '11px "Courier New", monospace';
  ui.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.min(1, t.t);
    ctx.fillStyle = 'rgba(6,10,18,0.8)';
    const tw = ctx.measureText(t.text).width;
    ctx.fillRect(VW - pad - tw - 16, pad + 34 + i * 20, tw + 16, 17);
    ctx.fillStyle = NEON.boyz.core;
    ctx.textAlign = 'right';
    ctx.fillText(t.text, VW - pad - 8, pad + 46 + i * 20);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  });

  // action hint
  if (!campaign.active) {
    const pump = LANDMARKS.find((l) => l.id === 'pump');
    if (Math.hypot(world.player.x - pump.x, world.player.y - pump.y) < 6) {
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillStyle = NEON.boyz.core;
      ctx.textAlign = 'center';
      const nm = campaign.available();
      ctx.fillText(nm ? `[E] START — ${nm.title}` : 'ALL MISSIONS DONE — THE BLOCK IS YOURS',
        VW / 2, VH - 34);
      ctx.textAlign = 'left';
    }
  }
}

function wrap(c, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, yy); line = w; yy += lh; }
    else line = t;
  }
  if (line) c.fillText(line, x, yy);
}

// Full-screen map (M / Tab) — the reference image, live.
function drawMap() {
  ctx.fillStyle = 'rgba(4,6,11,0.93)';
  ctx.fillRect(0, 0, VW, VH);
  const sc = Math.min(VW / CW, VH / CH) * 0.86;
  const ox = VW / 2 - (CW * sc) / 2, oy = VH / 2 - (CH * sc) / 2;
  for (const d of DISTRICTS) {
    const [x0, y0, x1, y1] = d.bounds;
    const col = isOwned(d.id) ? NEON.boyz : NEON[d.neon];
    ctx.fillStyle = withAlpha(col.deep, 0.35);
    ctx.fillRect(ox + x0 * sc, oy + y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc);
    ctx.strokeStyle = col.mid; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + x0 * sc, oy + y0 * sc, (x1 - x0) * sc, (y1 - y0) * sc);
    ctx.fillStyle = col.core;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.name.toUpperCase(), ox + ((x0 + x1) / 2) * sc, oy + ((y0 + y1) / 2) * sc);
  }
  for (const lm of LANDMARKS) {
    ctx.fillStyle = 'rgba(210,225,255,0.75)';
    ctx.fillRect(ox + lm.x * sc - 2, oy + lm.y * sc - 2, 4, 4);
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(lm.name, ox + lm.x * sc, oy + lm.y * sc - 6);
  }
  const p = world.player;
  ctx.fillStyle = '#c8ff5a';
  ctx.beginPath(); ctx.arc(ox + p.x * sc, oy + p.y * sc, 4, 0, Math.PI * 2); ctx.fill();
  if (world.marker) {
    ctx.strokeStyle = '#c8ff5a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox + world.marker.x * sc, oy + world.marker.y * sc, 7, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(200,215,240,0.6)';
  ctx.font = '11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ROBINHOOD BLOCK — [M] to close', VW / 2, oy - 12);
  ctx.textAlign = 'left';
}

// --- boot -----------------------------------------------------------------
function startGame(boyId) {
  world.boy = boyId;
  const pump = LANDMARKS.find((l) => l.id === 'pump');
  world.player = makePerson(pump.x, pump.y + 6, BOYZ[boyId], {
    faction: 'player', hp: 100, weapon: 'gun', speed: 3.6, name: BOYZ[boyId].name,
  });
  world.people.push(world.player);
  spawnTraffic(world, 16);
  spawnPeds(world, 26);
  campaign = new Campaign(world);
  world.briefing(boyId, 'Pump Lounge is home. Walk in and take a job when you\'re ready.');
  document.getElementById('select').hidden = true;
  document.getElementById('hud').hidden = false;
  resize();
  requestAnimationFrame(loop);
  api.register(BOYZ[boyId].name).then(() => flush()).catch(() => {});
}

let last = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

// character select
function buildSelect() {
  const wrapEl = document.getElementById('picks');
  for (const id of BOYZ_ORDER) {
    const b = BOYZ[id];
    const el = document.createElement('button');
    el.className = 'pick';
    el.style.setProperty('--tag', b.tag);
    el.innerHTML = `<canvas width="120" height="150"></canvas>
      <span class="nm">${b.name}</span><span class="rl">${b.role}</span>`;
    const c = el.querySelector('canvas');
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(60, 128);
    // draw the figure straight into the card at 3x
    const save = g.getTransform();
    g.setTransform(save.a * 1, 0, 0, save.d * 1, save.e, save.f);
    drawPersonCard(g, b);
    el.addEventListener('click', () => startGame(id));
    wrapEl.appendChild(el);
  }
}
function drawPersonCard(g, look) {
  // reuse the world sprite by faking a world position of (0,0)
  const fake = { save: g.save.bind(g) };
  g.save();
  g.scale(3.4, 3.4);
  drawPerson(g, 0, 0, 0, look, 's', 0, 26, {});
  g.restore();
}

document.getElementById('boot')?.addEventListener('click', () => {});
resize();
bindTouch();
buildSelect();
window.__boyz = { world, get campaign() { return campaign; }, MISSIONS };
