// The unhallowed church — a death-cult sanctuary laid out as an INVERTED CROSS
// (a long north nave with a low transept and a short foot below it), surrounded
// by pitch-black void. Down the nave are ten arched alcoves (five per side),
// each a fire-shrine. Two staircases descend: the WEST stair to a warren of six
// private rooms with doors; the EAST stair to a chamber walled with skulls.
//
// Everything is drawn in Aeterna's own procedural pixel style in
// web/js/scenes/courtyard.js from the tile grid + prop list below.

export const TILE = 10;
export const COLS = 108;
export const ROWS = 122;
export const S = 1; // (legacy scale knob; the map is now authored at final size)

export function h2(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97; }

function blank() { return Array.from({ length: ROWS }, () => Array(COLS).fill(' ')); }
function fillRect(grid, x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid[y] && x >= 0 && x < COLS) grid[y][x] = ch;
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
export const NAVE = { x0: 51, y0: 8, x1: 68, y1: 77 };      // long stem
export const TRANSEPT = { x0: 27, y0: 52, x1: 92, y1: 64 };  // low crossbar
export const NAVE_CX = 59;                                   // nave centre column

// Ten arched alcoves down the nave, five per side. Each is a niche cut into the
// nave wall with a fire brazier, a wall torch and a stack of wood.
const ALCOVE_ROWS = [12, 20, 28, 36, 44]; // top row of each 4-tall niche
export const ALCOVES = [];
for (const r of ALCOVE_ROWS) {
  // west niche (opens east into the nave; arch tip points WEST)
  ALCOVES.push({ side: 'W', x0: 47, y0: r, x1: 50, y1: r + 3, cy: r + 1,
    brazier: { col: 48, row: r + 2 }, torch: { col: 47, row: r + 1 }, wood: { col: 50, row: r + 2 } });
  // east niche (opens west; arch tip points EAST)
  ALCOVES.push({ side: 'E', x0: 69, y0: r, x1: 72, y1: r + 3, cy: r + 1,
    brazier: { col: 71, row: r + 2 }, torch: { col: 72, row: r + 1 }, wood: { col: 69, row: r + 2 } });
}

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

// EAST chamber: a single room whose north wall is a rack of skulls.
export const SKULL_ROOM = { x0: 78, y0: 98, x1: 102, y1: 116 };
export const SKULL_WALL_ROW = 98;

function buildGrid() {
  const grid = blank();

  // church floors
  fillRect(grid, NAVE.x0, NAVE.y0, NAVE.x1, NAVE.y1, '.');
  fillRect(grid, TRANSEPT.x0, TRANSEPT.y0, TRANSEPT.x1, TRANSEPT.y1, '.');
  for (const a of ALCOVES) fillRect(grid, a.x0, a.y0, a.x1, a.y1, '.'); // niches

  // underground floors
  fillRect(grid, WEST_CORRIDOR.x0, WEST_CORRIDOR.y0, WEST_CORRIDOR.x1, WEST_CORRIDOR.y1, 'c');
  for (const rm of ROOMS) fillRect(grid, rm.x0, rm.y0, rm.x1, rm.y1, 'c');
  fillRect(grid, SKULL_ROOM.x0, SKULL_ROOM.y0, SKULL_ROOM.x1, SKULL_ROOM.y1, 'c');
  // doorway gaps (walkable floor; a door prop sits here and can be closed)
  for (const d of DOORS) grid[d.row][d.col] = 'c';

  // walls
  wallRing(grid, NAVE.x0 - 1, NAVE.y0 - 1, NAVE.x1 + 1, NAVE.y1 + 1);
  wallRing(grid, TRANSEPT.x0 - 1, TRANSEPT.y0 - 1, TRANSEPT.x1 + 1, TRANSEPT.y1 + 1);
  for (const a of ALCOVES) wallRing(grid, a.x0 - 1, a.y0 - 1, a.x1 + 1, a.y1 + 1);
  wallRing(grid, WEST_CORRIDOR.x0 - 1, WEST_CORRIDOR.y0 - 1, WEST_CORRIDOR.x1 + 1, WEST_CORRIDOR.y1 + 1);
  for (const rm of ROOMS) wallRing(grid, rm.x0 - 1, rm.y0 - 1, rm.x1 + 1, rm.y1 + 1);
  wallRing(grid, SKULL_ROOM.x0 - 1, SKULL_ROOM.y0 - 1, SKULL_ROOM.x1 + 1, SKULL_ROOM.y1 + 1);
  // re-open the doorways the rings may have sealed
  for (const d of DOORS) grid[d.row][d.col] = 'c';

  return grid.map((row) => row.join(''));
}

export const GRID = buildGrid();

export const PROPS = [];
function prop(type, col, row, solid = true, extra = {}) { PROPS.push({ type, col, row, solid, ...extra }); }

// --- CHURCH ---
prop('altar', NAVE_CX, 9);
prop('torch', NAVE_CX - 3, 9); prop('torch', NAVE_CX + 3, 9);
prop('bulletin', NAVE.x0, 11, false);
prop('pew', NAVE_CX - 3, 70); prop('pew', NAVE_CX + 3, 70);
// staircases down (walkable — step to descend)
prop('stair-down', TRANSEPT.x0 + 2, 58, false, { dest: { col: WEST_CORRIDOR.x0 + 2, row: 106 } });  // WEST -> warren
prop('stair-down', TRANSEPT.x1 - 2, 58, false, { dest: { col: SKULL_ROOM.x1 - 3, row: 101 } });      // EAST -> skulls
// the way out, at the foot of the cross
prop('door', NAVE_CX, 76, false);

// --- TEN FIRE ALCOVES (brazier is the interactive fire-shrine; torch + wood are dressing) ---
for (const a of ALCOVES) {
  prop('brazier', a.brazier.col, a.brazier.row, false, { side: a.side, cy: a.cy });
  prop('wall-torch', a.torch.col, a.torch.row, false, { side: a.side });
  prop('wood-stack', a.wood.col, a.wood.row, false);
  prop('alcove-arch', a.side === 'W' ? a.x0 - 1 : a.x1 + 1, a.cy, false, { side: a.side }); // arch on the back wall
}

// --- WEST WARREN (six doored rooms; a private meeting place) ---
prop('stair-up', WEST_CORRIDOR.x0 + 2, 106, false, { dest: { col: TRANSEPT.x0 + 2, row: 60 } });
for (const rm of ROOMS) prop('room-door', rm.door.col, rm.door.row, false);
prop('nursery', ROOMS[0].x0 + 3, ROOMS[0].y0 + 3, false); // cradle in the first room

// --- EAST SKULL CHAMBER (chant to the skulls; also holds the ritual games) ---
prop('stair-up', SKULL_ROOM.x1 - 3, 101, false, { dest: { col: TRANSEPT.x1 - 2, row: 60 } });
prop('skull-wall', Math.round((SKULL_ROOM.x0 + SKULL_ROOM.x1) / 2), SKULL_WALL_ROW, false,
  { x0: SKULL_ROOM.x0, x1: SKULL_ROOM.x1 });
prop('soul-altar', SKULL_ROOM.x0 + 4, SKULL_ROOM.y1 - 2, false);
prop('mancala-table', SKULL_ROOM.x1 - 4, SKULL_ROOM.y1 - 2);

// No claimable Cathedral alcoves in this layout (the fire alcoves replace them).
export const CATHEDRAL_ALCOVES = [];

// Stairs the player can step onto to teleport between the church and crypts.
export const STAIRS = PROPS.filter((p) => p.type === 'stair-down' || p.type === 'stair-up');

const SOLID_CHARS = new Set(['#', ' ']);
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
