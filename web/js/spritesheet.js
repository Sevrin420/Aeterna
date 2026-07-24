// Builds and caches Cultist sprite sheets using Aeterna's ported Club Nile
// character generator (web/js/pixelchar.js) and draws/animates them.

import { makeCharacterHD, traitsForSeed, traitsForGuru } from './pixelchar.js';

const cache = new Map(); // seed -> {down:[c0,c1], up:[c0,c1], left:[c0,c1], right:[c0,c1]}

export function getCultistSprite(seed, sex) {
  const key = `${seed}|${sex || ''}`;
  let sheet = cache.get(key);
  if (!sheet) {
    sheet = makeCharacterHD(traitsForSeed(seed, sex));
    cache.set(key, sheet);
  }
  return sheet;
}

export function getGuruSprite() {
  const key = '__guru__';
  let sheet = cache.get(key);
  if (!sheet) {
    sheet = makeCharacterHD(traitsForGuru());
    cache.set(key, sheet);
  }
  return sheet;
}

// Warms the cache synchronously (generation is cheap canvas drawing, no
// network) so the first frame a character appears isn't blank.
export function preloadCharacter(seed, sex) {
  getCultistSprite(seed, sex);
}

export function drawCharacter(ctx, { sheet, dir, moving, animPhase, x, groundY, targetHeight }) {
  const frames = sheet[dir] || sheet.down;
  const idx = moving ? Math.floor(animPhase / 6) % 2 : Math.floor(animPhase / 1.4) % 2;
  const canvas = frames[idx] || frames[0];
  if (!canvas) return null;

  const scale = targetHeight / canvas.lh;
  const w = canvas.lw * scale, h = canvas.lh * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x - w / 2, groundY - h, w, h);
  return { w, h };
}
