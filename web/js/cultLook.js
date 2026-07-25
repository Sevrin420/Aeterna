// Shared "cult look": trait rolling + regalia drawing, used by BOTH the
// in-game character rendering and the NFT art compositor, so a Cultist looks
// the same walking around the sanctuary as it does on its NFT.
//
// Regalia is split into a BACK pass (halo, horns — drawn behind the body) and
// a FRONT pass (hood, skull mask, held item — drawn over the body). Backgrounds
// are NFT-only and live in the compositor, not here.

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rngFor(seed) { let h = 2166136261; const s = 'cult' + seed; for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619)) >>> 0; return mulberry32(h); }
function wpick(r, table) { const tot = table.reduce((a, x) => a + x[1], 0); let v = r() * tot; for (const [k, w] of table) { if ((v -= w) < 0) return k; } return table[0][0]; }

export const TRAIT_TABLES = {
  bg:   [['crypt', 60], ['ritual', 26], ['hellfire', 10], ['void', 4]],
  hood: [['cowl', 52], ['none', 30], ['horned', 12], ['gilded', 6]],
  face: [['none', 78], ['skull', 22]],
  hold: [['none', 46], ['candle', 28], ['dagger', 14], ['skull', 12]],
  halo: [['none', 86], ['crossHalo', 14]],
  robe: [['wool', 95], ['blood', 5]],
};

export function rollCultTraits(seed) {
  const r = rngFor(seed);
  return {
    bg: wpick(r, TRAIT_TABLES.bg),
    hood: wpick(r, TRAIT_TABLES.hood),
    face: wpick(r, TRAIT_TABLES.face),
    hold: wpick(r, TRAIT_TABLES.hold),
    halo: wpick(r, TRAIT_TABLES.halo),
    robe: wpick(r, TRAIT_TABLES.robe),
  };
}

// blood robes are a sprite-build override (not a paint-over) so the shading is
// correct; the game/compositor apply this to the traits before generating.
export function applyRobe(tr, robe) {
  if (robe === 'blood') { tr.hat = '#7a1620'; tr.coat = '#7a1620'; tr.pants = '#4a0e12'; tr.cloak = '#5c1016'; }
  return tr;
}

// In the side-facing (left/right) sprite frames the head is drawn off-centre,
// toward the way the figure looks, and reads narrower (a profile). The regalia
// paths are authored around the head centre, so for side views we shift the
// head anchor toward the face and slim it — otherwise the hood/horns/skull
// float beside the head with a gap. Front/back frames (default) are unchanged,
// so NFT art and up/down walking frames render exactly as before.
function geom(cx, top, w, h, dir) {
  const side = dir === 'left' || dir === 'right';
  const off = dir === 'left' ? -w * 0.15 : dir === 'right' ? w * 0.15 : 0;
  return {
    cx, headCx: cx + off, headTop: top + h * 0.04,
    headW: w * (side ? 0.54 : 0.62), headH: h * 0.44,
    top, w, h, groundY: top + h, dir, side,
  };
}

export function drawRegaliaBack(ctx, cx, top, w, h, tr, dir = 'down') {
  const { headCx, headTop, headW, headH } = geom(cx, top, w, h, dir);
  if (tr.halo === 'crossHalo') {
    const R = headH * 0.95;
    const gg = ctx.createRadialGradient(headCx, headTop + headH * 0.4, 1, headCx, headTop + headH * 0.4, R);
    gg.addColorStop(0, 'rgba(220,40,40,0.5)'); gg.addColorStop(1, 'rgba(220,40,40,0)');
    ctx.fillStyle = gg; ctx.fillRect(headCx - R, headTop + headH * 0.4 - R, R * 2, R * 2);
    ctx.fillStyle = 'rgba(255,90,80,0.85)';
    ctx.fillRect(headCx - headW * 0.06, headTop - headH * 0.62, headW * 0.12, headH * 0.95);
    ctx.fillRect(headCx - headW * 0.3, headTop - headH * 0.06, headW * 0.6, headH * 0.12);
  }
  if (tr.hood === 'horned') {
    ctx.fillStyle = '#1c1116'; ctx.strokeStyle = '#3a2530'; ctx.lineWidth = Math.max(0.5, h * 0.012);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(headCx + s * headW * 0.5, headTop + headH * 0.15);
      ctx.quadraticCurveTo(headCx + s * headW * 0.95, headTop - headH * 0.3, headCx + s * headW * 0.62, headTop - headH * 0.5);
      ctx.quadraticCurveTo(headCx + s * headW * 0.7, headTop - headH * 0.1, headCx + s * headW * 0.38, headTop + headH * 0.08);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

export function drawRegaliaFront(ctx, cx, top, w, h, tr, dir = 'down') {
  const { headCx, headTop, headW, headH, groundY } = geom(cx, top, w, h, dir);
  if (tr.hood !== 'none') {
    const base = tr.hood === 'gilded' ? '#2a2018' : '#171018';
    const edge = tr.hood === 'gilded' ? '#b8933f' : '#33242e';
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(headCx, headTop - headH * 0.34);
    ctx.quadraticCurveTo(headCx - headW * 1.05, headTop - headH * 0.1, headCx - headW * 0.98, headTop + headH * 0.62);
    ctx.lineTo(headCx - headW * 0.62, headTop + headH * 0.58);
    ctx.quadraticCurveTo(headCx - headW * 0.5, headTop + headH * 0.02, headCx, headTop - headH * 0.06);
    ctx.quadraticCurveTo(headCx + headW * 0.5, headTop + headH * 0.02, headCx + headW * 0.62, headTop + headH * 0.58);
    ctx.lineTo(headCx + headW * 0.98, headTop + headH * 0.62);
    ctx.quadraticCurveTo(headCx + headW * 1.05, headTop - headH * 0.1, headCx, headTop - headH * 0.34);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = Math.max(0.5, h * 0.012); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = Math.max(0.7, h * 0.018);
    ctx.beginPath();
    ctx.moveTo(headCx - headW * 0.5, headTop + headH * 0.5);
    ctx.quadraticCurveTo(headCx - headW * 0.46, headTop + headH * 0.05, headCx, headTop);
    ctx.quadraticCurveTo(headCx + headW * 0.46, headTop + headH * 0.05, headCx + headW * 0.5, headTop + headH * 0.5);
    ctx.stroke();
  }
  if (tr.face === 'skull') drawSkull(ctx, headCx, headTop + headH * 0.03, headW * 0.94, headH * 1.02);
  if (tr.hood === 'gilded') {
    ctx.fillStyle = '#e6c766';
    ctx.fillRect(headCx - headW * 0.03, headTop - headH * 0.3, headW * 0.06, headH * 0.22);
    ctx.fillRect(headCx - headW * 0.09, headTop - headH * 0.16, headW * 0.18, headH * 0.05);
  }
  const hx = cx + w * 0.34;
  if (tr.hold === 'candle') {
    const hy = groundY - h * 0.34;
    ctx.fillStyle = '#161318'; ctx.fillRect(hx - w * 0.02, hy, w * 0.04, h * 0.12);
    const fl = ctx.createRadialGradient(hx, hy - h * 0.03, 0, hx, hy - h * 0.03, h * 0.1);
    fl.addColorStop(0, 'rgba(255,180,90,0.9)'); fl.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = fl; ctx.fillRect(hx - h * 0.1, hy - h * 0.11, h * 0.2, h * 0.2);
    ctx.fillStyle = '#ffd58a'; ctx.beginPath(); ctx.ellipse(hx, hy - h * 0.03, w * 0.02, h * 0.03, 0, 0, Math.PI * 2); ctx.fill();
  } else if (tr.hold === 'dagger') {
    const hy = groundY - h * 0.2;
    ctx.strokeStyle = '#c9cdd6'; ctx.lineWidth = Math.max(1, w * 0.03);
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - h * 0.17); ctx.stroke();
    ctx.strokeStyle = '#7a1f26'; ctx.lineWidth = Math.max(1, w * 0.045);
    ctx.beginPath(); ctx.moveTo(hx - w * 0.06, hy); ctx.lineTo(hx + w * 0.06, hy); ctx.stroke();
  } else if (tr.hold === 'skull') {
    const hy = groundY - h * 0.12;
    ctx.fillStyle = '#d8d1bd'; ctx.beginPath(); ctx.arc(hx, hy, h * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a251c'; ctx.fillRect(hx - h * 0.03, hy - h * 0.006, h * 0.02, h * 0.02); ctx.fillRect(hx + h * 0.012, hy - h * 0.006, h * 0.02, h * 0.02);
  }
}

// A full-face skull that COVERS the face (cranium + jaw, sunken sockets,
// nasal cavity, teeth). Scales with w/h so it works at NFT and game sizes.
export function drawSkull(ctx, cx, top, w, h) {
  const PI2 = Math.PI * 2;
  ctx.fillStyle = '#e9e2d0';
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top + h * 0.35);
  ctx.quadraticCurveTo(cx - w / 2, top, cx, top);
  ctx.quadraticCurveTo(cx + w / 2, top, cx + w / 2, top + h * 0.35);
  ctx.quadraticCurveTo(cx + w * 0.5, top + h * 0.68, cx + w * 0.3, top + h * 0.78);
  ctx.lineTo(cx + w * 0.3, top + h);
  ctx.lineTo(cx - w * 0.3, top + h);
  ctx.lineTo(cx - w * 0.3, top + h * 0.78);
  ctx.quadraticCurveTo(cx - w * 0.5, top + h * 0.68, cx - w / 2, top + h * 0.35);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(120,110,92,0.3)'; ctx.fillRect(cx + w * 0.16, top + h * 0.08, w * 0.34, h * 0.62);
  ctx.fillStyle = '#140f0b';
  ctx.beginPath(); ctx.ellipse(cx - w * 0.22, top + h * 0.4, w * 0.17, h * 0.17, 0, 0, PI2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + w * 0.22, top + h * 0.4, w * 0.17, h * 0.17, 0, 0, PI2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, top + h * 0.52); ctx.lineTo(cx - w * 0.09, top + h * 0.66); ctx.lineTo(cx + w * 0.09, top + h * 0.66); ctx.closePath(); ctx.fill();
  for (let i = -3; i <= 2; i++) ctx.fillRect(cx + i * w * 0.1 + w * 0.01, top + h * 0.8, w * 0.06, h * 0.18);
}
