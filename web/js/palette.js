// Aeterna's colour system, built the way A Link to the Past builds one.
//
// Every material is a five-step ramp — outline / shadow / base / light /
// highlight — lit from the upper left. Two things make a ramp read as 16-bit
// pixel art rather than as flat vector shapes:
//
//   1. The outline is a very dark version of the material's OWN hue, never
//      black. Wood is ringed in near-black brown, iron in blue-black, stone in
//      deep violet. That is what keeps props from dissolving into the floor.
//   2. Hue SHIFTS along the ramp: shadows drift cooler and more violet,
//      highlights drift warmer. A straight brightness ramp of a single hue
//      looks like plastic; a hue-shifted one looks lit.
//
// The abbey uses LttP's Dark World register: desaturated indigo stone with
// exactly one saturated accent pair (crimson + gold) against it. Adding a
// third competing accent is the fastest way to lose the whole effect.

export function ramp(o, d, b, l, h) { return { o, d, b, l, h }; }

// --- stone (per surface) ---------------------------------------------------
export const FLOOR = ramp('#161228', '#2b2450', '#423a6c', '#584d8c', '#7468ac');
export const WALL = ramp('#0e0a1a', '#231b36', '#37294f', '#503c6c', '#6b5488');
// the crypts are packed earth, not dressed stone — warmer, so descending the
// stairs reads as a temperature change
export const EARTH = ramp('#140f14', '#2b2222', '#40332f', '#57463c', '#71604e');
export const VOID = '#080611';

// --- accents and materials (shared everywhere) -----------------------------
export const BLOOD = ramp('#4a0d16', '#8c1a22', '#c62b30', '#e85a4a', '#f79a78');
export const GOLD = ramp('#5d3b0c', '#9a7018', '#d8a832', '#f2d264', '#fff3b8');
export const WOOD = ramp('#2c1a0c', '#5b3417', '#8a5626', '#b57c3c', '#d9a75e');
export const IRON = ramp('#14121a', '#2e2c36', '#4a4854', '#6b6878', '#918da0');
export const BONE = ramp('#3a3226', '#8a8069', '#c9c0a4', '#e8e2c8', '#fbf8e6');
export const CLOTH = ramp('#241d18', '#4a3d33', '#6b5a4a', '#8f7c68', '#b5a288');
export const SOUL = ramp('#1b1030', '#3a1f66', '#6a3fb0', '#9a72dc', '#c8aef2');
export const MOSS = ramp('#10240f', '#20441c', '#356b2c', '#4e8f3e', '#78b85c');

// Cast shadows are violet, not black — LttP never drops a neutral shadow onto
// a coloured floor.
export const SHADOW = 'rgba(30,16,56,0.48)';
export const SHADOW_SOFT = 'rgba(30,16,56,0.30)';

// Fire, from core outward. Used for every flame in the abbey so braziers,
// torches, candles and the stove all agree.
export const FIRE = {
  core: '#fff2b0', hot: '#f9ae32', mid: '#e2571c', deep: '#a8290c',
  glow: (a) => `rgba(255,170,70,${a})`,
};

// Nudge a hex toward black/white without leaving the ramp — for per-tile
// variation inside one material.
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${cl(n >> 16)},${cl((n >> 8) & 255)},${cl(n & 255)})`;
}

// The workhorse: a beveled block with a coloured outline, a lit top face and a
// shadowed bottom + right edge. Every solid prop in the abbey is made of these.
export function block(ctx, x, y, w, h, R, outline = true) {
  if (outline) { ctx.fillStyle = R.o; ctx.fillRect(x - 1, y - 1, w + 2, h + 2); }
  ctx.fillStyle = R.b; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = R.l; ctx.fillRect(x, y, w, Math.max(1, h * 0.22));
  ctx.fillStyle = R.h; ctx.fillRect(x, y, Math.max(2, w * 0.25), 1);
  ctx.fillStyle = R.d; ctx.fillRect(x, y + h - Math.max(1, h * 0.18), w, Math.max(1, h * 0.18));
  ctx.fillStyle = R.d; ctx.fillRect(x + w - 1, y + 1, 1, h - 1);
}

// A flame plus its additive halo. `s` scales the whole thing; `seed` decorrelates
// the flicker between neighbouring lights.
export function flame(ctx, x, y, s, t, seed) {
  const f = 0.82 + Math.sin(t * 12 + seed) * 0.18;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 1, x, y, 26 * s * f);
  g.addColorStop(0, 'rgba(255,186,86,0.55)');
  g.addColorStop(0.45, 'rgba(226,87,28,0.22)');
  g.addColorStop(1, 'rgba(226,87,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 30 * s, y - 32 * s, 60 * s, 60 * s);
  ctx.restore();
  ctx.fillStyle = FIRE.deep;
  ctx.beginPath(); ctx.ellipse(x, y, 3.6 * s * f, 7 * s * f, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FIRE.mid;
  ctx.beginPath(); ctx.ellipse(x, y, 2.7 * s * f, 5.6 * s * f, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FIRE.hot;
  ctx.beginPath(); ctx.ellipse(x, y + 0.6 * s, 1.7 * s * f, 3.6 * s * f, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FIRE.core;
  ctx.beginPath(); ctx.ellipse(x, y + 1.2 * s, 0.9 * s * f, 1.9 * s * f, 0, 0, Math.PI * 2); ctx.fill();
}

// A small unlit flame for candles and votives (no halo blowout).
export function candleFlame(ctx, x, y, t, seed) {
  const f = 0.75 + Math.sin(t * 11 + seed) * 0.2;
  ctx.fillStyle = FIRE.mid;
  ctx.beginPath(); ctx.ellipse(x, y, 1.3 * f, 2.6 * f, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FIRE.hot;
  ctx.beginPath(); ctx.ellipse(x, y + 0.4, 0.8 * f, 1.7 * f, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = FIRE.core;
  ctx.beginPath(); ctx.arc(x, y + 0.8, 0.5 * f, 0, Math.PI * 2); ctx.fill();
}
