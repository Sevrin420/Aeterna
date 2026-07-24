// Loads Club Nile's actual speakeasy character sprite frames
// (web/assets/sprites/<character>/<N|S|E|W>_<idle|walk><n>.png, copied from
// sevrin420/members-only's games/speakeasy asset set) and renders them with
// a light unifying tint so the cast reads as one torch-lit abbey cast rather
// than a literal 1920s speakeasy roster.

const DIR_TO_FACE = { up: 'N', down: 'S', left: 'W', right: 'E' };

export const MALE_CHARS = ['m03_bartender', 'm06_pianist', 'm07_bootlegger', 'm10_gentleman'];
export const FEMALE_CHARS = ['f02_singer', 'f04_socialite', 'f06_waitress', 'f08_madame'];
export const GURU_CHAR = 'm01_mobboss';

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function pickCharacter(seed, sex) {
  const list = sex === 'female' ? FEMALE_CHARS : MALE_CHARS;
  return list[hashSeed(seed) % list.length];
}

const rawImages = new Map(); // src -> HTMLImageElement
const tinted = new Map(); // `${src}|${tint}` -> canvas

function getRawImage(src) {
  let img = rawImages.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    rawImages.set(src, img);
  }
  return img;
}

// Preload every frame for a character so its first appearance isn't blank.
export function preloadCharacter(char) {
  const dirs = ['N', 'S', 'E', 'W'];
  const promises = [];
  for (const d of dirs) {
    for (const f of [`${d}_idle0.png`, `${d}_idle1.png`, `${d}_walk0.png`, `${d}_walk1.png`, `${d}_walk2.png`, `${d}_walk3.png`]) {
      const src = `assets/sprites/${char}/${f}`;
      const img = getRawImage(src);
      if (!img.complete) {
        promises.push(new Promise((res) => { img.onload = res; img.onerror = res; }));
      }
    }
  }
  return Promise.all(promises);
}

function getTinted(src, tint) {
  const key = `${src}|${tint}`;
  let canvas = tinted.get(key);
  if (canvas) return canvas;
  const img = getRawImage(src);
  if (!img.complete || !img.naturalWidth) return null;

  canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0);
  if (tint) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.globalCompositeOperation = 'source-over';
  }
  tinted.set(key, canvas);
  return canvas;
}

// Subtle shared wash (warm torchlight) rather than a full repaint, so each
// character's own palette still reads clearly.
const ABBEY_TINT = 'rgba(120, 80, 30, 0.16)';

export function drawCharacter(ctx, { char, dir, moving, animPhase, x, groundY, targetHeight, tint }) {
  const face = DIR_TO_FACE[dir] || 'S';
  let src;
  if (moving) {
    const idx = Math.floor(animPhase) % 4;
    src = `assets/sprites/${char}/${face}_walk${idx}.png`;
  } else {
    const idx = Math.floor(animPhase / 1.4) % 2;
    src = `assets/sprites/${char}/${face}_idle${idx}.png`;
  }

  const canvas = getTinted(src, tint || ABBEY_TINT);
  if (!canvas) { preloadCharacter(char); return; }

  const scale = targetHeight / canvas.height;
  const w = canvas.width * scale, h = canvas.height * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x - w / 2, groundY - h, w, h);
  return { w, h };
}
