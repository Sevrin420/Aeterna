// Procedurally-built abbey floor plan: cross-shaped church (west), a walled
// garden (center) with a fountain, a kitchen (south of the garden), two
// dormitories (east), connected by corridors, all sitting on open grounds
// with a river along the south edge and a dock as the main entrance.
//
// Layout (room placement, not artwork) is inspired by a riverside-abbey
// battle map the project owner shared — a licensed "Unbound Atlas" asset —
// but every tile here is drawn in Aeterna's own procedural pixel style in
// web/js/scenes/courtyard.js, not copied from that image.

export const TILE = 10;
export const COLS = 46;
export const ROWS = 42;

export function h2(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 97; }

function blank() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
}

function fillRect(grid, x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch;
}

// Draws a wall ring around a room's outer footprint, but only on cells not
// already claimed as floor by an overlapping room/corridor — this is what
// lets two overlapping rectangles (nave + transept) merge into one open
// cross-shaped interior, and lets corridors punch doors through walls.
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

  // --- interiors first (order controls which room "wins" an overlap) ---
  fillRect(grid, 5, 3, 11, 32, '.');    // church nave
  fillRect(grid, 2, 15, 14, 19, '.');   // church transept (crosses the nave)
  fillRect(grid, 18, 8, 28, 22, 'g');   // garden
  fillRect(grid, 18, 25, 28, 31, 'k');  // kitchen
  fillRect(grid, 32, 3, 43, 15, 'd');   // dorm north
  fillRect(grid, 32, 19, 43, 32, 'd');  // dorm south
  fillRect(grid, 15, 16, 17, 18, '.');  // corridor: church <-> garden
  fillRect(grid, 29, 8, 31, 10, '.');   // corridor: garden <-> dorm north
  fillRect(grid, 29, 25, 31, 27, '.');  // corridor: kitchen <-> dorm south
  fillRect(grid, 22, 22, 24, 25, '.');  // corridor: garden <-> kitchen

  // --- wall rings (doors appear automatically where a corridor already floored the seam) ---
  wallRing(grid, 4, 2, 12, 33);   // nave
  wallRing(grid, 1, 14, 15, 20);  // transept
  wallRing(grid, 17, 7, 29, 23);  // garden
  wallRing(grid, 17, 24, 29, 32); // kitchen
  wallRing(grid, 31, 2, 44, 16);  // dorm north
  wallRing(grid, 31, 18, 44, 33); // dorm south

  // main entrance: south end of the nave, onto a dock leading to the river
  fillRect(grid, 7, 33, 9, 33, '.');
  fillRect(grid, 7, 34, 9, 40, 'w');
  fillRect(grid, 0, 38, COLS - 1, ROWS - 1, '~');
  fillRect(grid, 7, 38, 9, 40, 'w'); // dock continues as a short pier

  return grid.map((row) => row.join(''));
}

export const GRID = buildGrid();

export const PROPS = [];
function prop(type, col, row, solid = true) { PROPS.push({ type, col, row, solid }); }

// Garden: fountain (3x3, center tile is the animated anchor), benches, corner pillars+lanterns
prop('fountain', 23, 15);
for (let y = 14; y <= 16; y++) for (let x = 22; x <= 24; x++) {
  if (x === 23 && y === 15) continue;
  prop('fountain-block', x, y);
}
prop('bench', 20, 11);
prop('bench', 26, 19);
prop('pillar', 19, 9);
prop('pillar', 27, 9);
prop('pillar', 19, 21);
prop('pillar', 27, 21);

// Church: altar, flanking pews down the nave (aisle stays clear at col 8)
prop('altar', 8, 4);
for (let r = 6; r <= 28; r += 2) { prop('pew', 6, r); prop('pew', 10, r); }
prop('torch', 6, 3);
prop('torch', 10, 3);
prop('torch', 3, 16);
prop('torch', 13, 16);

// Kitchen: counter + stove
for (let c = 20; c <= 26; c++) prop('counter', c, 27);
prop('stove', 24, 29);

// Dorms: bed rows along the west wall
for (let r = 4; r <= 14; r += 2) prop('bed', 33, r);
for (let r = 20; r <= 32; r += 2) prop('bed', 33, r);

// Scattered rocks/shrubs on the open grounds (never on the dock/river band)
for (let i = 0; i < 60; i++) {
  const c = h2(i * 7, 3) % COLS;
  const r = h2(3, i * 7) % ROWS;
  if (GRID[r][c] !== ' ') continue;
  if (r >= 33) continue;
  const kind = h2(i, i) % 3;
  if (kind === 0) prop('rock', c, r, true);
  else if (kind === 1) prop('bush', c, r, false);
}

const SOLID_CHARS = new Set(['#', '~']);
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
