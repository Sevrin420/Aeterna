// Builds and caches Cultist sprite sheets using Aeterna's ported Club Nile
// character generator (web/js/pixelchar.js) and draws/animates them.

import { makeCharacterHD, traitsForSeed, traitsForGuru, traitsForConfessor, traitsForNaked, BIRDS } from './pixelchar.js';

/* How much bigger the cast is drawn than the heights the scenes ask for.

   The bird reads smaller than the human it replaced at the same target height,
   and for a reason that is in the art rather than in the numbers: the human
   fills its 36x32 head grid corner to corner, while the bird is an ellipse
   inscribed in that grid with empty rows above and below it, and the bare
   shanks put daylight where a human had a solid block of legs. Same nominal
   height, less ink — so the figure sits smaller in the eye than the number
   says.

   Applied where a figure stands free in the world, and deliberately NOT
   applied where one is framed by architecture or by a panel: the Confessor's
   booth bay is fifteen logical px wide and he already draws exactly fifteen
   wide, the menu sizes its backdrop and its count off CULT_H, and the scourge
   composes its own shot. Those would overflow their frames rather than read
   bigger. See the call sites in abbey.js.

   Rides the same switch as everything else, so BIRDS=false restores the human
   cast at its original size and not at a size tuned for birds. */
export const CHAR_SCALE = BIRDS ? 1.3 : 1;
import { applyRobe } from './cultLook.js';

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

// Same as getCultistSprite but bakes in a robe variant (e.g. 'blood') so the
// habit colour is generated with correct shading, not painted over.
export function getCultistSpriteVariant(seed, sex, robe) {
  const key = `${seed}|${sex || ''}|${robe || ''}`;
  let sheet = cache.get(key);
  if (!sheet) {
    sheet = makeCharacterHD(applyRobe(traitsForSeed(String(seed), sex), robe));
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

// The same cultist with the habit off. Cached under its own key so stripping
// and re-robing during the rite is two lookups, not two sheet builds.
export function getNakedSprite(seed, sex) {
  const key = `${seed}|${sex || ''}|__naked__`;
  let sheet = cache.get(key);
  if (!sheet) {
    sheet = makeCharacterHD(traitsForNaked(String(seed), sex));
    cache.set(key, sheet);
  }
  return sheet;
}

export function getConfessorSprite() {
  const key = '__confessor__';
  let sheet = cache.get(key);
  if (!sheet) {
    sheet = makeCharacterHD(traitsForConfessor());
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
