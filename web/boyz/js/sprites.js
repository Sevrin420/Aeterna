// Characters and vehicles, drawn directly in isometric space.
//
// Same rules as the abbey's sprite work: five-step ramps, one consistent
// upper-left key light, and every shape ringed in a dark version of its OWN
// hue rather than black. At this size a figure is carried by silhouette — the
// cap, the bandana, the hood — not by facial detail, so faces are two dark
// marks and nothing else, exactly as LttP draws an overworld sprite.

import { toScreen, TW, TH } from './iso.js';
import { SHADOW, SHADOW_SOFT, CHROME, STEEL, RUBBER, GLASS, withAlpha, HEADLIGHT, SIREN } from './palette.js';

// Facing -> a screen-space nudge, so the figure leans the way it walks.
const FACE = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7],
};

export function dirFromVec(dx, dy) {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return 's';
  const a = Math.atan2(dy, dx);
  const o = Math.round((a / (Math.PI / 4)) + 8) % 8;
  return ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'][o];
}

// ---------------------------------------------------------------------------
// A person. `look` is a BOYZ/CABAL/COP entry: { skin, cloth, accent, cap }.
// h is the figure's height in screen px (scales the whole thing).
export function drawPerson(ctx, wx, wy, wz, look, dir = 's', walk = 0, h = 26, opts = {}) {
  const s = toScreen(wx, wy, wz);
  const x = Math.round(s.x), y = Math.round(s.y);
  const u = h / 26;                 // unit scale
  const back = dir === 'n' || dir === 'ne' || dir === 'nw';
  const side = dir === 'e' || dir === 'w';
  const flip = dir === 'w' || dir === 'nw' || dir === 'sw';

  // contact shadow — cold blue-black, never neutral
  ctx.fillStyle = SHADOW;
  ctx.beginPath(); ctx.ellipse(x, y, 5.5 * u, 2.6 * u, 0, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);

  const bob = Math.sin(walk * 8) * 0.8 * u;
  const step = Math.sin(walk * 8);
  const C = look.cloth, A = look.accent, S = look.skin, K = look.cap || look.cloth;

  // legs
  ctx.fillStyle = C.o;
  ctx.fillRect(-3.6 * u, -8 * u, 3 * u, 8 * u);
  ctx.fillRect(0.6 * u, -8 * u, 3 * u, 8 * u);
  ctx.fillStyle = C.d;
  ctx.fillRect(-3.2 * u, -8 * u + step * 1.2 * u, 2.4 * u, 7.6 * u);
  ctx.fillRect(0.9 * u, -8 * u - step * 1.2 * u, 2.4 * u, 7.6 * u);
  // kicks
  ctx.fillStyle = CHROME.l;
  ctx.fillRect(-3.6 * u, -1.4 * u + step * 1.2 * u, 3.2 * u, 1.4 * u);
  ctx.fillRect(0.6 * u, -1.4 * u - step * 1.2 * u, 3.2 * u, 1.4 * u);

  // torso — the hoodie
  const ty = -18 * u + bob;
  ctx.fillStyle = C.o; ctx.fillRect(-5 * u, ty, 10 * u, 10.5 * u);
  ctx.fillStyle = C.b; ctx.fillRect(-4.2 * u, ty + 0.6 * u, 8.4 * u, 9.4 * u);
  ctx.fillStyle = C.l; ctx.fillRect(-4.2 * u, ty + 0.6 * u, 8.4 * u, 2 * u);   // lit shoulders
  ctx.fillStyle = C.h; ctx.fillRect(-4.2 * u, ty + 0.6 * u, 2.4 * u, 0.9 * u);
  ctx.fillStyle = C.d; ctx.fillRect(-4.2 * u, ty + 8 * u, 8.4 * u, 2 * u);
  // hood bunched at the neck
  ctx.fillStyle = C.d; ctx.fillRect(-4.6 * u, ty - 0.8 * u, 9.2 * u, 2.2 * u);

  // arms
  ctx.fillStyle = C.o;
  ctx.fillRect(-6.6 * u, ty + 1.4 * u, 2.6 * u, 7 * u);
  ctx.fillRect(4 * u, ty + 1.4 * u, 2.6 * u, 7 * u);
  ctx.fillStyle = C.b;
  ctx.fillRect(-6.2 * u, ty + 1.4 * u - step * 0.9 * u, 2 * u, 6.6 * u);
  ctx.fillRect(4.2 * u, ty + 1.4 * u + step * 0.9 * u, 2 * u, 6.6 * u);

  // head
  const hy = ty - 9 * u;
  ctx.fillStyle = S.o; ctx.fillRect(-4.6 * u, hy, 9.2 * u, 9.4 * u);
  ctx.fillStyle = S.b; ctx.fillRect(-4 * u, hy + 0.6 * u, 8 * u, 8.4 * u);
  ctx.fillStyle = S.l; ctx.fillRect(-4 * u, hy + 0.6 * u, 8 * u, 2.2 * u);
  ctx.fillStyle = S.h; ctx.fillRect(-4 * u, hy + 0.6 * u, 2.2 * u, 1 * u);
  ctx.fillStyle = S.d; ctx.fillRect(2.6 * u, hy + 0.6 * u, 1.4 * u, 8.4 * u);

  if (!back) {
    // the bandana over the lower face — the crew's whole identity
    ctx.fillStyle = A.o; ctx.fillRect(-4.4 * u, hy + 4.6 * u, 8.8 * u, 5 * u);
    ctx.fillStyle = A.b; ctx.fillRect(-4 * u, hy + 5 * u, 8 * u, 4.2 * u);
    ctx.fillStyle = A.l; ctx.fillRect(-4 * u, hy + 5 * u, 8 * u, 1.1 * u);
    ctx.fillStyle = A.d; ctx.fillRect(-4 * u, hy + 8.2 * u, 8 * u, 1 * u);
    // eyes: two dark marks, nothing more
    ctx.fillStyle = S.o;
    if (side) {
      ctx.fillRect(1.2 * u, hy + 2.4 * u, 1.8 * u, 2 * u);
    } else {
      ctx.fillRect(-2.8 * u, hy + 2.4 * u, 1.8 * u, 2 * u);
      ctx.fillRect(1 * u, hy + 2.4 * u, 1.8 * u, 2 * u);
    }
  }

  // cap, worn low
  ctx.fillStyle = K.o; ctx.fillRect(-5 * u, hy - 2.4 * u, 10 * u, 4 * u);
  ctx.fillStyle = K.b; ctx.fillRect(-4.6 * u, hy - 2 * u, 9.2 * u, 3.2 * u);
  ctx.fillStyle = K.l; ctx.fillRect(-4.6 * u, hy - 2 * u, 9.2 * u, 1.2 * u);
  ctx.fillStyle = K.h; ctx.fillRect(-4.6 * u, hy - 2 * u, 2.4 * u, 0.7 * u);
  if (!back) { ctx.fillStyle = K.o; ctx.fillRect(-5.4 * u, hy + 0.8 * u, 11 * u, 1.4 * u); }  // brim

  // held weapon
  if (opts.weapon === 'gun') {
    ctx.fillStyle = STEEL.o; ctx.fillRect(5 * u, ty + 4 * u, 5.5 * u, 1.8 * u);
    ctx.fillStyle = STEEL.b; ctx.fillRect(5 * u, ty + 4.2 * u, 5 * u, 1.2 * u);
  } else if (opts.weapon === 'bat') {
    ctx.fillStyle = '#432b17'; ctx.fillRect(5 * u, ty + 1 * u, 1.6 * u, 8 * u);
  }

  ctx.restore();

  // muzzle flash sits outside the flip so it points the right way
  if (opts.flash) {
    const [fx, fy] = FACE[dir] || FACE.s;
    const mx = x + fx * 11 * u, my = y - 12 * u + fy * 6 * u;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, 12 * u);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,224,138,0.5)');
    g.addColorStop(1, 'rgba(255,154,42,0)');
    ctx.fillStyle = g; ctx.fillRect(mx - 12 * u, my - 12 * u, 24 * u, 24 * u);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// A car, drawn as an extruded body in iso with the roof lit. `ang` is the
// world-space heading in radians. Bodies are dark; the read comes from chrome,
// glass, lights and the paint's one saturated step.
export function drawCar(ctx, wx, wy, ang, paint, opts = {}) {
  const s = toScreen(wx, wy, 0);
  const x = Math.round(s.x), y = Math.round(s.y);
  const L = opts.len || 2.1, Wd = opts.wid || 1.0, Ht = opts.ht || 0.55;

  // Corners of the footprint in world space, rotated, then projected. Doing it
  // this way (rather than rotating the canvas) keeps the iso foreshortening
  // correct at every heading — a rotated sprite would look wrong side-on.
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const corner = (fx, fy, h) => {
    const rx = fx * ca - fy * sa, ry = fx * sa + fy * ca;
    const p = toScreen(wx + rx, wy + ry, h);
    return [p.x, p.y];
  };
  const gp = [corner(-L, -Wd, 0), corner(L, -Wd, 0), corner(L, Wd, 0), corner(-L, Wd, 0)];
  const rp = [corner(-L, -Wd, Ht), corner(L, -Wd, Ht), corner(L, Wd, Ht), corner(-L, Wd, Ht)];

  // shadow
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.moveTo(gp[0][0], gp[0][1] + 2);
  for (let i = 1; i < 4; i++) ctx.lineTo(gp[i][0], gp[i][1] + 2);
  ctx.closePath(); ctx.fill();

  // sides
  ctx.fillStyle = paint.d;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    ctx.beginPath();
    ctx.moveTo(gp[i][0], gp[i][1]); ctx.lineTo(gp[j][0], gp[j][1]);
    ctx.lineTo(rp[j][0], rp[j][1]); ctx.lineTo(rp[i][0], rp[i][1]);
    ctx.closePath(); ctx.fill();
  }
  // roof
  ctx.fillStyle = paint.b;
  ctx.beginPath();
  ctx.moveTo(rp[0][0], rp[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(rp[i][0], rp[i][1]);
  ctx.closePath(); ctx.fill();
  // lit leading edge + outline
  ctx.strokeStyle = paint.o; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rp[0][0], rp[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(rp[i][0], rp[i][1]);
  ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = paint.h; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rp[0][0], rp[0][1]); ctx.lineTo(rp[3][0], rp[3][1]); ctx.stroke();

  // glasshouse: a smaller quad inset on the roof
  const gc = [corner(-L * 0.45, -Wd * 0.72, Ht), corner(L * 0.5, -Wd * 0.72, Ht),
    corner(L * 0.5, Wd * 0.72, Ht), corner(-L * 0.45, Wd * 0.72, Ht)];
  ctx.fillStyle = GLASS.d;
  ctx.beginPath();
  ctx.moveTo(gc[0][0], gc[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(gc[i][0], gc[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = withAlpha(GLASS.h, 0.35);
  ctx.beginPath();
  ctx.moveTo(gc[0][0], gc[0][1]); ctx.lineTo(gc[1][0], gc[1][1]);
  ctx.lineTo(gc[1][0], gc[1][1] + 2); ctx.lineTo(gc[0][0], gc[0][1] + 2);
  ctx.closePath(); ctx.fill();

  // headlights + beam
  const hl = corner(L, 0, Ht * 0.4);
  ctx.fillStyle = HEADLIGHT.hot;
  ctx.beginPath(); ctx.arc(hl[0], hl[1], 1.6, 0, Math.PI * 2); ctx.fill();
  if (opts.lights !== false) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const far = corner(L + 9, 0, 0);
    const gl = ctx.createRadialGradient(hl[0], hl[1], 1, far[0], far[1], 60);
    gl.addColorStop(0, 'rgba(255,242,192,0.30)');
    gl.addColorStop(1, 'rgba(255,212,92,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.moveTo(hl[0], hl[1]);
    const a1 = corner(L + 11, -5, 0), a2 = corner(L + 11, 5, 0);
    ctx.lineTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // police bar
  if (opts.siren) {
    const t = opts.sirenPhase || 0;
    const p = corner(0, 0, Ht + 0.25);
    ctx.fillStyle = Math.sin(t * 12) > 0 ? SIREN.red : SIREN.blue;
    ctx.fillRect(p[0] - 6, p[1] - 2, 12, 3);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const c = Math.sin(t * 12) > 0 ? SIREN.red : SIREN.blue;
    const g2 = ctx.createRadialGradient(p[0], p[1], 1, p[0], p[1], 34);
    g2.addColorStop(0, withAlpha(c, 0.5)); g2.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g2; ctx.fillRect(p[0] - 34, p[1] - 34, 68, 68);
    ctx.restore();
  }
}

// A pickup / objective marker: a rotating neon column you can see over traffic.
export function drawMarker(ctx, wx, wy, col, t, label) {
  const s = toScreen(wx, wy, 0);
  const pulse = 0.6 + Math.sin(t * 3) * 0.4;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, 26);
  g.addColorStop(0, withAlpha(col.mid, 0.42 * pulse));
  g.addColorStop(1, withAlpha(col.mid, 0));
  ctx.fillStyle = g; ctx.fillRect(s.x - 26, s.y - 26, 52, 52);
  ctx.restore();
  // ground ring
  ctx.strokeStyle = col.mid; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(s.x, s.y, TW * 0.85, TH * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
  // column
  const hgt = 22 + Math.sin(t * 3) * 3;
  const grd = ctx.createLinearGradient(0, s.y - hgt, 0, s.y);
  grd.addColorStop(0, withAlpha(col.core, 0));
  grd.addColorStop(1, withAlpha(col.core, 0.55));
  ctx.fillStyle = grd;
  ctx.fillRect(s.x - 3, s.y - hgt, 6, hgt);
  if (label) {
    ctx.font = '7px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = col.core;
    ctx.fillText(label, s.x, s.y - hgt - 4);
    ctx.textAlign = 'left';
  }
}
