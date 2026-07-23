// The walled abbey courtyard — first scene after boot.
// Small hand-authored tile map rendered with plain canvas primitives (no sprite assets).

const TILE = 13;
const COLS = 16;
const ROWS = 16;
const W = COLS * TILE;
const H = ROWS * TILE;

// # wall  .  floor  P pillar  F fountain  (blank cols/rows outside are never read)
const MAP = [
  '################',
  '#P............P#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......FF......#',
  '#......FF......#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#P............P#',
  '#######..#######',
];

const SOLID = new Set(['#', 'P', 'F']);
const TORCH_COLS = [4, 11];

function tileAt(col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '#';
  return MAP[row][col];
}

function isSolid(col, row) {
  return SOLID.has(tileAt(col, row));
}

export class CourtyardScene {
  constructor() {
    this.t = 0;
    // spawn just inside the gate, facing up into the courtyard
    this.player = {
      x: (7.5) * TILE,
      y: (14.4) * TILE,
      w: 8,
      h: 8,
      speed: 46,
      dir: 'up',
      moving: false,
      bob: 0,
    };
    this.entryMessage = 'You stand within the abbey walls.';
    this.messageTimer = 4;
  }

  enter() {}

  _tryMove(dx, dy) {
    const p = this.player;
    const nx = p.x + dx;
    const ny = p.y + dy;

    const half = p.w / 2;
    const corners = (x, y) => [
      [x - half, y - half],
      [x + half, y - half],
      [x - half, y + half],
      [x + half, y + half],
    ];

    const blockedX = corners(nx, p.y).some(([cx, cy]) => isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedX) p.x = nx;

    const blockedY = corners(p.x, ny).some(([cx, cy]) => isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedY) p.y = ny;
  }

  update(dt, input) {
    this.t += dt;
    if (this.messageTimer > 0) this.messageTimer -= dt;

    const p = this.player;
    let dx = 0, dy = 0;
    if (input.dirs.up) { dy -= 1; p.dir = 'up'; }
    if (input.dirs.down) { dy += 1; p.dir = 'down'; }
    if (input.dirs.left) { dx -= 1; p.dir = 'left'; }
    if (input.dirs.right) { dx += 1; p.dir = 'right'; }

    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) {
      const len = Math.hypot(dx, dy) || 1;
      this._tryMove((dx / len) * p.speed * dt, (dy / len) * p.speed * dt);
      p.bob += dt * 10;
    }

    input.consumeAPress();
    input.consumeBPress();
  }

  _drawFloor(ctx) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = MAP[r][c];
        const x = c * TILE, y = r * TILE;
        if (ch === '#') {
          ctx.fillStyle = '#2c2013';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x, y + TILE - 3, TILE, 3);
          ctx.strokeStyle = 'rgba(80,60,30,0.5)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else {
          // sandstone floor with light dithering
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#c9a35f' : '#bd9752';
          ctx.fillRect(x, y, TILE, TILE);
          if ((r * 7 + c * 13) % 11 === 0) {
            ctx.fillStyle = 'rgba(90,60,20,0.25)';
            ctx.fillRect(x + 3, y + 4, 2, 2);
          }
        }
      }
    }

    // gate threshold glow
    ctx.fillStyle = 'rgba(233, 196, 104, 0.18)';
    ctx.fillRect(7 * TILE, 15 * TILE, 2 * TILE, TILE);
  }

  _drawPillar(ctx, col, row) {
    const x = col * TILE, y = row * TILE;
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(x, y - TILE * 0.6, TILE, TILE * 1.6);
    ctx.fillStyle = '#6b552f';
    ctx.fillRect(x + 2, y - TILE * 0.6, 3, TILE * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
  }

  _drawFountain(ctx) {
    const x = 7 * TILE, y = 7 * TILE, s = TILE * 2;
    ctx.fillStyle = '#3a4a52';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#5b7580';
    ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    const shimmer = (Math.sin(this.t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(180, 220, 230, ${0.35 + shimmer * 0.35})`;
    ctx.fillRect(x + 5, y + 5, s - 10, s - 10);
  }

  _drawTorches(ctx) {
    for (const col of TORCH_COLS) {
      const x = col * TILE + TILE / 2;
      const y = 0.5 * TILE;
      const flick = 0.7 + Math.sin(this.t * 14 + col) * 0.15 + Math.random() * 0.08;
      ctx.fillStyle = '#3a2a18';
      ctx.fillRect(x - 2, y - 2, 4, 8);
      ctx.fillStyle = `rgba(255, ${Math.floor(140 + flick * 60)}, 60, ${0.85})`;
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 3.5 * flick, 5.5 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 220, 140, ${0.7})`;
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 1.5 * flick, 2.5 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawPlayer(ctx) {
    const p = this.player;
    const bobOffset = p.moving ? Math.sin(p.bob) * 1 : 0;
    const x = Math.round(p.x);
    const y = Math.round(p.y + bobOffset);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 5, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // robe
    ctx.fillStyle = '#241a2e';
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 5);
    ctx.lineTo(x - 5, y - 2);
    ctx.quadraticCurveTo(x, y - 8, x + 5, y - 2);
    ctx.lineTo(x + 4, y + 5);
    ctx.closePath();
    ctx.fill();

    // gold trim
    ctx.strokeStyle = '#d9b264';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // hood / head shadow
    ctx.fillStyle = '#140d19';
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 3.4, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // face glow, offset by facing direction
    const faceOffset = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.dir] || [0, 1];
    ctx.fillStyle = 'rgba(233, 196, 104, 0.9)';
    ctx.beginPath();
    ctx.ellipse(x + faceOffset[0] * 1.2, y - 6 + faceOffset[1] * 1.2, 1.1, 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  render(ctx) {
    ctx.fillStyle = '#050301';
    ctx.fillRect(0, 0, W, H);

    this._drawFloor(ctx);
    this._drawFountain(ctx);
    this._drawPillar(ctx, 1, 1);
    this._drawPillar(ctx, 14, 1);
    this._drawPillar(ctx, 1, 14);
    this._drawPillar(ctx, 14, 14);
    this._drawTorches(ctx);
    this._drawPlayer(ctx);

    // subtle vignette
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (this.messageTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.messageTimer);
      ctx.textAlign = 'center';
      ctx.font = '7px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText(this.entryMessage, W / 2, H - 6);
      ctx.restore();
    }
  }

  exit() {}
}
