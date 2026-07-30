// The campaign — 10 missions, straight off the $BOYZ gameflow doc.
//
// A mission is a list of objectives. Each objective is a small object with an
// `enter` (set the world up) and a `check` (return true when done); the runner
// walks the list in order. Keeping objectives this dumb is deliberate — every
// mission in the doc decomposes into goto / collect / kill / hold / drive /
// escape, so nine of the ten needed no new machinery at all.
//
// POINTS are the crypto-facing currency (see js/api.js). Mission payouts are
// fixed and server-validated; cash is the in-game economy and is not.

import { LANDMARKS, DISTRICTS, claim, isOwned, nearestRoad } from './city.js';
import { spawnCabal, makePickup, makeCar, makePerson, PAINTS } from './entities.js';
import { BOYZ } from './palette.js';

const LM = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));

// --- objective builders ---------------------------------------------------
const goto = (x, y, label, r = 2.5) => ({
  label,
  enter(w) { w.setMarker(x, y, label); },
  check(w) { return Math.hypot(w.player.x - x, w.player.y - y) < r; },
});

const gotoLandmark = (id, label, r = 4) => {
  const l = LM[id];
  return goto(l.x, l.y, label || `Get to ${l.name}`, r);
};

const collect = (x, y, label) => ({
  label,
  enter(w) { w.pickups.push(makePickup(x, y, 'objective', label)); w.setMarker(x, y, label); },
  check(w) { return w.pickups.every((p) => p.type !== 'objective' || p.taken); },
});

const killAll = (label) => ({
  label,
  check(w) { return w.people.filter((p) => p.faction === 'cabal' && !p.dead).length === 0; },
  enter(w) { w.clearMarker(); },
});

const spawnEnemies = (x, y, n, opts) => ({
  label: null, instant: true,
  enter(w) { w.missionEnemies = spawnCabal(w, x, y, n, opts); w.setMarker(x, y, 'Hostiles'); },
  check() { return true; },
});

const hold = (x, y, secs, label) => ({
  label,
  enter(w) { w.holdT = secs; w.setMarker(x, y, label); },
  check(w, dt) {
    const near = Math.hypot(w.player.x - x, w.player.y - y) < 7;
    if (near) w.holdT -= dt;
    w.hudTimer = Math.max(0, w.holdT);
    return w.holdT <= 0;
  },
});

const survive = (secs, label) => ({
  label,
  enter(w) { w.holdT = secs; },
  check(w, dt) { w.holdT -= dt; w.hudTimer = Math.max(0, w.holdT); return w.holdT <= 0; },
});

const timer = (secs, label) => ({
  label, instant: true,
  enter(w) { w.missionTimer = secs; w.toast(label); },
  check() { return true; },
});

const inCar = (label) => ({
  label,
  enter(w) { w.clearMarker(); },
  check(w) { return !!w.player.inCar; },
});

const say = (who, text) => ({
  label: null, instant: true,
  enter(w) { w.briefing(who, text); },
  check() { return true; },
});

const claimTurf = (id) => ({
  label: null, instant: true,
  enter(w) { claim(id); w.toast(`${DISTRICTS.find((d) => d.id === id).name} belongs to the Boyz.`); },
  check() { return true; },
});

// --- the campaign ---------------------------------------------------------
export const MISSIONS = [
  {
    id: 1, title: 'Bandana Check', giver: 'pepe', points: 250, cash: 500,
    brief: 'In and out. Take the package across Trolls turf and don’t make noise. Grab a clean whip on the way.',
    maxWanted: 1,
    objectives: [
      say('pepe', 'Package is on the corner. Cross the Blocks, don’t get seen, don’t get loud.'),
      collect(LM.pump.x - 6, LM.pump.y - 4, 'Pick up the package'),
      inCar('Steal a clean whip'),
      gotoLandmark('blocks', 'Deliver across Trolls turf'),
      say('pepe', 'Clean. Bandana’s yours. Block’s open to you now.'),
    ],
    unlock: 'Free roam + crew radio',
  },
  {
    id: 2, title: 'First Through the Door', giver: 'andy', points: 400, cash: 900,
    brief: 'Corner store won’t pay tax. Take the enforcers off it and plant our flag.',
    objectives: [
      say('andy', 'I go first. You cover. Two enforcers inside, don’t touch civilians.'),
      gotoLandmark('projects', 'Reach the corner store'),
      spawnEnemies(LM.projects.x, LM.projects.y, 4, { hp: 55 }),
      killAll('Clear the enforcers'),
      goto(LM.projects.x, LM.projects.y, 'Plant the Boyz flag', 3),
      say('andy', 'That corner’s ours. It pays now.'),
    ],
    unlock: 'Safehouse income',
  },
  {
    id: 3, title: 'Champagne Math', giver: 'brett', points: 600, cash: 2200,
    brief: 'Three ATMs before the network locks. Fast car, tight window, lose the heat after.',
    objectives: [
      say('brett', 'Ninety seconds a hit. The math only works if you keep moving.'),
      inCar('Get a performance car'),
      timer(150, 'Network locks in 150 seconds'),
      collect(LM.pump.x + 10, LM.pump.y + 8, 'ATM 1'),
      collect(LM.pump.x - 14, LM.pump.y + 14, 'ATM 2'),
      collect(LM.projects.x + 6, LM.projects.y - 8, 'ATM 3'),
      { label: 'Lose the cops', enter(w) { w.clearMarker(); }, check(w) { return w.wanted === 0; } },
      say('brett', 'Numbers check out. Champagne.'),
    ],
    unlock: 'Better weapons',
  },
  {
    id: 4, title: 'Seen It All', giver: 'landwolf', points: 700, cash: 1500,
    brief: 'A snitch is holed up in the Sunset Motel. Bring him out. Quiet if you can.',
    objectives: [
      say('landwolf', 'I’ve seen how this ends when it goes loud. Your call.'),
      gotoLandmark('motel', 'Infiltrate the motel'),
      spawnEnemies(LM.motel.x, LM.motel.y, 5, { hp: 60 }),
      killAll('Deal with the guards'),
      collect(LM.motel.x, LM.motel.y, 'Extract the snitch'),
      goto(48, 108, 'Escape via the docks', 4),
      say('landwolf', 'He talked. The Cabal’s planning a dump on the whole block.'),
    ],
    unlock: 'Suppressed weapons',
  },
  {
    id: 5, title: 'Turf War — The Strip', giver: 'andy', points: 1000, cash: 3000,
    brief: 'Whole crew. Take the Strip, hold the intersection, put our banners up.',
    crew: ['pepe', 'andy'],
    objectives: [
      say('andy', 'Everybody’s out for this one. Clear it and hold it.'),
      gotoLandmark('strip', 'Hit the Strip'),
      spawnEnemies(LM.strip.x, LM.strip.y, 8, { hp: 65 }),
      killAll('Clear the buildings'),
      hold(LM.strip.x, LM.strip.y, 90, 'Hold the intersection'),
      claimTurf('jimothys'),
      say('andy', 'Banners up. The Strip is Boyz turf.'),
    ],
    unlock: 'Cabal response teams',
  },
  {
    id: 6, title: 'Ghost Protocol', giver: 'pepe', points: 1200, cash: 3500,
    brief: 'Armored van carrying the Cabal ledger. Take the data, leave the van. Vanish.',
    objectives: [
      say('pepe', 'Don’t wreck it. Whatever’s on that ledger is worth more than the van.'),
      inCar('Get a car'),
      {
        label: 'Intercept the armored van',
        enter(w) {
          const p = nearestRoad(LM.cashhouse.x, LM.cashhouse.y + 8);
          const van = makeCar(p.x, p.y, 0, { ai: 'traffic', hp: 260, topSpeed: 12, len: 2.6, wid: 1.2 });
          van.isVan = true;
          w.cars.push(van);
          w.missionVan = van;
          w.setMarkerEntity(van, 'Van');
        },
        check(w) {
          const v = w.missionVan;
          if (!v) return true;
          return Math.hypot(w.player.x - v.x, w.player.y - v.y) < 3.5;
        },
      },
      collect(LM.cashhouse.x, LM.cashhouse.y, 'Crack it and take the ledger'),
      { label: 'Vanish — lose all heat', enter(w) { w.clearMarker(); }, check(w) { return w.wanted === 0; } },
      say('pepe', 'No noise. No trace. We know where their leadership sleeps now.'),
    ],
    unlock: 'New weapon tier',
  },
  {
    id: 7, title: 'The Heart’s Stand', giver: 'andy', points: 1400, cash: 2800,
    brief: 'They’re pushing on Andy’s block while we hit elsewhere. Hold it.',
    crew: ['andy'],
    objectives: [
      say('andy', 'This is where I grew up. They don’t get a foot on it.'),
      goto(LM.pump.x, LM.pump.y + 10, 'Get to the block', 4),
      spawnEnemies(LM.pump.x + 12, LM.pump.y + 12, 6, { hp: 60 }),
      killAll('Push back the first wave'),
      spawnEnemies(LM.pump.x - 12, LM.pump.y + 14, 8, { hp: 65 }),
      killAll('Push back the second wave'),
      survive(45, 'Hold until the crew gets back'),
      say('andy', 'They know now. This block is people, not product.'),
    ],
    unlock: 'Crew loyalty',
  },
  {
    id: 8, title: 'Planner’s Heist', giver: 'brett', points: 2000, cash: 12000,
    brief: 'The Cabal’s off-chain cash house. Case it, breach it, fight out with the money.',
    crew: ['brett', 'pepe'],
    objectives: [
      say('brett', 'This is the exit liquidity vault. We take it, their whole play dies.'),
      gotoLandmark('cashhouse', 'Case the cash house'),
      collect(LM.cashhouse.x - 6, LM.cashhouse.y - 6, 'Acquire breach equipment'),
      goto(LM.cashhouse.x, LM.cashhouse.y, 'Execute the breach', 3),
      spawnEnemies(LM.cashhouse.x, LM.cashhouse.y, 10, { hp: 70 }),
      killAll('Fight out with the money'),
      gotoLandmark('pump', 'Launder it through the Pump Lounge'),
      claimTurf('warehouse'),
      say('brett', 'Champagne. That was the number the whole plan hung on.'),
    ],
    unlock: 'Crew upgrades',
  },
  {
    id: 9, title: 'Cabal Retaliation', giver: 'landwolf', points: 2400, cash: 5000,
    brief: 'They took one of ours. Fortified warehouse, city on high alert. Get him out.',
    objectives: [
      say('landwolf', 'They grabbed Andy. Whole city’s lit up. Your approach, your call.'),
      { label: null, instant: true, enter(w) { w.setWanted(3); }, check() { return true; } },
      gotoLandmark('cashhouse', 'Reach the warehouse'),
      spawnEnemies(LM.cashhouse.x + 4, LM.cashhouse.y + 4, 12, { hp: 70 }),
      killAll('Break the holding force'),
      collect(LM.cashhouse.x + 2, LM.cashhouse.y + 2, 'Free Andy'),
      goto(LM.pump.x, LM.pump.y, 'Get him home', 4),
      say('landwolf', 'He’s breathing. Now we finish it.'),
    ],
    unlock: 'Finale',
  },
  {
    id: 10, title: 'Take the Hood', giver: 'brett', points: 5000, cash: 25000,
    brief: 'Full war. Breach the compound, fight through, and put the last banner up.',
    crew: ['pepe', 'brett', 'andy', 'landwolf'],
    objectives: [
      say('brett', 'Four Boyz. One block. Everything we did was for this door.'),
      gotoLandmark('hq', 'Breach the outer defences'),
      spawnEnemies(LM.hq.x - 6, LM.hq.y + 6, 10, { hp: 70 }),
      killAll('Break the outer line'),
      spawnEnemies(LM.hq.x, LM.hq.y, 12, { hp: 80 }),
      killAll('Fight through the compound'),
      {
        label: 'Confront the Cabal leader',
        enter(w) {
          const boss = makePerson(LM.hq.x, LM.hq.y, {
            skin: BOYZ.landwolf.skin, cloth: BOYZ.brett.cloth,
            accent: { o: '#2a1040', d: '#4d1d73', b: '#7a2fb0', l: '#a366d6', h: '#d0aaf0' },
            cap: { o: '#1a1a20', d: '#33333e', b: '#4d4d5c', l: '#6b6b7e', h: '#8f8fa3' },
          }, { faction: 'cabal', hp: 420, weapon: 'gun', speed: 3.8, name: 'VLAD' });
          w.people.push(boss);
          w.boss = boss;
          w.setMarkerEntity(boss, 'VLAD');
        },
        check(w) { return !w.boss || w.boss.dead; },
      },
      goto(LM.hq.x, LM.hq.y, 'Raise the final banner', 4),
      claimTurf('neets'), claimTurf('trolls'), claimTurf('blackbulls'),
      claimTurf('tungtungs'), claimTurf('vlad'), claimTurf('docks'),
      claimTurf('port'), claimTurf('yards'),
      say('brett', 'The block belongs to the Boyz.'),
    ],
    unlock: 'Post-game free roam — full territory control',
  },
];

// --- runner ---------------------------------------------------------------
export class Campaign {
  constructor(world) {
    this.w = world;
    this.index = 0;          // next mission to start
    this.active = null;
    this.obj = 0;
    this.completed = [];
  }

  get current() { return this.active; }

  available() {
    return this.index < MISSIONS.length ? MISSIONS[this.index] : null;
  }

  start(m) {
    const mission = m || this.available();
    if (!mission || this.active) return false;
    this.active = mission;
    this.obj = -1;
    this.w.missionTimer = 0;
    this.w.missionEnemies = [];
    this.w.boss = null;
    this.w.missionVan = null;
    if (mission.crew) this.w.spawnCrew(mission.crew);
    this.w.toast(`MISSION ${mission.id}: ${mission.title}`);
    this.advance();
    return true;
  }

  advance() {
    const m = this.active;
    if (!m) return;
    this.obj++;
    // run through any instant steps (dialogue, spawns, turf flips) in one go
    while (this.obj < m.objectives.length) {
      const o = m.objectives[this.obj];
      o.enter?.(this.w);
      if (!o.instant) break;
      this.obj++;
    }
    if (this.obj >= m.objectives.length) this.complete();
  }

  update(dt) {
    const m = this.active;
    if (!m) return;
    if (this.w.missionTimer > 0) {
      this.w.missionTimer -= dt;
      this.w.hudTimer = Math.max(0, this.w.missionTimer);
      if (this.w.missionTimer <= 0) { this.fail('Out of time'); return; }
    }
    if (m.maxWanted != null && this.w.wanted > m.maxWanted) { this.fail('Too much heat'); return; }
    if (this.w.player.hp <= 0) { this.fail('You went down'); return; }

    const o = m.objectives[this.obj];
    if (o && o.check(this.w, dt)) this.advance();
  }

  objectiveLabel() {
    const m = this.active;
    if (!m) return null;
    const o = m.objectives[this.obj];
    return o ? o.label : null;
  }

  complete() {
    const m = this.active;
    this.completed.push(m.id);
    this.index = Math.max(this.index, MISSIONS.findIndex((x) => x.id === m.id) + 1);
    this.active = null;
    this.w.missionTimer = 0;
    this.w.clearMarker();
    this.w.award(m.points, `Mission ${m.id} complete`);
    this.w.cash += m.cash;
    this.w.onMissionComplete?.(m);
  }

  fail(why) {
    const m = this.active;
    this.active = null;
    this.w.missionTimer = 0;
    this.w.clearMarker();
    this.w.despawnMissionEnemies();
    this.w.toast(`MISSION FAILED — ${why}`);
    this.w.onMissionFail?.(m, why);
  }
}
