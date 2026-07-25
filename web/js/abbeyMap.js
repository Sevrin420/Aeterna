// The unhallowed church — a death-cult sanctuary. No exterior at all: the
// whole world is a dimly-lit stone church laid out as an INVERTED CROSS (a
// long nave with a low transept and a short foot below it), surrounded by
// pitch-black void. Two staircases descend to two separate basement crypts.
//
// Everything is drawn in Aeterna's own procedural pixel style in
// web/js/scenes/courtyard.js from the tile grid + prop list below.

export const TILE = 10;
export const COLS = 46;
export const ROWS = 58;

export function h2(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97; }

function blank() {
  // fill the whole world with void; rooms are carved out of it
  return Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
}

function fillRect(grid, x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch;
}

// Wall ring around a footprint, but only on cells still void — so an
// overlapping rectangle (nave + transept) merges into one open interior.
function wallRing(grid, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const border = x === x0 || x === x1 || y === y0 || y === y1;
      if (border && grid[y][x] === ' ') grid[y][x] = '#';
    }
  }
}

function buildGrid() {
  const grid = blank();

  // --- INVERTED CROSS church (floors first) ---
  fillRect(grid, 18, 4, 25, 34, '.');   // long nave (vertical stem, altar at top)
  fillRect(grid, 7, 23, 36, 28, '.');   // transept (crossbar), set LOW -> inverted cross
  // (rows 28-34 of the nave form the short foot below the crossbar)

  // --- two basement crypts, isolated boxes in the void (reached by stairs) ---
  fillRect(grid, 5, 43, 19, 54, 'c');   // west crypt (the ossuary)
  fillRect(grid, 26, 43, 40, 54, 'c');  // east crypt (the ritual chamber)

  // --- wall rings ---
  wallRing(grid, 17, 3, 26, 35);   // nave
  wallRing(grid, 6, 22, 37, 29);   // transept
  wallRing(grid, 4, 42, 20, 55);   // west crypt
  wallRing(grid, 25, 42, 41, 55);  // east crypt

  return grid.map((row) => row.join(''));
}

export const GRID = buildGrid();

export const PROPS = [];
function prop(type, col, row, solid = true, extra = {}) { PROPS.push({ type, col, row, solid, ...extra }); }

// --- CHURCH ---
prop('altar', 21, 4);                       // altar with an inverted cross behind it
prop('torch', 18, 4); prop('torch', 24, 4); // flanking the altar
prop('torch', 7, 26); prop('torch', 36, 26);// transept arm ends
prop('bulletin', 18, 6);
// black votive candles lining the nave (the church's dim light)
for (const [c, r] of [[18, 9], [25, 9], [18, 16], [25, 16], [19, 30], [23, 30]]) prop('candle', c, r, false);
// a couple of pews down in the foot of the cross
prop('pew', 19, 32); prop('pew', 23, 32);
// staircases DOWN into the two crypts (walkable — step on to descend)
prop('stair-down', 8, 25, false, { dest: { col: 7, row: 45 } });   // -> west crypt
prop('stair-down', 35, 25, false, { dest: { col: 38, row: 45 } }); // -> east crypt
// the way out, at the foot of the cross
prop('door', 21, 34, false);

// Ownable Cathedral Room alcoves, set into the nave walls.
export const CATHEDRAL_ALCOVES = [
  { id: 'room-1', col: 18, row: 12 },
  { id: 'room-2', col: 25, row: 12 },
  { id: 'room-3', col: 18, row: 19 },
  { id: 'room-4', col: 25, row: 19 },
];
for (const a of CATHEDRAL_ALCOVES) prop('cathedral-alcove', a.col, a.row, false, { roomId: a.id });

// --- WEST CRYPT (the ossuary) ---
prop('stair-up', 7, 45, false, { dest: { col: 8, row: 26 } });
prop('ossuary', 6, 44); prop('ossuary', 17, 44); prop('ossuary', 15, 53);
prop('candle', 18, 47, false); prop('candle', 6, 51, false);
prop('nursery', 16, 51);

// --- EAST CRYPT (the ritual chamber) ---
prop('stair-up', 38, 45, false, { dest: { col: 35, row: 26 } });
prop('ritual-circle', 32, 51, false);       // glowing sigil on the floor
prop('soul-altar', 32, 47, false);
prop('mancala-table', 36, 52);
for (const [c, r] of [[28, 45], [40, 45], [28, 53], [40, 53]]) prop('candle', c, r, false);

// Stairs the player can step onto to teleport between the church and crypts.
export const STAIRS = PROPS.filter((p) => p.type === 'stair-down' || p.type === 'stair-up');

const SOLID_CHARS = new Set(['#', ' ']); // walls and the surrounding void block movement
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
