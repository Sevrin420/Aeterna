// The unhallowed church — a death-cult sanctuary laid out as an INVERTED CROSS
// (a long north nave with a low transept and a short foot below it), surrounded
// by pitch-black void. Down the nave are six pointed alcoves (three per side),
// each a fire-shrine. Two staircases descend: the WEST stair to a warren of six
// private rooms with doors; the EAST stair to a chamber walled with skulls.
//
// Everything is drawn in Aeterna's own procedural pixel style in
// web/js/scenes/courtyard.js from the tile grid + prop list below.

export const TILE = 10;
export const COLS = 116;
export const ROWS = 134;
export const S = 1; // (legacy scale knob; the map is now authored at final size)

export function h2(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97; }

function blank() { return Array.from({ length: ROWS }, () => Array(COLS).fill(' ')); }
function fillRect(grid, x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid[y] && x >= 0 && x < COLS) grid[y][x] = ch;
}
// Wall around an arbitrary cell list: any still-void neighbour becomes masonry.
// A rectangular ring can't follow a tapered room, so the fire niches use this.
function wrapWalls(grid, cells) {
  for (const [x, y] of cells) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (grid[ny] && nx >= 0 && nx < COLS && grid[ny][nx] === ' ') grid[ny][nx] = '#';
      }
    }
  }
}
// Wall ring, only on cells still void — so overlapping rooms merge into one open interior.
function wallRing(grid, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const border = x === x0 || x === x1 || y === y0 || y === y1;
      if (border && grid[y] && grid[y][x] === ' ') grid[y][x] = '#';
    }
  }
}

// ---- landmark coordinates (single source of truth, shared with courtyard) ----
// The church, pulled in by about a third on both long axes. It was 70 tiles
// from altar to door and 66 across the crossbar, which made crossing it a
// commute rather than a walk — most of a minute of holding one direction with
// nothing happening. The nave's WIDTH and the transept's HEIGHT are untouched,
// as is every prop and every fire niche; what went is empty floor and two of
// the five alcove pairs.
export const NAVE = { x0: 51, y0: 8, x1: 68, y1: 57 };      // long stem, was 70 tall
export const TRANSEPT = { x0: 36, y0: 36, x1: 82, y1: 48 };  // crossbar, was 66 wide
export const NAVE_CX = 59;                                   // nave centre column

// The way out. These tiles are cut clean through the south wall as walkable
// threshold cells ('x'), so stepping into the gap returns you to the entry
// lobby — the gap reads as an opening, so it has to behave like one. The
// 'gate' station's A-press still works for anyone who stops short of it.
export const EXIT_ROW = NAVE.y1 + 1;              // the south wall course
export const EXIT_COLS = [NAVE_CX - 1, NAVE_CX, NAVE_CX + 1];

// Six fire alcoves down the nave, three per side. The niche used to be a plain
// 4x4 box with a pointed-arch prop drawn inside it; the point is now the SHAPE
// of the room itself — the floor runs full height at the nave opening and
// tapers to a single tile at its far end, so the nook comes to a point without
// any decoration standing in for one. Walls follow the taper (see wrapWalls).
// Three pairs, not five. The niches themselves are exactly the size they
// always were — the two that went are the two the shorter nave has no room
// for, and six braziers is still more than a day's rite needs.
const ALCOVE_ROWS = [12, 20, 28]; // top row of each 5-tall niche
const ALCOVE_DEPTH = 5;                   // columns from the tip to the opening
const ALCOVE_HALF = 2;                    // half-height once the taper is full
export const ALCOVES = [];

// Floor cells of one niche: at `d` columns in from the tip the niche is
// (2*min(d, ALCOVE_HALF) + 1) tiles tall, giving a 1 / 3 / 5 / 5… chevron.
function alcoveCells(side, r) {
  const cy = r + ALCOVE_HALF;
  const cells = [];
  for (let d = 0; d < ALCOVE_DEPTH; d++) {
    // d counts from the tip toward the nave; the opening column is fixed at
    // the nave wall (50 west / 69 east) so the niche always meets the aisle.
    const col = side === 'W' ? (51 - ALCOVE_DEPTH) + d : (68 + ALCOVE_DEPTH) - d;
    const half = Math.min(d, ALCOVE_HALF);
    for (let y = cy - half; y <= cy + half; y++) cells.push([col, y]);
  }
  return cells;
}

for (const r of ALCOVE_ROWS) {
  const cy = r + ALCOVE_HALF;
  // west niche (opens east into the nave; tapers to a point in the WEST)
  ALCOVES.push({
    side: 'W', x0: 51 - ALCOVE_DEPTH, y0: r, x1: 50, y1: r + ALCOVE_HALF * 2, cy,
    cells: alcoveCells('W', r),
    brazier: { col: 48, row: cy },
    // The fuel sits OUT in the aisle rather than in the niche: it has to be a
    // thing you walk to and carry back, so it cannot live where it is used.
    wood: { col: 52, row: cy },
    // Wall bracket just south of the alcove mouth. Col 50 is the nave wall,
    // and the niche only breaks through it across rows cy-2..cy+2, so cy+3 is
    // solid stone with a torch on it.
    torch: { col: 50, row: cy + 3 },
  });
  // east niche (opens west; tapers to a point in the EAST)
  ALCOVES.push({
    side: 'E', x0: 69, y0: r, x1: 68 + ALCOVE_DEPTH, y1: r + ALCOVE_HALF * 2, cy,
    cells: alcoveCells('E', r),
    brazier: { col: 71, row: cy },
    wood: { col: 67, row: cy },
    torch: { col: 69, row: cy + 3 },
  });
}

// A confessional alcove cut NORTH out of the transept's west arm — the left
// arm of the inverted cross. It breaks through the transept's north wall
// course and runs back into what was void; only a three-tile throat is
// opened, which keeps the arm reading as a wall with a door in it rather than
// as an open-plan room.
export const CONFESSIONAL = { x0: 38, y0: 30, x1: 42, y1: 34 };
export const CONFESSIONAL_THROAT = [39, 40, 41];    // walkable cols at TRANSEPT.y0 - 1
// The booth stands across the whole back wall of the niche. Its centre tile
// carries the prop; the rest are invisible blockers, so the player can walk up
// to the grille but never behind it.
export const CONFESSIONAL_BOOTH_ROW = 30;
export const CONFESSIONAL_BOOTH_COL = 40;

// The gaming hall: an alcove cut SOUTH out of the transept's west arm, so the
// confessor's niche and this open off the same arm on opposite sides — you
// settle your account with the abbey upstairs and gamble it away three tiles
// later. It is the one room in the building with no rite in it, which is why
// it gets benches: somewhere to sit is the whole difference between a chamber
// and a den.
export const MANCALA_HALL = { x0: 37, y0: 50, x1: 45, y1: 57 };
export const MANCALA_THROAT = [40, 41, 42];   // walkable cols at TRANSEPT.y1 + 1
export const MANCALA_SEAT = { col: 41, row: 54 };
export const MANCALA_BENCHES = [
  { col: 38, row: 53 }, { col: 38, row: 55 },
  { col: 44, row: 53 }, { col: 44, row: 55 },
  { col: 41, row: 51 },
];

// Eight figures set into the walls of the cross, each on the one side of its
// wall that fronts open floor, so every one of them looks out over a room
// rather than into stone. `face` is +1 when the floor is to the east and -1
// when it is west.
//
// They are placed by station in the building rather than scattered: saints at
// the altar end, where the abbey is still pretending to be a church; gargoyles
// down the working length of the nave and at the far ends of both arms; and
// two grotesques over the door, so the last thing you pass on the way out is a
// pair of open mouths. They sit on wall tiles, which are already solid, so
// none of them changes where anyone can walk.
export const STATUES = [
  { col: 50, row: 10, kind: 'saint',     face:  1 },
  { col: 69, row: 10, kind: 'saint',     face: -1 },
  { col: 50, row: 34, kind: 'gargoyle',  face:  1 },
  { col: 69, row: 34, kind: 'gargoyle',  face: -1 },
  { col: 35, row: 42, kind: 'gargoyle',  face:  1 },
  { col: 83, row: 42, kind: 'gargoyle',  face: -1 },
  { col: 50, row: 52, kind: 'grotesque', face:  1 },
  { col: 69, row: 52, kind: 'grotesque', face: -1 },

  // Sixteen more, tripling the statuary. Chosen by farthest-point spread over
  // every wall tile in the abbey that has floor on exactly one side and is not
  // a corner, so no two crowd each other and every part of the building —
  // nave, arms, warren, star — carries some. The warren and the star get most
  // of them: those were the two areas with none at all, and they are also the
  // two you walk through in the dark.
  { col: 45, row: 22, kind: 'gargoyle',  face:  1 },
  { col: 74, row: 22, kind: 'gargoyle',  face: -1 },
  { col: 36, row: 57, kind: 'gargoyle',  face:  1 },
  { col: 20, row: 97, kind: 'gargoyle',  face: -1 },
  { col: 42, row: 97, kind: 'gargoyle',  face: -1 },
  { col: 31, row: 103, kind: 'gargoyle',  face: -1 },
  { col: 11, row: 116, kind: 'gargoyle',  face:  1 },
  { col: 22, row: 111, kind: 'gargoyle',  face:  1 },
  { col: 33, row: 116, kind: 'gargoyle',  face:  1 },
  { col: 76, row: 91, kind: 'grotesque', face:  1 },
  { col: 99, row: 92, kind: 'grotesque', face: -1 },
  { col: 79, row: 102, kind: 'gargoyle',  face:  1 },
  { col: 106, row: 111, kind: 'gargoyle',  face: -1 },
  { col: 69, row: 111, kind: 'gargoyle',  face:  1 },
  { col: 83, row: 113, kind: 'gargoyle',  face:  1 },
  { col: 89, row: 123, kind: 'grotesque', face: -1 },
];

// WEST warren: a corridor with six doored rooms (three above, three below).
const WEST_CORRIDOR = { x0: 10, y0: 105, x1: 41, y1: 108 };
const ROOM_COLS = [[12, 19], [23, 30], [34, 41]];
export const ROOMS = [];
export const DOORS = [];
for (const [cx0, cx1] of ROOM_COLS) {
  const doorCol = Math.round((cx0 + cx1) / 2);
  ROOMS.push({ x0: cx0, y0: 97, x1: cx1, y1: 103, door: { col: doorCol, row: 104 } }); // top room
  ROOMS.push({ x0: cx0, y0: 110, x1: cx1, y1: 116, door: { col: doorCol, row: 109 } }); // bottom room
}
for (const rm of ROOMS) DOORS.push(rm.door);

// EAST chamber: the shrine's room, cut as a five-pointed star with one point
// aimed SOUTH. An inverted pentagram is the shape the order would actually
// carve, and it does something a rectangle cannot — the walls converge on the
// skull from five directions, so wherever you stand you are in a wedge looking
// down its axis at the thing in the middle.
//
// SKULL_ROOM stays as the star's bounding box, because half the abbey derives
// positions from it and a bounding box is still the right answer for "how big
// is this room". What is walkable is STAR_CELLS.
// Grown by half. The worshipper's circuit used to run at 30px, INSIDE the
// 36px pool, so the dance happened in the ooze; it now runs at 52px, outside
// the 41px kerb. For that to fit, the star's narrowest measurement — the notch
// radius between two points — has to clear the circuit, so STAR_IN went from
// 5.6 tiles to 7.6 and the points went out to keep the proportion.
const STAR_C = { col: 88, row: 106 };
const STAR_OUT = 19;                // tile radius to a point
const STAR_IN = 7.6;                // tile radius to a notch — must clear DANCE_R
export const SKULL_ROOM = { x0: 69, y0: 87, x1: 107, y1: 125 };

// The star as a polygon, then rasterised. One vertex at +90 degrees puts a
// point at the BOTTOM of the screen, which is the inversion.
const STAR_POLY = (() => {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? STAR_OUT : STAR_IN;
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    pts.push([STAR_C.col + Math.cos(a) * r, STAR_C.row + Math.sin(a) * r]);
  }
  return pts;
})();

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const STAR_CELLS = (() => {
  const out = [];
  for (let r = SKULL_ROOM.y0; r <= SKULL_ROOM.y1; r++) {
    for (let c = SKULL_ROOM.x0; c <= SKULL_ROOM.x1; c++) {
      if (inPoly(c + 0.5, r + 0.5, STAR_POLY)) out.push([c, r]);
    }
  }
  return out;
})();
const STAR_SET = new Set(STAR_CELLS.map(([c, r]) => `${c},${r}`));
export function inStar(col, row) { return STAR_SET.has(`${col},${row}`); }

// Anything that has to STAND in the star asks for a spot rather than naming a
// tile. A star has concave edges, so an offset from the centre that is fine in
// a rectangle can easily land in the void between two points; this walks
// outward from the wanted spot until it finds real floor, which means moving
// the points or the radii can never strand a staircase in a wall again.
function starSpot(dCol, dRow) {
  const want = { col: STAR_C.col + dCol, row: STAR_C.row + dRow };
  if (inStar(want.col, want.row) && !nearShrine(want.col, want.row)) return want;
  let best = null;
  let bestD = Infinity;
  for (const [c, r] of STAR_CELLS) {
    if (nearShrine(c, r)) continue;
    const d = Math.hypot(c - want.col, r - want.row);
    if (d < bestD) { bestD = d; best = { col: c, row: r }; }
  }
  return best;
}
// the shrine's own solid 3x3, which nothing may be placed on
function nearShrine(col, row) {
  return Math.abs(col - STAR_C.col) <= 1 && Math.abs(row - STAR_C.row) <= 1;
}

// The shrine skull floats over the centre of the chamber. Its tile and the
// ring of tiles around it are solid: it is a large object, and walking through
// one would read as a bug however convincingly it hovers.
export const SKULL_SHRINE = { col: STAR_C.col, row: STAR_C.row };

// The only tile the skull can be worshipped from: due south of it, five tiles
// out, which puts it clear of the kerb (4.1 tiles) on the floor of the star's
// downward point. The rite used to start from anywhere inside a 44px circle,
// which meant the player could kneel half inside the pool and had no idea
// where the "right" place was. One tile, painted blood red, answers that
// without a word of instruction.
export const SKULL_ALTAR = { col: STAR_C.col, row: STAR_C.row + 5 };

// The stair lands in the star's upper-right arm. The mancala table used to sit
// in the lower-left one; it has its own hall off the transept now, because a
// wager table in the shrine room meant the one place you go to gamble was also
// the one place you go to be worshipped at.
export const SKULL_STAIR = starSpot(6, -6);

// Bundles of cut switches, standing against the nave's north wall behind the
// Abbot — the altar between him and them, so they are the first thing you see
// past his shoulder. They used to lean against the skull chamber's west wall,
// which made the rite a round trip down the east stair and back up the whole
// length of the nave for one stick.
//
// Stacked together in the north-west corner rather than spread along the wall,
// and deliberately clear of columns 56-62: the altar and its two torches stand
// on row 9 there and are drawn tall, so a bundle on row 8 behind any of them is
// completely swallowed. Three in one corner is also one place to walk to
// instead of three, which is the whole point of moving them out of the crypt.
export const STICKS = [
  { col: NAVE.x0 + 1, row: NAVE.y0 },
  { col: NAVE.x0 + 2, row: NAVE.y0 },
  { col: NAVE.x0 + 3, row: NAVE.y0 },
];

function buildGrid() {
  const grid = blank();

  // church floors
  fillRect(grid, NAVE.x0, NAVE.y0, NAVE.x1, NAVE.y1, '.');
  fillRect(grid, TRANSEPT.x0, TRANSEPT.y0, TRANSEPT.x1, TRANSEPT.y1, '.');
  for (const a of ALCOVES) for (const [x, y] of a.cells) grid[y][x] = '.'; // tapered niches

  // underground floors
  fillRect(grid, WEST_CORRIDOR.x0, WEST_CORRIDOR.y0, WEST_CORRIDOR.x1, WEST_CORRIDOR.y1, 'c');
  for (const rm of ROOMS) fillRect(grid, rm.x0, rm.y0, rm.x1, rm.y1, 'c');
  for (const [c, r] of STAR_CELLS) grid[r][c] = 'c';   // the star, not a box
  // confessional niche + its throat through the transept's north wall
  fillRect(grid, CONFESSIONAL.x0, CONFESSIONAL.y0, CONFESSIONAL.x1, CONFESSIONAL.y1, '.');
  for (const c of CONFESSIONAL_THROAT) grid[TRANSEPT.y0 - 1][c] = '.';
  // gaming hall + its throat through the transept's SOUTH wall
  fillRect(grid, MANCALA_HALL.x0, MANCALA_HALL.y0, MANCALA_HALL.x1, MANCALA_HALL.y1, '.');
  for (const c of MANCALA_THROAT) grid[TRANSEPT.y1 + 1][c] = '.';
  // doorway gaps (walkable floor; a door prop sits here and can be closed)
  for (const d of DOORS) grid[d.row][d.col] = 'c';

  // walls
  wallRing(grid, NAVE.x0 - 1, NAVE.y0 - 1, NAVE.x1 + 1, NAVE.y1 + 1);
  wallRing(grid, TRANSEPT.x0 - 1, TRANSEPT.y0 - 1, TRANSEPT.x1 + 1, TRANSEPT.y1 + 1);
  for (const a of ALCOVES) wrapWalls(grid, a.cells);
  // Two courses, not one. The niche is the only structure in the abbey that
  // pushes OUT into the void rather than being carved from a lit room, so a
  // single-tile ring reads as a floating box; a second course gives it enough
  // mass to look like masonry the transept grew out of.
  wallRing(grid, CONFESSIONAL.x0 - 1, CONFESSIONAL.y0 - 1, CONFESSIONAL.x1 + 1, TRANSEPT.y0 - 1);
  wallRing(grid, CONFESSIONAL.x0 - 2, CONFESSIONAL.y0 - 2, CONFESSIONAL.x1 + 2, TRANSEPT.y0 - 1);
  // Same two courses for the hall, for the same reason: it pushes out into the
  // void below the arm rather than being carved from a lit room.
  wallRing(grid, MANCALA_HALL.x0 - 1, TRANSEPT.y1 + 1, MANCALA_HALL.x1 + 1, MANCALA_HALL.y1 + 1);
  wallRing(grid, MANCALA_HALL.x0 - 2, TRANSEPT.y1 + 1, MANCALA_HALL.x1 + 2, MANCALA_HALL.y1 + 2);
  wallRing(grid, WEST_CORRIDOR.x0 - 1, WEST_CORRIDOR.y0 - 1, WEST_CORRIDOR.x1 + 1, WEST_CORRIDOR.y1 + 1);
  for (const rm of ROOMS) wallRing(grid, rm.x0 - 1, rm.y0 - 1, rm.x1 + 1, rm.y1 + 1);
  // The star gets its walls wrapped around its actual cells — a ring round the
  // bounding box would seal the room inside a rectangle and leave the five
  // wedges of void between the points unwalled.
  wrapWalls(grid, STAR_CELLS);
  // re-open the doorways the rings may have sealed
  for (const d of DOORS) grid[d.row][d.col] = 'c';
  // cut the exit threshold through the south wall
  for (const c of EXIT_COLS) grid[EXIT_ROW][c] = 'x';

  return grid.map((row) => row.join(''));
}

export const GRID = buildGrid();

export const PROPS = [];
function prop(type, col, row, solid = true, extra = {}) { PROPS.push({ type, col, row, solid, ...extra }); }

// --- CHURCH ---
prop('altar', NAVE_CX, 9);
prop('torch', NAVE_CX - 3, 9); prop('torch', NAVE_CX + 3, 9);
prop('pew', NAVE_CX - 3, EXIT_ROW - 7); prop('pew', NAVE_CX + 3, EXIT_ROW - 7);
for (const st of STATUES) prop('statue', st.col, st.row, false, { kind: st.kind, face: st.face });
// The confessional: a timber booth filling the back of the north niche, with
// the confessor standing in its open bay. Only the centre tile draws; the rest
// are solid so the booth is a wall you talk through, not furniture you skirt.
prop('confessional', CONFESSIONAL_BOOTH_COL, CONFESSIONAL_BOOTH_ROW);
for (let c = CONFESSIONAL.x0; c <= CONFESSIONAL.x1; c++) {
  if (c !== CONFESSIONAL_BOOTH_COL) prop('booth-block', c, CONFESSIONAL_BOOTH_ROW);
}
// staircases down (walkable — step to descend)
// Stair rows are expressed off the transept rather than as absolute numbers,
// so moving the crossbar can never leave a staircase standing in a wall.
prop('stair-down', TRANSEPT.x0 + 2, TRANSEPT.y0 + 6, false, { dest: { col: WEST_CORRIDOR.x0 + 2, row: 106 } });  // WEST -> warren
prop('stair-down', TRANSEPT.x1 - 2, TRANSEPT.y0 + 6, false, { dest: { col: SKULL_STAIR.col, row: SKULL_STAIR.row } });  // EAST -> the star
// the way out, at the foot of the cross
prop('door', NAVE_CX, EXIT_ROW + 1, false);

// --- SIX FIRE ALCOVES ---
// Just the brazier (the interactive fire-shrine) and its fuel. The niche used
// to also carry a wall torch and a three-candle rack drawn over the brazier by
// the duty station; both are gone, so the only flame in a nook is the brazier's
// own and the shrine reads as one object instead of three light sources.
for (const a of ALCOVES) {
  prop('brazier', a.brazier.col, a.brazier.row, false, { side: a.side, cy: a.cy });
  // The wood stack and the wall torch are NOT props any more — they are
  // carryable objects the scene owns, because a prop is scenery and these have
  // to be picked up, moved, consumed and respawned. See courtyard.js.
  // No arch prop: the niche's own tapered floor plan is the point.
}

// --- WEST WARREN (six doored rooms; a private meeting place) ---
prop('stair-up', WEST_CORRIDOR.x0 + 2, 106, false, { dest: { col: TRANSEPT.x0 + 2, row: TRANSEPT.y0 + 8 } });
for (const rm of ROOMS) prop('room-door', rm.door.col, rm.door.row, false);
prop('nursery', ROOMS[0].x0 + 3, ROOMS[0].y0 + 3, false); // cradle in the first room

// --- EAST SKULL CHAMBER (chant to the skulls; also holds the ritual games) ---
prop('stair-up', SKULL_STAIR.col, SKULL_STAIR.row, false, { dest: { col: TRANSEPT.x1 - 2, row: TRANSEPT.y0 + 8 } });
prop('mancala-table', MANCALA_SEAT.col, MANCALA_SEAT.row);
for (const b of MANCALA_BENCHES) prop('bench', b.col, b.row);
// The shrine's footprint. Nothing draws from these — the skull is scene-owned
// because it floats, spins, wakes and descends — they exist only to be solid.
for (let dc = -1; dc <= 1; dc++) {
  for (let dr = -1; dr <= 1; dr++) {
    prop('shrine-block', SKULL_SHRINE.col + dc, SKULL_SHRINE.row + dr);
  }
}

// No claimable Cathedral alcoves in this layout (the fire alcoves replace them).
export const CATHEDRAL_ALCOVES = [];

// Stairs the player can step onto to teleport between the church and crypts.
export const STAIRS = PROPS.filter((p) => p.type === 'stair-down' || p.type === 'stair-up');

const SOLID_CHARS = new Set(['#', ' ']);   // 'x' (exit threshold) is walkable
const solidProps = new Set();
for (const p of PROPS) if (p.solid) solidProps.add(`${p.col},${p.row}`);

export function tileAt(col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '#';
  return GRID[row][col];
}
export function isSolid(col, row) {
  if (SOLID_CHARS.has(tileAt(col, row))) return true;
  return solidProps.has(`${col},${row}`);
}
