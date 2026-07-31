// BOYZ N THE HOOD — main loop, world, camera, rendering, HUD.

import {
  CW, CH, SURF, surf, height, idx, DISTRICTS, LANDMARKS, ROAD_PITCH, ROAD_W,
  surfaceAt, solidAt, districtAtCell, nearestRoad, isOwned, owned, ownedIncome,
  districtOutline, BUILDINGS, GARAGES, SAFEHOUSES, junctionPhase, isSignalled,
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
  spawnCopCar, PAINTS, RUN_SPEED, resolveCarCollisions, stepWreck,
} from './entities.js';
import { Campaign, MISSIONS } from './missions.js';
import { Hustle } from './hustle.js';
import {
  api, sendEvent, flush, getWalletId, linkWallet, unlinkWallet, isLinked,
} from './api.js';
import {
  sfx as audioSfx, engine as audioEngine, ambience, siren, toggleMute, isMuted, setPaused,
} from './audio.js';

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
  if (e.code === 'KeyN') { toggleMute(); world.toast(isMuted() ? 'SOUND OFF' : 'SOUND ON'); }
  if (e.code === 'KeyL' && ui.menu) doLink();
  if (e.code === 'Escape' || e.code === 'KeyP') toggleMenu();
  if (ui.menu) {
    if (e.code === 'ArrowLeft') { ui.tab = (ui.tab + 2) % 3; ui.sel = 0; }
    if (e.code === 'ArrowRight') { ui.tab = (ui.tab + 1) % 3; ui.sel = 0; }
    if (e.code === 'ArrowUp') ui.sel = Math.max(0, ui.sel - 1);
    if (e.code === 'ArrowDown') ui.sel++;
    if (e.code === 'Enter' && ui.tab === 1) replaySelected();
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyQ') cycleWeapon();
  if (/^Digit[1-4]$/.test(e.code)) {
    const w2 = WEAPON_ORDER[+e.code.slice(5) - 1];
    if (w2 === 'pistol' || (world.ammo[w2] || 0) > 0) world.player.weaponId = w2;
  }
  if (e.code === 'Tab') { e.preventDefault(); ui.map = !ui.map; }
});
addEventListener('keyup', (e) => keys.delete(e.code));

// Mouse aim. Shooting used to fire along the facing direction in eight steps,
// which meant you could not hit anything you were not already walking at. The
// cursor is converted to a world point and the player aims at it.
const mouse = { sx: 0, sy: 0, down: false, has: false };
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top; mouse.has = true;
});
cv.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; });
addEventListener('mouseup', () => { mouse.down = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());

// World-space aim vector for the player this frame.
function aimVector() {
  const p = world.player;
  // Touch and gamepad-less play get auto-aim at the nearest hostile — thumb
  // controls can't aim, and without this the mobile build is unplayable.
  if (!mouse.has || touch.active || touch.fire) {
    const t = world.nearestHostile(p.x, p.y, 16);
    if (t) { const d = Math.hypot(t.x - p.x, t.y - p.y) || 1; return [(t.x - p.x) / d, (t.y - p.y) / d]; }
    const f = FACE_VEC[p.dir] || [0, 1];
    return f;
  }
  const wp = toWorld(mouse.sx - VW / 2 + cam.x, mouse.sy - VH / 2 + cam.y);
  const dx = wp.x - p.x, dy = wp.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
const FACE_VEC = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7],
};

function readInput() {
  input.up = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  input.down = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  input.left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  input.right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  input.fire = keys.has('Space') || mouse.down;
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

// --- weapons --------------------------------------------------------------
// Tiers unlock through the campaign and from street pickups. Damage per second
// is deliberately close across the set; what changes is range, spread and how
// they handle, so the choice is about the situation rather than a strict upgrade.
export const WEAPONS = {
  pistol:  { name: 'Pistol',  cd: 0.20, dmg: 22, pellets: 1, spread: 0.05, shake: 1.4, ammo: Infinity },
  smg:     { name: 'SMG',     cd: 0.08, dmg: 12, pellets: 1, spread: 0.16, shake: 1.1, ammo: 240 },
  shotgun: { name: 'Shotgun', cd: 0.62, dmg: 15, pellets: 6, spread: 0.55, shake: 4.2, ammo: 40 },
  rifle:   { name: 'Rifle',   cd: 0.30, dmg: 42, pellets: 1, spread: 0.02, shake: 2.6, ammo: 90 },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];

function toggleMenu() {
  ui.menu = ui.menu ? null : 'pause';
  setPaused(!!ui.menu);
  if (ui.menu) {
    // pull fresh server data each time it opens — the leaderboard and the
    // points ledger are both server-authoritative, so there is nothing local
    // worth showing instead.
    api.leaderboard().then((r) => { ui.board = r; }).catch(() => { ui.board = []; });
    api.profile().then((pr) => {
      ui.ledger = pr.ledger || [];
      if (typeof pr.points === 'number') world.points = pr.points;
    }).catch(() => { ui.ledger = []; });
  }
}

// Link flow, driven from the pause menu. Every failure mode gets a readable
// line rather than a silent no-op: no wallet installed, the signature refused,
// a stale nonce. A points system whose linking step fails invisibly is worse
// than one that has no linking step at all.
async function doLink() {
  if (ui.linkBusy) return;
  if (isLinked()) {
    ui.linkBusy = true;
    await unlinkWallet();
    ui.walletAddr = null;
    ui.linkState = 'unlinked';
    ui.linkBusy = false;
    world.toast('WALLET UNLINKED');
    return;
  }
  ui.linkBusy = true;
  ui.linkState = 'check your wallet…';
  try {
    const res = await linkWallet();
    ui.walletAddr = res.wallet;
    ui.linkState = null;
    world.points = res.points ?? world.points;
    world.toast(res.migrated
      ? `WALLET LINKED — ${res.migrated} pts carried over`
      : 'WALLET LINKED');
    sfx('good');
    api.profile().then((pr) => { ui.ledger = pr.ledger || []; }).catch(() => {});
  } catch (err) {
    ui.linkState = String(err?.message || 'link failed').slice(0, 34);
    sfx('bad');
  } finally {
    ui.linkBusy = false;
  }
}

// Replaying a finished mission re-runs it for practice. It pays no points, and
// not because the client withholds them: the ledger is keyed (wallet, type,
// ref), so the server has already recorded mission N and simply ignores it the
// second time. Worth surfacing in the UI so the rule is visible, not a trap.
function replaySelected() {
  const done = MISSIONS.filter((m) => campaign.completed.includes(m.id));
  const next = campaign.available();
  const list = next ? [...done, next] : done;
  const m = list[Math.min(ui.sel, list.length - 1)];
  if (!m) return;
  if (campaign.active) { world.toast('Finish the current job first.'); return; }
  ui.menu = null;
  campaign.start(m);
}

function cycleWeapon() {
  const have = WEAPON_ORDER.filter((w) => w === 'pistol' || (world.ammo[w] || 0) > 0);
  const i = have.indexOf(world.player.weaponId || 'pistol');
  world.player.weaponId = have[(i + 1) % have.length];
  world.toast(WEAPONS[world.player.weaponId].name);
}

// --- world ----------------------------------------------------------------
const ui = {
  map: false, toasts: [], brief: null, briefT: 0,
  menu: null,          // null | 'pause'
  tab: 0,              // 0 stats · 1 missions · 2 leaderboard
  sel: 0,
  hint: null, hintT: 0,   // one transient line at the bottom of the screen
  linkState: null, linkBusy: false, walletAddr: null,
  board: null,         // cached leaderboard rows
  ledger: null,        // cached points ledger
};

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
  parts: [],          // blood, sparks, brass, smoke
  blasts: [],         // expanding shockwave rings
  // free-play bookkeeping — all of these feed server-priced point events
  rampage: { kills: 0, t: 0 },
  stealth: null,      // { on, blown, seen } while a stealth objective is live
  hostage: null,      // a crew member bleeding out (mission 9)
  andyDead: false,
  jacked: new Set(),
  peakWanted: 0,
  ammo: {},
  shake: 0,           // screen shake magnitude
  hitstop: 0,         // brief freeze on a kill, so hits land

  sfx(kind, arg) { sfx(kind, arg); },

  toast(text) { ui.toasts.push({ text, t: 3.4 }); },

  // A prompt rather than a notification — it re-arms every frame the condition
  // holds and fades the moment it stops, so it never queues up behind toasts.
  hint(text) { ui.hint = text; ui.hintT = 0.25; },

  get campaignActive() { return !!campaign?.active; },
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

  onAlarm() {
    this.toast('SPOTTED — it just went loud');
    sfx('hit');
    this.shake = Math.max(this.shake, 4);
  },

  claimed(id) {
    sendEvent('district', id).catch(() => {});
  },

  // The ref is the drop site plus a second-resolution stamp: unique enough that
  // two different runs never collide, stable enough that a retry after a
  // dropped connection lands on the same ledger row instead of paying twice.
  onDelivery(siteId) {
    sendEvent('delivery', `${siteId}-${Math.floor(Date.now() / 1000)}`).catch(() => {});
    this.award(60, 'Delivery');
  },

  onMissionComplete(m) {
    sendEvent('mission', String(m.id)).catch(() => {});
    ui.brief = null;
    if (m.id === MISSIONS.length) this.toast('THE BLOCK BELONGS TO THE BOYZ');
  },
  onMissionFail() { this.despawnMissionEnemies(); sfx('bad'); },
};

// Impact particles. Cheap, short-lived, and the single biggest contributor to
// whether shooting feels like it connects.
function burst(x, y, n, col, spd = 6, life = 0.45, z = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random());
    world.parts.push({
      x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + Math.random() * 4,
      life, max: life, col, size: 1 + Math.random() * 1.6,
    });
  }
}
function stepParts(dt) {
  for (const q of world.parts) {
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.z += q.vz * dt; q.vz -= 14 * dt;
    if (q.z < 0) { q.z = 0; q.vz *= -0.35; q.vx *= 0.6; q.vy *= 0.6; }
    q.vx *= 1 - dt * 2.2; q.vy *= 1 - dt * 2.2;
    q.life -= dt;
  }
  world.parts = world.parts.filter((q) => q.life > 0);
  if (world.parts.length > 320) world.parts.splice(0, world.parts.length - 320);
}

// An explosion: radius damage to people and cars (so wrecks chain), a fireball,
// smoke, and a shove on anything close. Chains are capped by the wreck timer —
// each car has to burn for a couple of seconds before it goes, so a pile-up
// cooks off in sequence rather than all at once.
function explode(x, y) {
  const R = 4.2;
  burst(x, y, 26, '#ffd45c', 11, 0.6, 1);
  burst(x, y, 18, '#ff7a2a', 7, 0.9, 1.4);
  burst(x, y, 14, '#3a3a44', 4, 1.6, 2);
  world.shake = Math.max(world.shake, 9);
  world.hitstop = Math.max(world.hitstop, 0.05);
  world.panic = 6;
  world.blasts.push({ x, y, t: 0 });
  sfx('boom');
  for (const e of world.people) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > R) continue;
    const f = 1 - d / R;
    e.hp -= 90 * f;
    e.x += ((e.x - x) / (d || 1)) * f * 1.6;
    e.y += ((e.y - y) / (d || 1)) * f * 1.6;
    if (e.hp <= 0) { e.dead = true; onKill(e); }
  }
  for (const c of world.cars) {
    if (c.exploded) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d > R + 1) continue;
    c.hp -= 70 * (1 - d / (R + 1));
    if (c.hp <= 0 && !c.dead) { c.dead = true; c.speed = 0; }
  }
}

let campaign;
let hustle;

function enterCar(c) {
  const p = world.player;
  p.inCar = c; c.driver = p; c.ai = null;
  // Every distinct vehicle boosted pays a small bounty, capped server-side.
  if (!world.jacked.has(c.id)) {
    world.jacked.add(c.id);
    world.award(15, 'Whip boosted');
    sendEvent('carjack', `${getWalletId().slice(-6)}-${c.id}`).catch(() => {});
  }
  world.toast(`${c.className || 'Whip'} acquired`);
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

// --- audio ----------------------------------------------------------------
// All of it lives in audio.js; this is the seam the rest of the game calls
// through, kept so every existing sfx('kind') call site still works.
function sfx(kind, arg) { audioSfx(kind, arg); }

// --- update ---------------------------------------------------------------
function update(dt) {
  if (ui.menu) { readInput(); return; }
  // Hitstop: a few frames of frozen time when you land a kill. Costs nothing
  // and is most of why a hit reads as a hit.
  if (world.hitstop > 0) { world.hitstop -= dt; return; }
  world.shake *= 1 - Math.min(1, dt * 9);
  if (world.shake < 0.05) world.shake = 0;
  stepParts(dt);
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
    // Tyres let go when the heading is being forced round faster than the
    // car's grip wants at speed. One skid per slide, not one per frame.
    const slip = Math.abs(steer) * Math.min(1, Math.abs(c.speed) / (c.topSpeed || 16));
    if (slip > 0.62 && Math.abs(c.speed) > 6) {
      world.skidT = (world.skidT || 0) - dt;
      if (world.skidT <= 0) { world.skidT = 0.3; sfx('skid', slip); }
    } else world.skidT = 0;
    stepCar(c, dt, throttle, steer);
    p.x = c.x; p.y = c.y;
    if (c.dead) { exitCar(); p.hp -= 25; world.toast('Bail out!'); }
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
      let wid = p.weaponId || 'pistol';
      if (wid !== 'pistol' && (world.ammo[wid] || 0) <= 0) { wid = 'pistol'; p.weaponId = 'pistol'; }
      const wpn = WEAPONS[wid];
      if (wid !== 'pistol') world.ammo[wid]--;
      p.fireCd = wpn.cd;
      p.flash = 0.05;
      const [ax, ay] = aimVector();
      p.dir = dirFromVec(ax, ay);            // face what you're shooting at
      for (let i = 0; i < wpn.pellets; i++) {
        const sp = wpn.spread * (Math.random() - 0.5);
        const cs = Math.cos(sp), sn = Math.sin(sp);
        world.bullets.push(makeBullet(p.x, p.y, ax * cs - ay * sn, ax * sn + ay * cs, 'player', wpn.dmg));
      }
      // A gunshot ends any stealth attempt outright, wherever you are.
      if (world.stealth && !world.stealth.blown) {
        world.stealth.blown = true;
        for (const e of world.people) if (e.passive) { e.passive = false; e.alerted = true; }
        world.onAlarm();
      }
      burst(p.x + ax * 0.6, p.y + ay * 0.6, 2, '#ffd45c', 3, 0.25);   // brass
      world.shake = Math.max(world.shake, wpn.shake);
      world.panic = 4;
      sfx('shot', world.player.weaponId || 'pistol');
    }
  }
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.flash > 0) p.flash -= dt;
  if (world.panic > 0) world.panic -= dt;
  for (const e of world.people) if (e.hurt > 0) e.hurt -= dt;
  // a downed crew member bleeds out on a timer — reach them or lose them
  const hg = world.hostage;
  if (hg && !hg.dead && hg.hostage) {
    hg.bleed -= dt;
    world.hudTimer = Math.max(0, hg.bleed);
    if (hg.bleed <= 0) { hg.dead = true; world.toast('ANDY BLED OUT'); }
  }

  // vehicle physics: separate cars, then cook off anything wrecked
  resolveCarCollisions(world.cars, (a, b, ix, iy, rel) => {
    burst(ix, iy, Math.min(10, 2 + rel), '#ffd45c', 5, 0.3, 0.8);
    if (rel > 8) world.shake = Math.max(world.shake, Math.min(6, rel * 0.4));
    if (a.driver === p || b.driver === p) p.hp -= Math.max(0, rel - 9) * 1.4;
    sfx('crash', rel / 9);
  });
  for (const c of world.cars) {
    if (c.dead && !c.exploded) {
      // smoke while it burns down
      if (Math.random() < dt * 14) burst(c.x, c.y, 1, '#4a4a54', 1.5, 1.2, 1);
      if (c.burn > 1.6 && Math.random() < dt * 20) burst(c.x, c.y, 1, '#ff7a2a', 2, 0.5, 1);
    }
    stepWreck(c, dt, (car) => explode(car.x, car.y));
  }
  world.cars = world.cars.filter((c) => !c.exploded || (c.burn += dt) < 6);
  for (const bl of world.blasts) bl.t += dt;
  world.blasts = world.blasts.filter((bl) => bl.t < 0.5);

  // entities
  for (const c of world.cars) {
    if (c.driver) continue;
    if (c.ai === 'traffic') {
      stepTrafficCar(c, dt, world.cars, world.t);
      // A background car that has been pinned for a few seconds is stuck on
      // geometry no steering rule will get it off. Recycle it onto a road
      // rather than leaving a dead prop in the middle of the city.
      // A car sitting at a red is stopped on purpose — recycling it teleports
      // queues away and makes the signals look broken.
      if (Math.abs(c.speed) < 0.6 && !c.waiting) {
        c.stuck = (c.stuck || 0) + dt;
        if (c.stuck > 3) {
          const r = nearestRoad(p.x + (Math.random() - 0.5) * 70, p.y + (Math.random() - 0.5) * 70);
          c.x = r.x; c.y = r.y; c.speed = 4; c.stuck = 0; c.axis = null;
        }
      } else c.stuck = 0;
    }
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
    if (solidAt(b.x, b.y)) { b.life = 0; burst(b.x, b.y, 3, '#ffd45c', 4, 0.22, 1.2); continue; }
    for (const e of world.people) {
      if (e.dead || e.faction === b.faction) continue;
      if (b.faction === 'player' && e.faction === 'crew') continue;
      if (b.faction === 'crew' && (e.faction === 'player' || e.faction === 'crew')) continue;
      if ((b.faction === 'cabal' || b.faction === 'cop') && (e.faction === 'cabal' || e.faction === 'cop')) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < 0.8) {
        e.hp -= b.dmg; b.life = 0;
        // impact: blood, a shove along the bullet, and a flash of hit colour
        const l = Math.hypot(b.vx, b.vy) || 1;
        burst(e.x, e.y, 5, '#c2242e', 5, 0.4, 1);
        e.x += (b.vx / l) * 0.18; e.y += (b.vy / l) * 0.18;
        e.hurt = 0.12;
        if (e.hp <= 0) {
          e.dead = true;
          burst(e.x, e.y, 12, '#8c1a22', 7, 0.7, 1);
          if (b.faction === 'player') { world.hitstop = 0.045; world.shake = Math.max(world.shake, 3); }
          onKill(e);
        }
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
      else if (pk.type === 'health') { p.hp = Math.min(100, p.hp + 35); world.toast('+35 HP'); }
      else if (pk.type === 'weapon') {
        p.weaponId = pk.weapon;
        world.ammo[pk.weapon] = (world.ammo[pk.weapon] || 0) + WEAPONS[pk.weapon].ammo;
        world.toast(`${WEAPONS[pk.weapon].name} acquired`);
      } else world.toast(pk.label || 'Collected');
    }
  }
  world.pickups = world.pickups.filter((pk) => {
    if (pk.taken) return pk.type === 'objective';
    if (pk.type === 'objective') return true;
    return Math.hypot(pk.x - p.x, pk.y - p.y) < 90;
  });

  // escaping heat pays, and staying alive under it pays a trickle
  if (world.wanted > world.peakWanted) world.peakWanted = world.wanted;
  if (world.wanted > 0) {
    world.surviveT = (world.surviveT || 0) + dt;
    if (world.surviveT >= 300) {
      world.surviveT = 0;
      world.award(45, 'Survived the heat');
      sendEvent('survive', `${Math.floor(Date.now() / 1000)}`).catch(() => {});
    }
  } else if (world.peakWanted >= 3) {
    world.award(90, `Lost ${world.peakWanted} stars`);
    sendEvent('escape', `${Math.floor(Date.now() / 1000)}`).catch(() => {});
    world.peakWanted = 0; world.surviveT = 0;
  } else {
    world.peakWanted = 0;
  }

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

  // Pay & Spray: drive in with heat on you and it comes off for cash.
  if (p.inCar && world.wanted > 0) {
    for (const g of GARAGES) {
      if (Math.hypot(p.x - g.x, p.y - g.y) > 2.6) continue;
      const cost = 200 * world.wanted;
      if (world.cash >= cost) {
        world.cash -= cost;
        const shed = world.wanted;
        world.wanted = 0; world.wantedDecay = 0;
        // clear the pursuit so it doesn't instantly re-acquire
        for (const c of world.cars) if (c.ai === 'chase') c.ai = 'traffic';
        world.people = world.people.filter((e) => e.faction !== 'cop');
        if (world.peakWanted >= 3) {
          world.award(90, `Lost ${world.peakWanted} stars`);
          sendEvent('escape', `${Math.floor(Date.now() / 1000)}`).catch(() => {});
        }
        world.peakWanted = 0;
        world.toast(`Resprayed — ${shed} stars gone, -$${cost}`);
        sfx('good');
      } else {
        world.toast(`Respray costs $${cost}`);
      }
      break;
    }
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
  // keep a few weapon/health crates on the street near the player
  if (world.pickups.filter((q) => q.type === 'weapon' || q.type === 'health').length < 5) {
    const tries = 12;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 34;
      const px2 = p.x + Math.cos(a) * r, py2 = p.y + Math.sin(a) * r;
      if (solidAt(px2, py2)) continue;
      const roll = Math.random();
      if (roll < 0.32) world.pickups.push(makePickup(px2, py2, 'health', 'Health'));
      else {
        const w2 = WEAPON_ORDER[1 + ((Math.random() * 3) | 0)];
        const pk = makePickup(px2, py2, 'weapon', WEAPONS[w2].name);
        pk.weapon = w2;
        world.pickups.push(pk);
      }
      break;
    }
  }
  if (world.people.filter((e) => e.faction === 'ped').length < 18) spawnPeds(world, 6);
  if (world.cars.filter((c) => c.ai === 'traffic').length < 12) spawnTraffic(world, 4);

  campaign.update(dt);
  updateCamera(dt);

  // player death -> respawn at the Pump Lounge
  if (p.hp <= 0) {
    // respawn at the nearest safehouse you actually control, not always home
    let best = SAFEHOUSES[0], bd = 1e9;
    for (const sh of SAFEHOUSES) {
      if (sh.district && !isOwned(sh.district)) continue;
      const d = Math.hypot(sh.x - p.x, sh.y - p.y);
      if (d < bd) { bd = d; best = sh; }
    }
    p.hp = 100; p.x = best.x; p.y = best.y + 3;
    if (p.inCar) exitCar();
    world.wanted = 0;
    world.cash = Math.max(0, world.cash - 500);
    world.toast('Wasted — patched up. -$500');
    if (hustle?.carrying) hustle.abandon('Wasted with the cargo');
  }

  // side hustles run in the gaps between missions
  hustle.update(dt);

  // Continuous audio: the engine tracks the car you are actually in, the city
  // bed rises with heat, and one siren voice carries the nearest pursuer
  // rather than one per cop car — a dozen overlapping wails is just noise.
  audioEngine(p.inCar && !p.inCar.dead ? p.inCar : null);
  ambience(world.wanted);
  let nearSiren = null;
  for (const c of world.cars) {
    if (!c.siren || c.dead) continue;
    const sd = Math.hypot(c.x - p.x, c.y - p.y);
    if (nearSiren == null || sd < nearSiren) nearSiren = sd;
  }
  siren(nearSiren);

  for (const t of ui.toasts) t.t -= dt;
  ui.toasts = ui.toasts.filter((t) => t.t > 0).slice(-4);
  if (ui.briefT > 0) { ui.briefT -= dt; if (ui.briefT <= 0) ui.brief = null; }
  if (ui.hintT > 0) { ui.hintT -= dt; if (ui.hintT <= 0) ui.hint = null; }
}

function onKill(e) {
  if (e.faction === 'cabal') {
    world.award(25, 'Cabal down');
    world.panic = 4;
    // rampage: ten of them inside a rolling minute
    if (world.t - world.rampage.t > 60) { world.rampage.kills = 0; world.rampage.t = world.t; }
    world.rampage.kills++;
    if (world.rampage.kills >= 10) {
      world.rampage.kills = 0; world.rampage.t = world.t;
      world.award(120, 'RAMPAGE');
      sendEvent('rampage', `${Math.floor(Date.now() / 1000)}`).catch(() => {});
    }
    if (!world.firstBlood) {
      world.firstBlood = true;
      sendEvent('firstblood', 'x').catch(() => {});
    }
  }
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

      // RULE 3 — slab construction. Grout every TWO cells so paving reads as
      // big slabs rather than a busy per-cell checker, with a lit lip on the
      // far side of each seam. Same pass the abbey's flagstone floor uses.
      if (sf === SURF.PAVE || sf === SURF.LOT) {
        const seamS = toScreen(x, y + 1), seamE = toScreen(x + 1, y + 1);
        const lipN = toScreen(x, y), lipE = toScreen(x + 1, y);
        if (y % 2 === 1) {
          g.strokeStyle = R.o; g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(seamS.x, seamS.y); g.lineTo(seamE.x, seamE.y); g.stroke();
        } else {
          g.strokeStyle = shade(R.b, 14); g.lineWidth = 1;
          g.beginPath(); g.moveTo(lipN.x, lipN.y); g.lineTo(lipE.x, lipE.y); g.stroke();
        }
        const seamW = toScreen(x + 1, y), seamSW = toScreen(x + 1, y + 1);
        if (x % 2 === 1) {
          g.strokeStyle = R.d; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(seamW.x, seamW.y); g.lineTo(seamSW.x, seamSW.y); g.stroke();
        }
        // mica fleck / hairline crack, sparse
        if (n % 23 === 0) {
          const c0 = toScreen(x + 0.5, y + 0.5);
          g.fillStyle = R.h; g.fillRect(c0.x - 1, c0.y - 1, 2, 2);
        }
      }
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

  // RULE 4 — contact shadow. The ground darkens hard where it meets a building,
  // and each block casts a soft shadow to the south-east (away from the
  // upper-left key light everything else in the game is lit by). This is the
  // cheapest depth cue there is and its absence was why the city read as
  // boxes sitting ON a floor rather than buildings standing IN one.
  for (const bl of BUILDINGS) {
    // cast shadow: the footprint, offset away from the light
    const off = 0.55 + Math.min(2.2, bl.h * 0.08);
    g.save();
    g.globalAlpha = 0.42;
    drawQuad(g, bl.x + off, bl.y + off, bl.w, bl.d, '#02040a');
    g.restore();
  }
  // hard contact band on the ground cells immediately around each footprint
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (height[idx(x, y)] > 0) continue;
      const up = y > 0 && height[idx(x, y - 1)] > 0;
      const left = x > 0 && height[idx(x - 1, y)] > 0;
      const right = x < CW - 1 && height[idx(x + 1, y)] > 0;
      const down = y < CH - 1 && height[idx(x, y + 1)] > 0;
      if (!up && !left && !right && !down) continue;
      g.save();
      g.globalAlpha = up || left ? 0.34 : 0.18;
      drawQuad(g, x, y, 1, 1, '#01030a');
      g.restore();
    }
  }

  // Buildings are NOT baked. They have to sort against cars and people every
  // frame or the whole city draws on top of them — see drawBuilding().

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

  const shx = world.shake ? (Math.random() - 0.5) * world.shake * 2 : 0;
  const shy = world.shake ? (Math.random() - 0.5) * world.shake * 2 : 0;
  ctx.save();
  ctx.translate(VW / 2 - cam.x + shx, VH / 2 - cam.y + shy);
  ctx.drawImage(cityCanvas, cityOx, cityOy);
  drawSignals();

  // --- depth-sorted layer: buildings, entities and effects together ---
  const items = [];
  const anchor = world.player.inCar ? world.player.inCar : world.player;
  const ps = toScreen(anchor.x, anchor.y, 0);
  const pDepth = depth(anchor.x, anchor.y, 0);
  // cull to a generous screen box so tall towers still enter from off-screen
  const viewL = cam.x - VW / 2 - 200, viewR = cam.x + VW / 2 + 200;
  const viewT = cam.y - VH / 2 - 400, viewB = cam.y + VH / 2 + 200;
  for (const b of BUILDINGS) {
    const bb = buildingBounds(b);
    if (bb.x1 < viewL || bb.x0 > viewR || bb.y1 < viewT || bb.y0 > viewB) continue;
    // its near corner is what decides whether an entity is in front of it
    const d = depth(b.x + b.w, b.y + b.d, 0) - 1;
    const hides = d > pDepth
      && ps.x > bb.x0 - 2 && ps.x < bb.x1 + 2 && ps.y > bb.y0 - 2 && ps.y < bb.y1 + 2;
    items.push({ d, f: () => drawBuilding(b, hides) });
  }
  for (const pk of world.pickups) if (!pk.taken) items.push({ d: depth(pk.x, pk.y), f: () => drawPickup(pk) });
  for (const c of world.cars) items.push({ d: depth(c.x, c.y, 0.6), f: () => drawCarEnt(c) });
  for (const e of world.people) {
    if (e.inCar) continue;
    items.push({ d: depth(e.x, e.y, 1), f: () => drawPersonEnt(e) });
  }
  for (const b of world.bullets) items.push({ d: depth(b.x, b.y, 1.2), f: () => drawBullet(b) });
  for (const q of world.parts) items.push({ d: depth(q.x, q.y, q.z), f: () => drawPart(q) });
  for (const bl of world.blasts) items.push({ d: depth(bl.x, bl.y, 3), f: () => drawBlast(bl) });
  for (const g of GARAGES) {
    if (Math.hypot(g.x - world.player.x, g.y - world.player.y) > 40) continue;
    items.push({ d: depth(g.x, g.y, 0.1), f: () => drawGarage(g) });
  }
  for (const sh of SAFEHOUSES) {
    if (Math.hypot(sh.x - world.player.x, sh.y - world.player.y) > 40) continue;
    if (sh.district && !isOwned(sh.district)) continue;
    items.push({ d: depth(sh.x, sh.y, 0.1), f: () => drawSafehouse(sh) });
  }
  if (hustle?.job?.stage === 'offer') {
    items.push({ d: depth(hustle.job.x, hustle.job.y, 0.5), f: () => hustle.draw(ctx, world.t) });
  }
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
  if (ui.menu) drawMenu();
}

// Traffic signals, painted on the road rather than hung on masts. At this
// scale and this camera angle a signal head would be three pixels of nothing;
// a bar across the mouth of the junction reads instantly from above, and it is
// how a 16-bit game would have solved it.
//
// Drawn flat on the ground before the depth-sorted pass, so cars sit on top of
// the markings rather than being occluded by them.
function drawSignals() {
  const p = world.player;
  const R = 30;
  const j0x = Math.max(0, Math.floor((p.x - R) / ROAD_PITCH));
  const j1x = Math.min(Math.floor(CW / ROAD_PITCH), Math.ceil((p.x + R) / ROAD_PITCH));
  const j0y = Math.max(0, Math.floor((p.y - R) / ROAD_PITCH));
  const j1y = Math.min(Math.floor(CH / ROAD_PITCH), Math.ceil((p.y + R) / ROAD_PITCH));
  // RULE 5 — the city already spends its saturated accent on turf neon, and a
  // green go-bar in the same lime family reads as a district border. So only
  // the STOP bar is saturated; an open approach is a pale road marking, which
  // is what it would be in a real street anyway.
  const GO = '#8fa0bc', STOP = NEON.blackbulls.mid;

  for (let jy = j0y; jy <= j1y; jy++) {
    for (let jx = j0x; jx <= j1x; jx++) {
      const bx = jx * ROAD_PITCH, by = jy * ROAD_PITCH;
      if (bx < 1 || by < 1 || bx + ROAD_W >= CW || by + ROAD_W >= CH) continue;
      if (!isSignalled(jx, jy)) continue;
      if (surfaceAt(bx + 0.5, by + 0.5) !== SURF.ROAD) continue;
      const ph = junctionPhase(jx, jy, world.t);
      // Amber shows as the green bar dimmed and pulsing, so a driver gets the
      // same warning the AI acts on.
      const pulse = ph.amber ? 0.35 + Math.abs(Math.sin(world.t * 7)) * 0.4 : 1;
      for (const axis of ['x', 'y']) {
        const open = ph.green === axis;
        const col = open ? GO : STOP;
        const a = open ? 0.2 * pulse : 0.5;
        // one bar across each of the two approaches on this axis
        for (const side of [-1, 1]) {
          const t0 = side < 0 ? -0.42 : ROAD_W;
          if (axis === 'x') drawQuad(ctx, bx + t0, by, 0.42, ROAD_W, withAlpha(col, a));
          else drawQuad(ctx, bx, by + t0, ROAD_W, 0.42, withAlpha(col, a));
        }
      }
    }
  }
}

// Buildings draw in the sorted pass so cars and people can pass behind them.
// Any building that would hide the player is drawn translucent — full occlusion
// in a dense grid city means you spend half the game behind a wall.
function drawBuilding(b, xray) {
  if (xray) { ctx.save(); ctx.globalAlpha = 0.30; }
  drawBox(ctx, BUILDING, b.x, b.y, b.w, b.d, b.h);
  // lit windows on the two visible faces
  const n = b.seed;
  for (let f = 0; f < 2; f++) {
    const span = f ? b.d : b.w;
    for (let wz = 1; wz < b.h - 0.5; wz += 1.6) {
      for (let wo = 0.6; wo < span - 0.4; wo += 1.4) {
        if (((n + wo * 31 + wz * 17) | 0) % 7 > 3) continue;
        const p1 = f ? toScreen(b.x, b.y + wo, wz) : toScreen(b.x + wo, b.y + b.d, wz);
        ctx.fillStyle = ((n + wo + wz) | 0) % 5 === 0 ? 'rgba(255,210,130,0.55)' : 'rgba(150,190,230,0.25)';
        ctx.fillRect(p1.x - 1.5, p1.y - 3, 3, 3);
      }
    }
  }
  if (xray) ctx.restore();
}

// Screen-space bounds of a building's silhouette, for the occlusion test.
function buildingBounds(b) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [cx, cy] of [[0, 0], [b.w, 0], [b.w, b.d], [0, b.d]]) {
    for (const cz of [0, b.h]) {
      const p1 = toScreen(b.x + cx, b.y + cy, cz);
      if (p1.x < x0) x0 = p1.x; if (p1.x > x1) x1 = p1.x;
      if (p1.y < y0) y0 = p1.y; if (p1.y > y1) y1 = p1.y;
    }
  }
  return { x0, y0, x1, y1 };
}

function drawPickup(pk) {
  const s = toScreen(pk.x, pk.y, 0);
  const bob = Math.sin(world.t * 3 + pk.bob) * 3;
  const col = pk.type === 'objective' ? NEON.boyz
    : pk.type === 'health' ? NEON.neets
      : pk.type === 'weapon' ? NEON.tungtungs : NEON.jimothys;
  pointLight(ctx, s.x, s.y, 22, col.mid, 0.3);
  ctx.fillStyle = col.deep;
  ctx.fillRect(s.x - 5, s.y - 10 + bob, 10, 10);
  ctx.fillStyle = col.mid;
  ctx.fillRect(s.x - 4, s.y - 9 + bob, 8, 8);
  ctx.fillStyle = col.core;
  ctx.fillRect(s.x - 4, s.y - 9 + bob, 8, 2);
}

function drawBlast(bl) {
  const s = toScreen(bl.x, bl.y, 0.6);
  const k = bl.t / 0.5;
  const r = 8 + k * 74;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1 - k;
  const g = ctx.createRadialGradient(s.x, s.y, r * 0.35, s.x, s.y, r);
  g.addColorStop(0, 'rgba(255,240,190,0.85)');
  g.addColorStop(0.4, 'rgba(255,140,40,0.5)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * (TH / TW), 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// A spray bay: open front, neon sign, and a floor pad you drive onto.
function drawGarage(g) {
  const col = NEON.tungtungs;
  drawQuad(ctx, g.x - 1.6, g.y - 1.6, 3.2, 3.2, withAlpha(col.deep, 0.45));
  ctx.strokeStyle = col.mid; ctx.lineWidth = 1.4;
  const pts = projectPath([[g.x - 1.6, g.y - 1.6], [g.x + 1.6, g.y - 1.6],
    [g.x + 1.6, g.y + 1.6], [g.x - 1.6, g.y + 1.6], [g.x - 1.6, g.y - 1.6]]);
  neonLine(ctx, pts, col, 1.4, 0.8);
  const s = toScreen(g.x, g.y, 0);
  pointLight(ctx, s.x, s.y, 30, col.mid, 0.22);
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = col.core;
  ctx.fillText('PAY & SPRAY', s.x, s.y - 26);
  ctx.textAlign = 'left';
}

function drawSafehouse(sh) {
  const col = NEON.boyz;
  const pts = projectPath([[sh.x - 1.4, sh.y - 1.4], [sh.x + 1.4, sh.y - 1.4],
    [sh.x + 1.4, sh.y + 1.4], [sh.x - 1.4, sh.y + 1.4], [sh.x - 1.4, sh.y - 1.4]]);
  neonLine(ctx, pts, col, 1.2, 0.7);
  const s = toScreen(sh.x, sh.y, 0);
  pointLight(ctx, s.x, s.y, 24, col.mid, 0.18);
  ctx.font = 'bold 7px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = col.core;
  ctx.fillText(sh.name.toUpperCase(), s.x, s.y - 22);
  ctx.textAlign = 'left';
}

function drawPart(q) {
  const s = toScreen(q.x, q.y, q.z);
  ctx.globalAlpha = Math.max(0, Math.min(1, q.life / q.max));
  ctx.fillStyle = q.col;
  ctx.fillRect(s.x - q.size / 2, s.y - q.size / 2, q.size, q.size);
  ctx.globalAlpha = 1;
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
      { lights: false, len: c.len, wid: c.wid, ht: c.ht, cab: c.cab, glassW: c.glassW });
    const s = toScreen(c.x, c.y, 0.8);
    pointLight(ctx, s.x, s.y, 30 + Math.sin(world.t * 9) * 6, '#ff7a2a', 0.5);
    return;
  }
  drawCar(ctx, c.x, c.y, c.ang, c.paint, {
    siren: c.siren, sirenPhase: world.t, len: c.len, wid: c.wid, ht: c.ht,
    cab: c.cab, glassW: c.glassW, stripe: c.stripe, bed: c.bed, brake: c.braking,
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
  if (e.hurt > 0) {
    const s = toScreen(e.x, e.y, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, e.hurt * 6);
    ctx.fillStyle = '#ff5a5a';
    ctx.fillRect(s.x - 7, s.y - 30, 14, 30);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
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

  // objective — the campaign owns this line, and courier work borrows it when
  // no mission is running so there is only ever one thing to read up there.
  const label = campaign.objectiveLabel() || hustle?.label();
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
  const clock = world.hudTimer > 0 ? world.hudTimer : (hustle?.timer() || 0);
  if (clock > 0) {
    ctx.font = 'bold 17px "Courier New", monospace';
    ctx.fillStyle = clock < 10 ? '#e0233a' : '#f0ca4e';
    ctx.textAlign = 'center';
    ctx.fillText(clock.toFixed(1), VW / 2, pad + 46);
    ctx.textAlign = 'left';
  }
  // courier streak — only shown once it's actually multiplying the payout
  if (hustle?.streak > 1) {
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = '#f0ca4e';
    ctx.textAlign = 'center';
    ctx.fillText(`RUN STREAK x${(1 + hustle.streak * 0.25).toFixed(2)}`, VW / 2, pad + 62);
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

  // stealth indicator
  if (world.stealth) {
    const blown = world.stealth.blown;
    ctx.font = 'bold 11px "Courier New", monospace';
    const txt = blown ? 'DETECTED' : 'UNSEEN';
    const tw2 = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(6,10,18,0.8)';
    ctx.fillRect(VW / 2 - tw2 / 2 - 10, pad + 30, tw2 + 20, 20);
    ctx.strokeStyle = blown ? '#e0233a' : NEON.boyz.mid;
    ctx.strokeRect(VW / 2 - tw2 / 2 - 9.5, pad + 30.5, tw2 + 19, 19);
    ctx.fillStyle = blown ? '#ff7d8c' : NEON.boyz.core;
    ctx.textAlign = 'center';
    ctx.fillText(txt, VW / 2, pad + 44);
    ctx.textAlign = 'left';
  }

  // off-screen waypoints — the minimap only shows 46 cells, and a drop is
  // routinely twice that away
  {
    const tgt = world.marker
      || (world.markerEntity?.e && !world.markerEntity.e.dead ? world.markerEntity.e : null);
    if (tgt) drawWaypoint(tgt.x, tgt.y, NEON.boyz, tgt.label || 'GO');
    if (hustle?.job?.stage === 'offer') {
      drawWaypoint(hustle.job.x, hustle.job.y, { core: '#ffeeae', mid: '#f0ca4e', deep: '#7a5410' }, 'CARGO');
    }
  }

  drawMinimap();

  // vehicle readout — the class name and a condition bar, so you can tell at a
  // glance whether the whip you're in is about to cook off
  if (world.player.inCar) {
    const c = world.player.inCar;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = 'rgba(6,10,18,0.72)';
    ctx.fillRect(pad + 138, VH - pad - 16, 108, 12);
    const cond = Math.max(0, c.hp) / (c.maxHp || 100);
    ctx.fillStyle = cond > 0.5 ? '#8fe021' : cond > 0.25 ? '#f0a020' : '#e0233a';
    ctx.fillRect(pad + 139, VH - pad - 15, 106 * cond, 10);
    ctx.fillStyle = 'rgba(6,10,18,0.85)';
    ctx.fillText((c.className || 'CAR').toUpperCase(), pad + 143, VH - pad - 6);
    ctx.strokeStyle = 'rgba(180,200,230,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(pad + 138.5, VH - pad - 16.5, 108, 12);
  }

  // weapon + ammo readout
  {
    const wid = world.player.weaponId || 'pistol';
    const am = wid === 'pistol' ? '∞' : (world.ammo[wid] || 0);
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = 'rgba(6,10,18,0.72)';
    ctx.fillRect(pad, VH - pad - 38, 130, 18);
    ctx.fillStyle = '#f0ca4e';
    ctx.fillText(`${WEAPONS[wid].name}  ${am}`, pad + 6, VH - pad - 25);
    if (isMuted()) {
      ctx.fillStyle = 'rgba(160,175,205,0.7)';
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText('MUTE [N]', pad + 92, VH - pad - 25);
    }
  }

  // transient prompt (courier warnings, "need a car", …)
  if (ui.hint) {
    ctx.font = 'bold 11px "Courier New", monospace';
    const tw = ctx.measureText(ui.hint).width;
    ctx.fillStyle = 'rgba(6,10,18,0.82)';
    ctx.fillRect(VW / 2 - tw / 2 - 10, VH - 60, tw + 20, 19);
    ctx.strokeStyle = '#f0ca4e'; ctx.lineWidth = 1;
    ctx.strokeRect(VW / 2 - tw / 2 - 9.5, VH - 59.5, tw + 19, 18);
    ctx.fillStyle = '#ffeeae';
    ctx.textAlign = 'center';
    ctx.fillText(ui.hint, VW / 2, VH - 47);
    ctx.textAlign = 'left';
  }

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

// The pause screen: three tabs over the same frame. Stats, the mission board
// (which doubles as replay), and the live leaderboard.
function drawMenu() {
  ctx.fillStyle = 'rgba(4,6,11,0.93)';
  ctx.fillRect(0, 0, VW, VH);
  const W2 = Math.min(560, VW - 40), H2 = Math.min(430, VH - 40);
  const x0 = VW / 2 - W2 / 2, y0 = VH / 2 - H2 / 2;
  ctx.fillStyle = 'rgba(8,12,20,0.96)';
  ctx.fillRect(x0, y0, W2, H2);
  ctx.strokeStyle = NEON.boyz.mid; ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, W2 - 2, H2 - 2);

  const tabs = ['STATS', 'MISSIONS', 'LEADERBOARD'];
  ctx.font = 'bold 11px "Courier New", monospace';
  tabs.forEach((t, i) => {
    const tx = x0 + 18 + i * 150;
    const on = ui.tab === i;
    ctx.fillStyle = on ? NEON.boyz.core : 'rgba(150,165,195,0.45)';
    ctx.fillText(t, tx, y0 + 26);
    if (on) { ctx.fillStyle = NEON.boyz.mid; ctx.fillRect(tx, y0 + 31, ctx.measureText(t).width, 2); }
  });
  // help sits along the bottom edge — at the top right it collided with the
  // LEADERBOARD tab label on narrower viewports
  ctx.font = '9px "Courier New", monospace';
  ctx.fillStyle = 'rgba(140,155,185,0.55)';
  ctx.textAlign = 'center';
  ctx.fillText('← →  tabs    ↑ ↓  select    ENTER  start    L  wallet    ESC  close', x0 + W2 / 2, y0 + H2 - 14);
  ctx.textAlign = 'left';

  const bx = x0 + 18, by = y0 + 54, bw = W2 - 36;
  const listBottom = y0 + H2 - 30;

  if (ui.tab === 0) {
    const rows = [
      ['POINTS (server)', Math.floor(world.points)],
      ['Wallet', ui.linkState || (isLinked() ? `linked ${(ui.walletAddr || '').slice(0, 6)}…${(ui.walletAddr || '').slice(-4)}` : 'not linked — [L]')],
      ['Cash', '$' + Math.floor(world.cash)],
      ['Missions done', `${campaign.completed.length} / ${MISSIONS.length}`],
      ['Turf held', `${owned.size} / ${DISTRICTS.length}`],
      ['Turf income', `$${world.income}/s`],
      ['Whips boosted', world.jacked.size],
      ['Deliveries', `${hustle?.done || 0}${hustle?.streak > 1 ? ` (streak ${hustle.streak})` : ''}`],
      ['Wanted', '★'.repeat(world.wanted) || 'clean'],
      ['Crew', world.andyDead ? 'Andy is gone' : `${world.crew.length + 1} strong`],
    ];
    // The blocks below FLOW from the row count rather than sitting at fixed
    // offsets. Adding two rows to this list used to push it straight through
    // the explanatory paragraph underneath.
    const ROW_H = 19;
    ctx.font = '11px "Courier New", monospace';
    rows.forEach((r, i) => {
      ctx.fillStyle = 'rgba(160,175,205,0.75)';
      ctx.fillText(r[0], bx, by + 16 + i * ROW_H);
      ctx.fillStyle = i === 0 ? NEON.boyz.core : '#dbe4f5';
      ctx.textAlign = 'right';
      ctx.fillText(String(r[1]), bx + bw, by + 16 + i * ROW_H);
      ctx.textAlign = 'left';
    });
    let cy = by + 16 + rows.length * ROW_H + 12;
    ctx.fillStyle = 'rgba(140,155,185,0.5)';
    ctx.font = '9px "Courier New", monospace';
    cy = wrap(ctx, isLinked()
      ? 'Points are held by the server and are the basis for any future token distribution. This wallet is verified by signature, so it is payable.'
      : 'Points are held by the server and are the basis for any future token distribution. This is an anonymous account — press L to link a wallet by signature and carry these points over. Unlinked accounts are not payable.',
    bx, cy, bw, 12) + 14;
    if (ui.ledger?.length && cy < listBottom - 20) {
      ctx.fillStyle = NEON.boyz.mid;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText('RECENT LEDGER', bx, cy);
      ctx.font = '9px "Courier New", monospace';
      const room = Math.max(0, Math.floor((listBottom - cy - 6) / 13));
      ui.ledger.slice(0, Math.min(6, room)).forEach((l, i) => {
        ctx.fillStyle = 'rgba(160,175,205,0.7)';
        ctx.fillText(`${l.type} ${l.ref}`.slice(0, 34), bx, cy + 14 + i * 13);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#f0ca4e';
        ctx.fillText('+' + l.points, bx + bw, cy + 14 + i * 13);
        ctx.textAlign = 'left';
      });
    }
  } else if (ui.tab === 1) {
    const done = MISSIONS.filter((m) => campaign.completed.includes(m.id));
    const next = campaign.available();
    const list = next ? [...done, next] : done;
    ui.sel = Math.max(0, Math.min(ui.sel, Math.max(0, list.length - 1)));
    if (!list.length) {
      ctx.fillStyle = 'rgba(160,175,205,0.7)';
      ctx.font = '11px "Courier New", monospace';
      ctx.fillText('No jobs on the board yet. Head to the Pump Lounge.', bx, by + 20);
    }
    ctx.font = '11px "Courier New", monospace';
    list.forEach((m, i) => {
      const yy = by + 18 + i * 26;
      if (yy > listBottom) return;
      const isDone = campaign.completed.includes(m.id);
      const on = i === ui.sel;
      if (on) { ctx.fillStyle = 'rgba(143,224,33,0.12)'; ctx.fillRect(bx - 6, yy - 13, bw + 12, 22); }
      ctx.fillStyle = on ? NEON.boyz.core : isDone ? 'rgba(160,175,205,0.8)' : '#f0ca4e';
      ctx.fillText(`${String(m.id).padStart(2, '0')}  ${m.title}`, bx, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = isDone ? 'rgba(140,155,185,0.55)' : NEON.boyz.mid;
      ctx.fillText(isDone ? 'REPLAY · no points' : `NEW · ${m.points} pts`, bx + bw, yy);
      ctx.textAlign = 'left';
    });
  } else {
    ctx.font = '11px "Courier New", monospace';
    if (!ui.board) {
      ctx.fillStyle = 'rgba(160,175,205,0.7)';
      ctx.fillText('Loading…', bx, by + 20);
    } else if (!ui.board.length) {
      ctx.fillStyle = 'rgba(160,175,205,0.7)';
      ctx.fillText('Nobody on the board yet. Be first.', bx, by + 20);
    } else {
      ui.board.slice(0, 13).forEach((r, i) => {
        const yy = by + 18 + i * 22;
        ctx.fillStyle = i === 0 ? NEON.boyz.core : 'rgba(180,195,225,0.85)';
        ctx.fillText(`${String(i + 1).padStart(2, ' ')}.  ${String(r.name).slice(0, 16)}`, bx, yy);
        // An unverified account is a scratch run, not a payout claim. Saying so
        // on the board is the honest place for it — a leaderboard that hides
        // the difference implies every row is payable.
        if (!r.verified) {
          ctx.font = '9px "Courier New", monospace';
          ctx.fillStyle = 'rgba(150,165,195,0.45)';
          ctx.fillText('unlinked', bx + 170, yy);
          ctx.font = '11px "Courier New", monospace';
        }
        ctx.textAlign = 'right';
        ctx.fillStyle = r.verified ? '#f0ca4e' : 'rgba(240,202,78,0.45)';
        ctx.fillText(String(r.points), bx + bw, yy);
        ctx.textAlign = 'left';
      });
    }
  }
}

// An arrow pinned to the screen edge when a waypoint is off-screen, so you
// always know which way to drive without opening the map. Nothing draws while
// the target is on screen — the marker column already says where it is.
//
// Built to the same rules as the world art: the arrow is filled with its own
// mid tone, outlined in the DEEP step of that same hue rather than black, and
// carries a highlight along its upper-left edge so it reads as a solid object
// lit from the same direction as everything else.
function drawWaypoint(wx, wy, col, label) {
  const s = toScreen(wx, wy, 0);
  // same transform render() uses, minus the shake
  const sx = s.x + VW / 2 - cam.x, sy = s.y + VH / 2 - cam.y;
  const inset = 54;
  if (sx > inset && sx < VW - inset && sy > inset && sy < VH - inset) return;

  const cx = VW / 2, cy = VH / 2;
  let dx = sx - cx, dy = sy - cy;
  const len = Math.hypot(dx, dy) || 1;
  // scale the direction until it hits the inset rectangle, so the arrow slides
  // along the edge instead of orbiting on a circle and bunching in the corners
  const k = Math.min((VW / 2 - inset) / Math.abs(dx || 1e-6), (VH / 2 - inset) / Math.abs(dy || 1e-6));
  const ax = cx + dx * k, ay = cy + dy * k;
  const ang = Math.atan2(dy, dx);
  // world distance, in blocks — a block is ROAD_PITCH cells
  const p = world.player;
  const blocks = Math.round(Math.hypot(wx - p.x, wy - p.y) / ROAD_PITCH);

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  const r = 13;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(-r * 0.7, r * 0.62);
  ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.7, -r * 0.62);
  ctx.closePath();
  ctx.fillStyle = col.mid;
  ctx.fill();
  ctx.strokeStyle = col.deep; ctx.lineWidth = 1.5;
  ctx.stroke();
  // lit edge — the side the key light would catch
  ctx.beginPath();
  ctx.moveTo(r - 1, 0); ctx.lineTo(-r * 0.62, -r * 0.52);
  ctx.strokeStyle = col.core; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // the label rides outside the arrow, unrotated so it stays readable
  const lx = Math.max(30, Math.min(VW - 30, ax - Math.cos(ang) * 28));
  const ly = Math.max(20, Math.min(VH - 12, ay - Math.sin(ang) * 28));
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(6,10,18,0.75)';
  const txt = `${label} ${blocks}`;
  const tw = ctx.measureText(txt).width;
  ctx.fillRect(lx - tw / 2 - 4, ly - 9, tw + 8, 13);
  ctx.fillStyle = col.core;
  ctx.fillText(txt, lx, ly + 1);
  ctx.textAlign = 'left';
}

// Corner minimap — turf colours, roads implied by district fill, the player and
// the current objective. Navigating a 128x128 grid without one is miserable.
function drawMinimap() {
  const R = 74, mx = VW - R - 12, my = VH - R - 12, span = 46;   // world units shown
  ctx.save();
  ctx.beginPath(); ctx.arc(mx, my, R / 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(6,9,16,0.88)';
  ctx.fillRect(mx - R, my - R, R * 2, R * 2);
  const p = world.player;
  const sc = R / span;
  for (const d of DISTRICTS) {
    const col = isOwned(d.id) ? NEON.boyz : NEON[d.neon];
    ctx.fillStyle = withAlpha(col.deep, 0.5);
    ctx.fillRect(mx + (d.bounds[0] - p.x) * sc, my + (d.bounds[1] - p.y) * sc,
      (d.bounds[2] - d.bounds[0]) * sc, (d.bounds[3] - d.bounds[1]) * sc);
    ctx.strokeStyle = withAlpha(col.mid, 0.8); ctx.lineWidth = 1;
    ctx.strokeRect(mx + (d.bounds[0] - p.x) * sc, my + (d.bounds[1] - p.y) * sc,
      (d.bounds[2] - d.bounds[0]) * sc, (d.bounds[3] - d.bounds[1]) * sc);
  }
  for (const c of world.cars) {
    if (Math.hypot(c.x - p.x, c.y - p.y) > span) continue;
    ctx.fillStyle = c.siren ? '#3a86ff' : 'rgba(150,165,195,0.7)';
    ctx.fillRect(mx + (c.x - p.x) * sc - 1, my + (c.y - p.y) * sc - 1, 2, 2);
  }
  for (const e of world.people) {
    if (e.dead || e === p) continue;
    if (e.faction !== 'cabal' && e.faction !== 'cop' && e.faction !== 'crew') continue;
    if (Math.hypot(e.x - p.x, e.y - p.y) > span) continue;
    ctx.fillStyle = e.faction === 'crew' ? '#8fe021' : e.faction === 'cop' ? '#3a86ff' : '#e0233a';
    ctx.fillRect(mx + (e.x - p.x) * sc - 1, my + (e.y - p.y) * sc - 1, 2, 2);
  }
  for (const g of GARAGES) {
    if (Math.hypot(g.x - p.x, g.y - p.y) > span) continue;
    ctx.fillStyle = '#f0a020';
    ctx.fillRect(mx + (g.x - p.x) * sc - 2, my + (g.y - p.y) * sc - 2, 4, 4);
  }
  // waiting courier crate — gold, distinct from the lime objective blip
  if (hustle?.job?.stage === 'offer') {
    const j = hustle.job;
    let dx = (j.x - p.x) * sc, dy = (j.y - p.y) * sc;
    const l = Math.hypot(dx, dy) || 1;
    if (l > R / 2 - 4) { dx = dx / l * (R / 2 - 4); dy = dy / l * (R / 2 - 4); }
    ctx.fillStyle = '#f0ca4e';
    ctx.fillRect(mx + dx - 2, my + dy - 2, 4, 4);
  }
  const tgt = world.marker || (world.markerEntity?.e && !world.markerEntity.e.dead ? world.markerEntity.e : null);
  if (tgt) {
    // clamp the objective blip to the rim so it always points somewhere
    let dx = (tgt.x - p.x) * sc, dy = (tgt.y - p.y) * sc;
    const l = Math.hypot(dx, dy);
    if (l > R / 2 - 4) { dx = dx / l * (R / 2 - 4); dy = dy / l * (R / 2 - 4); }
    ctx.fillStyle = '#c8ff5a';
    ctx.beginPath(); ctx.arc(mx + dx, my + dy, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = withAlpha(NEON.boyz.mid, 0.85); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(mx, my, R / 2, 0, Math.PI * 2); ctx.stroke();
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
  return yy;   // the baseline of the last line, so callers can flow after it
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
  hustle = new Hustle(world);
  const restored = restore();
  world.briefing(boyId, restored && restored.mission
    ? `Back on the block. ${restored.mission} of ${MISSIONS.length} jobs done.`
    : 'Pump Lounge is home. Walk in and take a job when you\'re ready.');
  document.getElementById('select').hidden = true;
  document.getElementById('hud').hidden = false;
  resize();
  requestAnimationFrame(loop);
  // The server owns the points total; the client only ever displays it.
  api.register(BOYZ[boyId].name)
    .then(() => flush())
    .then(() => api.profile())
    .then((prof) => { if (prof && typeof prof.points === 'number') world.points = prof.points; })
    .catch(() => {});
}

// --- persistence ----------------------------------------------------------
// Points are NOT saved here — they are server-authoritative and come back from
// the profile endpoint. This only carries the things the server has no opinion
// about: cash, campaign position, turf, character and weapons.
function snapshot() {
  return {
    boy: world.boy,
    cash: Math.floor(world.cash),
    mission: campaign.index,
    completed: campaign.completed,
    owned: [...owned],
    weapon: world.player.weaponId || 'pistol',
    ammo: world.ammo,
    hustle: hustle ? hustle.snapshot() : null,
  };
}
let saveT = 0;
function autosave(dt) {
  saveT -= dt;
  if (saveT > 0) return;
  saveT = 20;
  try { localStorage.setItem('boyz_save', JSON.stringify(snapshot())); } catch {}
  api.save(snapshot()).catch(() => {});
}
function restore() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem('boyz_save') || 'null'); } catch {}
  if (!st) return null;
  world.cash = st.cash || 0;
  world.ammo = st.ammo || {};
  if (st.weapon) world.player.weaponId = st.weapon;
  for (const id of st.owned || []) owned.add(id);
  campaign.index = st.mission || 0;
  campaign.completed = st.completed || [];
  hustle.restore(st.hustle);
  cityDirty = true;
  return st;
}

let last = 0;
function loop(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
  last = ts;
  update(dt);
  autosave(dt);
  render();
  requestAnimationFrame(loop);
}

// character select
function buildSelect() {
  const wrapEl = document.getElementById('picks');
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('boyz_save') || 'null'); } catch {}
  if (saved?.boy) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.style.color = '#8fe021';
    note.textContent = `SAVE FOUND — ${saved.mission || 0}/10 jobs, $${saved.cash || 0}. Pick ${saved.boy.toUpperCase()} to continue.`;
    wrapEl.parentElement.insertBefore(note, wrapEl);
  }
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
window.__boyz = { world, get campaign() { return campaign; }, get hustle() { return hustle; }, MISSIONS };
window.__boyzGarages = GARAGES;
window.__boyzSafehouses = SAFEHOUSES;
