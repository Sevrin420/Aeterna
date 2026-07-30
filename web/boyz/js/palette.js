// BOYZ N THE HOOD — colour system.
//
// Same construction as the abbey's (web/js/palette.js): every material is a
// five-step ramp — outline / shadow / base / light / highlight — lit from the
// upper left, outlined in a very dark version of its OWN hue rather than black,
// with hue shifting cooler through the shadows and warmer through the
// highlights. That is the Link to the Past rule set; only the palette changes.
//
// The palette is taken from the two references: the crew art (near-black
// hoodies, camo caps, a hot lime glow ring, and one saturated bandana per Boy)
// and the city map (a near-black coastal grid at night, every gang's turf
// outlined in its own neon, warm sodium street lamps).
//
// The city is DESATURATED and dark almost everywhere. All the saturation lives
// in the neon: turf borders, signage, headlights, muzzle flashes. That contrast
// is the whole look — if the ground starts competing with the neon, it dies.

export function ramp(o, d, b, l, h) { return { o, d, b, l, h }; }

// --- ground and structure -------------------------------------------------
export const ASPHALT = ramp('#07090f', '#111624', '#1b2232', '#28314a', '#39445e');
export const CONCRETE = ramp('#0b0d14', '#191d2c', '#262c3e', '#353d54', '#49536d');
export const BUILDING = ramp('#06080e', '#101623', '#1a2131', '#252f45', '#33405a');
export const BRICK = ramp('#0d0709', '#241216', '#3a1e22', '#4e2c30', '#664044');
export const WATER = ramp('#03050a', '#070e1c', '#0c1728', '#12243c', '#1c3454');
export const PARK = ramp('#050c06', '#0e1a0d', '#172a15', '#22401f', '#315c2c');
export const SAND = ramp('#12100a', '#2a2417', '#3e3624', '#544934', '#6d6047');
export const VOID = '#04060b';

// --- materials ------------------------------------------------------------
export const STEEL = ramp('#0a0c11', '#191d26', '#2a303c', '#3d4554', '#565f72');
export const CHROME = ramp('#12141a', '#2c3140', '#4c5468', '#727c92', '#a2acbe');
export const RUBBER = ramp('#050609', '#0d0f14', '#15181f', '#1e222b', '#2a2f3a');
export const GLASS = ramp('#060b12', '#0d1a2a', '#153048', '#22496b', '#3a6f9c');
export const WOOD = ramp('#120b06', '#2c1c0e', '#432b17', '#5a3c22', '#755334');
export const GOLD = ramp('#3d2705', '#7a5410', '#c99722', '#f0ca4e', '#ffeeae');

// --- gang neon (straight off the city map) --------------------------------
// Each turf is outlined in its own colour. When the Boyz take a district its
// border flips to BOYZ lime — that flip is the game's main progress signal.
export const NEON = {
  boyz: { core: '#c8ff5a', mid: '#8fe021', deep: '#4d8a08' },
  trolls: { core: '#e59bff', mid: '#a63bd8', deep: '#5c1580' },
  tungtungs: { core: '#ffd98a', mid: '#f0a020', deep: '#8a5405' },
  neets: { core: '#8effa0', mid: '#3fc94a', deep: '#136b1c' },
  blackbulls: { core: '#ff7d8c', mid: '#e0233a', deep: '#7d0512' },
  jimothys: { core: '#8fc4ff', mid: '#2a7de0', deep: '#0b3d80' },
  vlad: { core: '#7cffc0', mid: '#34d17a', deep: '#0a6b3c' },
  police: { core: '#9fd4ff', mid: '#3a86ff', deep: '#12306e' },
};

// --- the crew -------------------------------------------------------------
// One saturated bandana each, over near-black street clothes, so four figures
// in a dark alley still read apart instantly.
export const BOYZ = {
  pepe: {
    name: 'Pepe', role: 'The Ghost',
    skin: ramp('#123f0c', '#2c7a1c', '#62c23f', '#8fdc63', '#c2f298'),
    cloth: ramp('#05060a', '#0e1016', '#16191f', '#22262f', '#333844'),
    accent: ramp('#3d060c', '#8a121c', '#c2242e', '#e05a5c', '#f39a95'),
    cap: ramp('#0a1207', '#1c2c12', '#2e4a1e', '#43682b', '#5e8c3e'),
    tag: '#62c23f',
  },
  brett: {
    name: 'Brett', role: 'The Planner',
    skin: ramp('#0a2044', '#164a91', '#2f6fd0', '#5c99ea', '#9ec6f7'),
    cloth: ramp('#05060a', '#0e1016', '#16191f', '#22262f', '#333844'),
    accent: ramp('#08234d', '#14498f', '#3f86e8', '#71adf3', '#aed3fa'),
    cap: ramp('#08182f', '#123258', '#1d4d82', '#2e6aad', '#4a8fd4'),
    tag: '#3f86e8',
  },
  andy: {
    name: 'Andy', role: 'The Heart',
    skin: ramp('#3d2405', '#8a570f', '#e8952e', '#f5bb6a', '#fdddab'),
    cloth: ramp('#05060a', '#0e1016', '#16191f', '#22262f', '#333844'),
    accent: ramp('#4a2c04', '#96650d', '#f0a83c', '#f8c878', '#fee6b4'),
    cap: ramp('#0a1207', '#1c2c12', '#2e4a1e', '#43682b', '#5e8c3e'),
    tag: '#f0a83c',
  },
  landwolf: {
    name: 'Landwolf', role: 'The Veteran',
    skin: ramp('#2a1209', '#572915', '#8a4a2a', '#b06e45', '#d29a72'),
    cloth: ramp('#05060a', '#0e1016', '#16191f', '#22262f', '#333844'),
    accent: ramp('#3d060c', '#8a121c', '#c2242e', '#e05a5c', '#f39a95'),
    cap: ramp('#1a0c14', '#33192a', '#4c2740', '#663758', '#834c74'),
    tag: '#c2242e',
  },
};
export const BOYZ_ORDER = ['pepe', 'brett', 'andy', 'landwolf'];

// The Cabal — the rival crew. Cold, colourless, expensive-looking: the "old
// money / exit liquidity" read from the lore. Deliberately the least saturated
// figures in the game so they feel like the thing draining colour off the block.
export const CABAL = {
  skin: ramp('#1a1a20', '#33333e', '#4d4d5c', '#6b6b7e', '#8f8fa3'),
  cloth: ramp('#08080c', '#131319', '#1e1e26', '#2c2c38', '#3f3f4e'),
  accent: ramp('#1e1a2c', '#39304f', '#564a75', '#7768a0', '#a094c7'),
  tag: '#9a8fc4',
};

export const COP = {
  skin: ramp('#3a2a1c', '#6b4d33', '#9a7050', '#c09876', '#e0c4a6'),
  cloth: ramp('#040914', '#0a1730', '#122850', '#1d3d74', '#2f5da8'),
  accent: ramp('#2a2c33', '#4c5060', '#70768c', '#979db4', '#c2c7d8'),
  tag: '#3a86ff',
};

// --- light ----------------------------------------------------------------
export const LAMP = { core: '#fff0bf', hot: '#ffcc66', mid: '#e08a1e', glow: (a) => `rgba(255,190,90,${a})` };
export const HEADLIGHT = { core: '#ffffff', hot: '#fff2c0', mid: '#ffd45c' };
export const MUZZLE = { core: '#ffffff', hot: '#ffe08a', mid: '#ff9a2a' };
export const SIREN = { red: '#ff2a4a', blue: '#2a7dff' };

// Cast shadows are a cold blue-black, never neutral — everything outdoors here
// is lit by sodium lamps and neon, so the shadows go the other way.
export const SHADOW = 'rgba(4,8,20,0.55)';
export const SHADOW_SOFT = 'rgba(4,8,20,0.32)';

// --- helpers (same as the abbey's) ----------------------------------------
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${cl(n >> 16)},${cl((n >> 8) & 255)},${cl(n & 255)})`;
}

export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// Beveled block with a coloured outline, lit top face, shadowed bottom+right.
export function block(ctx, x, y, w, h, R, outline = true) {
  if (outline) { ctx.fillStyle = R.o; ctx.fillRect(x - 1, y - 1, w + 2, h + 2); }
  ctx.fillStyle = R.b; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = R.l; ctx.fillRect(x, y, w, Math.max(1, h * 0.22));
  ctx.fillStyle = R.h; ctx.fillRect(x, y, Math.max(2, w * 0.25), 1);
  ctx.fillStyle = R.d; ctx.fillRect(x, y + h - Math.max(1, h * 0.18), w, Math.max(1, h * 0.18));
  ctx.fillStyle = R.d; ctx.fillRect(x + w - 1, y + 1, 1, h - 1);
}

// A neon stroke: a wide soft halo, a mid line, and a hot core. Neon is the only
// thing in this game allowed to be fully saturated.
export function neonLine(ctx, pts, col, width = 2, glow = 1) {
  if (pts.length < 2) return;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(col.deep, 0.30 * glow); ctx.lineWidth = width * 5; path(); ctx.stroke();
  ctx.strokeStyle = withAlpha(col.mid, 0.42 * glow); ctx.lineWidth = width * 2.4; path(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = col.mid; ctx.lineWidth = width; path(); ctx.stroke();
  ctx.strokeStyle = col.core; ctx.lineWidth = Math.max(0.6, width * 0.4); path(); ctx.stroke();
}

// A point light pooled on the ground (street lamps, muzzle flash, sirens).
export function pointLight(ctx, x, y, r, col, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, withAlpha(col, a));
  g.addColorStop(0.5, withAlpha(col, a * 0.28));
  g.addColorStop(1, withAlpha(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}
