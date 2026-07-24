// Small pixel-art rendering toolkit: color-ramp shading, a deterministic PRNG,
// per-token color jitter, and a colored-outline post-process pass. The core
// technique (ramp/mixc math, mulberry32, and the neighbor-averaged outline
// pass) is adapted from the clubnile.html character generator in the
// sevrin420/members-only repo; the actual Cultist silhouette below is
// generated procedurally for Aeterna rather than hand-authored/copied.

export function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function mixc(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Highlights lean warm cream, shadows lean cool plum — bold cartoon read.
export function ramp(base) {
  return { hi: mixc(base, '#fff3cf', 0.4), base, sh: mixc(base, '#241a38', 0.5) };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Tiny deterministic per-token dye-lot jitter, so no two Cultists' robes
// read as exactly identical.
export function jitterCol(hex, seed, mag = 1) {
  const r = mulberry32(seed >>> 0), c = hex2rgb(hex);
  const v = 1 + (r() - 0.5) * 0.22 * mag;
  const s = (r() - 0.5) * 20 * mag;
  const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const o = [cl(c[0] * v + s), cl(c[1] * v), cl(c[2] * v - s)];
  return '#' + o.map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Selective colored-outline pass: opaque pixels pass through; any transparent
// pixel touching an opaque one gets a darkened tint of its neighbors' color
// instead of flat black — reads much richer at small sizes.
export function outlinePass(canvas) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d');
  const src = g.getImageData(0, 0, w, h);
  const out = g.createImageData(w, h);
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src.data[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src.data[i + 3] > 0) {
        out.data[i] = src.data[i]; out.data[i + 1] = src.data[i + 1];
        out.data[i + 2] = src.data[i + 2]; out.data[i + 3] = 255;
      } else if (alphaAt(x - 1, y) || alphaAt(x + 1, y) || alphaAt(x, y - 1) || alphaAt(x, y + 1)) {
        let nr = 0, ng = 0, nb = 0, nc = 0;
        const add = (xx, yy) => {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
          const j = (yy * w + xx) * 4;
          if (src.data[j + 3] > 0) { nr += src.data[j]; ng += src.data[j + 1]; nb += src.data[j + 2]; nc++; }
        };
        add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
        if (nc) { nr /= nc; ng /= nc; nb /= nc; }
        out.data[i] = Math.round(nr * 0.3 + 14 * 0.7);
        out.data[i + 1] = Math.round(ng * 0.3 + 8 * 0.7);
        out.data[i + 2] = Math.round(nb * 0.3 + 16 * 0.7);
        out.data[i + 3] = 255;
      }
    }
  }
  g.putImageData(out, 0, 0);
}

const W = 16, H = 22; // logical sprite grid
const EYE_OFFSET = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function buildCultistCanvas(dir, robeHex, trimHex) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const robe = ramp(robeHex);
  const cx = W / 2;

  const set = (x, y, col) => { if (x >= 0 && x < W && y >= 0 && y < H) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } };

  // Hood: rows 0-9, half-width grows then eases (teardrop), shaded by column offset from center.
  for (let y = 0; y <= 9; y++) {
    const t = y / 9;
    const halfW = 1 + Math.round(Math.sin(t * Math.PI * 0.5) * 5.4);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const x = Math.round(cx) + dx;
      let col = robe.base;
      if (dx <= -halfW + 1) col = robe.hi;
      else if (dx >= halfW - 1) col = robe.sh;
      set(x, y, col);
    }
  }

  // Face shadow patch, low in the hood, with a small directional eye glow.
  const faceY0 = 5, faceY1 = 9;
  for (let y = faceY0; y <= faceY1; y++) {
    for (let dx = -2; dx <= 2; dx++) set(Math.round(cx) + dx, y, '#140d19');
  }
  const [ex, ey] = EYE_OFFSET[dir] || [0, 1];
  set(Math.round(cx) + ex, 7 + Math.sign(ey), '#e9c468');
  if (dir === 'left' || dir === 'right') set(Math.round(cx) + ex * 2, 7, '#e9c468');

  // Robe body: rows 10-20, flares wider than the hood then tapers at the hem.
  for (let y = 10; y <= 20; y++) {
    const t = (y - 10) / 10;
    const flare = t < 0.7 ? t / 0.7 : (1 - t) / 0.3;
    const halfW = 5 + Math.round(flare * 2.2);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const x = Math.round(cx) + dx;
      let col = robe.base;
      if (dx <= -halfW + 1) col = robe.hi;
      else if (dx >= halfW - 1) col = robe.sh;
      if (y === 20) col = trimHex;
      set(x, y, col);
    }
  }
  // gold trim seam down the front
  for (let y = 11; y <= 19; y++) set(Math.round(cx), y, trimHex);

  outlinePass(c);
  return c;
}

const cache = new Map();

// A handful of distinct robe hues so Cultists standing side by side read as
// different people at a glance (not just a subtle dye-lot jitter).
const ROBE_PALETTE = ['#3a2c52', '#4a2436', '#243a4e', '#2f4a34', '#4a3a20', '#3a2626'];

// One deterministically-colored, direction-aware sprite sheet per seed
// (wallet id / name / a fixed NPC key). Frames are built once and cached.
// Passing an explicit `robeBase` (the Guru) opts out of the palette pick.
export function getCultistSprite(seed, robeBase, trim = '#d9b264') {
  const key = `${seed}|${robeBase || ''}|${trim}`;
  if (cache.has(key)) return cache.get(key);
  const seedNum = hashSeed(seed);
  const picked = robeBase || ROBE_PALETTE[seedNum % ROBE_PALETTE.length];
  const baseRobe = jitterCol(picked, seedNum, 1.2);
  const sheet = {
    down: buildCultistCanvas('down', baseRobe, trim),
    up: buildCultistCanvas('up', baseRobe, trim),
    left: buildCultistCanvas('left', baseRobe, trim),
    right: buildCultistCanvas('right', baseRobe, trim),
    w: W, h: H,
  };
  cache.set(key, sheet);
  return sheet;
}
