// ROBINHOOD BLOCK — the city.
//
// Laid out from the reference map: a dense coastal grid at night, carved into
// gang turf, ocean along the south, highways east and west. Districts and their
// neon are taken straight off it:
//
//        THE TROLLS      TUNG TUNGS         NEETS
//   VLAD'S HQ    THE BLOCKS   WAREHOUSE ROW   THE YARDS
//        BLACK BULLS   >THE BOYZ<        JIMOTHYS
//               DOCKS            THE PORT
//                    PACIFIC OCEAN
//
// The grid is CELL_W x CELL_H world units. Each cell carries a surface, an
// optional building height, and the district it belongs to. Everything the
// gameplay needs — collision, turf ownership, spawn points — reads off this.

export const CW = 128, CH = 128;   // world grid size

export const SURF = {
  ROAD: 0, PAVE: 1, LOT: 2, PARK: 3, WATER: 4, SAND: 5, RAIL: 6,
};

// --- districts ------------------------------------------------------------
// bounds are [x0, y0, x1, y1] inclusive, in grid cells.
export const DISTRICTS = [
  { id: 'trolls', name: 'The Trolls', neon: 'trolls', bounds: [6, 6, 40, 34], hostile: true },
  { id: 'tungtungs', name: 'Tung Tungs', neon: 'tungtungs', bounds: [46, 4, 80, 30], hostile: true },
  { id: 'neets', name: 'Neets', neon: 'neets', bounds: [86, 6, 120, 32], hostile: true },
  { id: 'vlad', name: "Vlad's HQ", neon: 'vlad', bounds: [4, 38, 22, 58], hostile: true },
  { id: 'blackbulls', name: 'Black Bulls', neon: 'blackbulls', bounds: [10, 64, 48, 100], hostile: true },
  { id: 'boyz', name: 'The Boyz', neon: 'boyz', bounds: [52, 40, 84, 86], hostile: false, home: true },
  { id: 'jimothys', name: 'Jimothys', neon: 'jimothys', bounds: [90, 46, 122, 94], hostile: true },
  { id: 'warehouse', name: 'Warehouse Row', neon: 'tungtungs', bounds: [56, 30, 88, 40], hostile: true },
  { id: 'yards', name: 'The Yards', neon: 'neets', bounds: [92, 34, 122, 46], hostile: true },
  { id: 'docks', name: 'The Docks', neon: 'blackbulls', bounds: [30, 102, 70, 118], hostile: true },
  { id: 'port', name: 'The Port', neon: 'jimothys', bounds: [76, 100, 120, 118], hostile: true },
];

// Spray shops and safehouses. A spray shop resets the wanted level for cash —
// without one the only way to shed heat is to drive in circles until the timer
// runs out, which is the least interesting thing the game can ask of you.
// Safehouses are respawn points, so dying stops teleporting you across the map.
export const GARAGES = [
  { id: 'g-boyz', name: 'Pay & Spray', x: 60, y: 68 },
  { id: 'g-west', name: 'Pay & Spray', x: 26, y: 76 },
  { id: 'g-east', name: 'Pay & Spray', x: 104, y: 74 },
  { id: 'g-north', name: 'Pay & Spray', x: 62, y: 20 },
];
export const SAFEHOUSES = [
  { id: 's-pump', name: 'The Pump', x: 66, y: 56, district: 'boyz' },
  { id: 's-strip', name: 'Strip House', x: 100, y: 64, district: 'jimothys' },
  { id: 's-ware', name: 'Row Lockup', x: 70, y: 38, district: 'warehouse' },
];

// Named landmarks — mission targets and map labels.
export const LANDMARKS = [
  { id: 'pump', name: 'Pump Lounge', x: 66, y: 50, district: 'boyz' },
  { id: 'tower', name: 'Greenlight Tower', x: 12, y: 46, district: 'vlad' },
  { id: 'projects', name: 'The Projects', x: 30, y: 58, district: 'blackbulls' },
  { id: 'blocks', name: 'The Blocks', x: 42, y: 36, district: 'trolls' },
  { id: 'strip', name: 'The Strip', x: 100, y: 60, district: 'jimothys' },
  { id: 'motel', name: 'Sunset Motel', x: 96, y: 40, district: 'yards' },
  { id: 'cashhouse', name: 'Cash House', x: 70, y: 34, district: 'warehouse' },
  { id: 'hq', name: 'Cabal HQ', x: 106, y: 20, district: 'neets' },
  { id: 'beach', name: 'Bayview Beach', x: 16, y: 112, district: null },
];

function rnd(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- grid build -----------------------------------------------------------
// Roads run on an 8-cell pitch, so blocks are 6 wide with 2-cell roads. That
// pitch is what makes it feel like a city rather than a maze: long straights
// you can actually get a car up to speed on.
export const ROAD_PITCH = 8;
export const ROAD_W = 2;

export const surf = new Uint8Array(CW * CH);
export const height = new Uint8Array(CW * CH);   // building height in world units
export const district = new Int8Array(CW * CH).fill(-1);
export const idx = (x, y) => y * CW + x;

const isRoadX = (x) => (x % ROAD_PITCH) < ROAD_W;
const isRoadY = (y) => (y % ROAD_PITCH) < ROAD_W;

function districtAt(x, y) {
  for (let i = 0; i < DISTRICTS.length; i++) {
    const [x0, y0, x1, y1] = DISTRICTS[i].bounds;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return i;
  }
  return -1;
}

function build() {
  const R = rnd(7717);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = idx(x, y);
      district[i] = districtAt(x, y);

      // the ocean along the south edge, and the beach strip above it
      if (y >= 120) { surf[i] = SURF.WATER; continue; }
      if (y >= 118) { surf[i] = SURF.SAND; continue; }
      // the river channel down the east side (from the map)
      if (x >= 124) { surf[i] = SURF.WATER; continue; }

      if (isRoadX(x) || isRoadY(y)) { surf[i] = SURF.ROAD; continue; }

      // one cell of pavement around each block
      const bx = x % ROAD_PITCH, by = y % ROAD_PITCH;
      if (bx === ROAD_W || by === ROAD_W || bx === ROAD_PITCH - 1 || by === ROAD_PITCH - 1) {
        surf[i] = SURF.PAVE; continue;
      }
      surf[i] = SURF.LOT;
    }
  }

  // Buildings: one footprint per block interior, height varying by district so
  // the skyline reads — towers downtown, low sprawl in the projects and docks.
  for (let by = 0; by + ROAD_PITCH <= CH; by += ROAD_PITCH) {
    for (let bx = 0; bx + ROAD_PITCH <= CW; bx += ROAD_PITCH) {
      const x0 = bx + ROAD_W + 1, y0 = by + ROAD_W + 1;
      const x1 = bx + ROAD_PITCH - 2, y1 = by + ROAD_PITCH - 2;
      if (x1 <= x0 || y1 <= y0) continue;
      if (surf[idx(x0, y0)] !== SURF.LOT) continue;

      const d = district[idx(x0, y0)];
      const dd = d >= 0 ? DISTRICTS[d].id : null;
      let hi = 3 + Math.floor(R() * 4);
      if (dd === 'vlad' || dd === 'trolls') hi = 8 + Math.floor(R() * 12);
      if (dd === 'neets' || dd === 'tungtungs') hi = 5 + Math.floor(R() * 7);
      if (dd === 'docks' || dd === 'port' || dd === 'warehouse') hi = 2 + Math.floor(R() * 2);
      if (dd === 'blackbulls') hi = 3 + Math.floor(R() * 3);
      if (dd === 'boyz') hi = 3 + Math.floor(R() * 5);

      // some lots are parks or open yards instead of buildings
      const roll = R();
      if (roll < 0.10) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) surf[idx(x, y)] = SURF.PARK;
        continue;
      }
      if (roll < 0.16) continue;   // empty lot — good for car spawns and fights

      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) height[idx(x, y)] = hi;
    }
  }

  // Garages and safehouses are open bays cut out of a block, reachable from the
  // road, with a low surround so they read as a structure rather than a hole.
  for (const g of [...GARAGES, ...SAFEHOUSES]) {
    for (let y = g.y - 2; y <= g.y + 2; y++) {
      for (let x = g.x - 2; x <= g.x + 2; x++) {
        if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
        const i = idx(x, y);
        height[i] = 0;
        surf[i] = SURF.LOT;
      }
    }
  }

  // Landmarks get a taller, distinct footprint so they're findable from a distance.
  for (const lm of LANDMARKS) {
    const hi = lm.id === 'tower' ? 26 : lm.id === 'hq' ? 18 : lm.id === 'pump' ? 9 : 7;
    for (let y = lm.y - 2; y <= lm.y + 2; y++) {
      for (let x = lm.x - 2; x <= lm.x + 2; x++) {
        if (x < 0 || y < 0 || x >= CW || y >= CH) continue;
        const i = idx(x, y);
        if (surf[i] === SURF.WATER) continue;
        surf[i] = SURF.LOT;
        height[i] = hi;
      }
    }
  }
}
build();

// --- building footprints --------------------------------------------------
// Merged rectangles, extracted once. Rendering needs these as discrete objects
// (not a baked image) so each one can be depth-sorted against cars and people —
// otherwise everything in the city floats over the rooftops.
export const BUILDINGS = [];
(function extractBuildings() {
  const seen = new Uint8Array(CW * CH);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = idx(x, y);
      const h = height[i];
      if (!h || seen[i]) continue;
      let w = 1;
      while (x + w < CW && height[idx(x + w, y)] === h && !seen[idx(x + w, y)]) w++;
      let d = 1;
      outer: while (y + d < CH) {
        for (let k = 0; k < w; k++) {
          if (height[idx(x + k, y + d)] !== h || seen[idx(x + k, y + d)]) break outer;
        }
        d++;
      }
      for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) seen[idx(xx, yy)] = 1;
      BUILDINGS.push({ x, y, w, d, h, seed: ((x * 2654435761) ^ (y * 40503)) >>> 0 });
    }
  }
})();

export function surfaceAt(x, y) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return SURF.WATER;
  return surf[idx(x | 0, y | 0)];
}
export function heightAt(x, y) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return 0;
  return height[idx(x | 0, y | 0)];
}
export function districtAtCell(x, y) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return null;
  const d = district[idx(x | 0, y | 0)];
  return d < 0 ? null : DISTRICTS[d];
}

// Solid for a walker: buildings and deep water. Roads, pavement, parks, lots
// and sand are all walkable.
export function solidAt(x, y) {
  if (x < 0.5 || y < 0.5 || x >= CW - 0.5 || y >= CH - 0.5) return true;
  const i = idx(x | 0, y | 0);
  if (height[i] > 0) return true;
  return surf[i] === SURF.WATER;
}
// Cars can't mount buildings, water, parks (railings/trees) or the beach —
// without the sand rule traffic wanders onto Bayview and pins itself against
// the surf, where it sits stuck forever.
export function carSolidAt(x, y) {
  if (solidAt(x, y)) return true;
  const s = surf[idx(x | 0, y | 0)];
  return s === SURF.PARK || s === SURF.SAND;
}

// Nearest road cell to a point — used for car spawns and cop pathing.
export function nearestRoad(x, y, maxR = 12) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = (x | 0) + dx, ny = (y | 0) + dy;
        if (nx < 1 || ny < 1 || nx >= CW - 1 || ny >= CH - 1) continue;
        if (surf[idx(nx, ny)] === SURF.ROAD) return { x: nx + 0.5, y: ny + 0.5 };
      }
    }
  }
  return { x: x, y: y };
}

// --- turf ownership -------------------------------------------------------
// Territory the Boyz have taken. Flipping a district turns its neon lime and
// starts it paying passive income, which is the loop the missions feed.
export const owned = new Set(['boyz']);
export function isOwned(id) { return owned.has(id); }
export function claim(id) { owned.add(id); }
export function ownedIncome() {
  // per-second passive cash: the home block plus everything taken
  let n = 0;
  for (const id of owned) n += id === 'boyz' ? 2 : 5;
  return n;
}

// The outline of a district as a world-space polyline, for the neon border.
export function districtOutline(d) {
  const [x0, y0, x1, y1] = d.bounds;
  return [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1], [x0, y0]];
}
