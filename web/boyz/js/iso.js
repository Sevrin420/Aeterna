// 2.5D isometric projection.
//
// The world is a flat grid in (wx, wy) with a separate height axis wz. Gameplay
// — movement, collision, AI, shooting — all happens in that flat world space,
// which keeps it simple; only rendering goes through the iso transform. That
// separation is what stops isometric games turning into a maths swamp.
//
//   screen.x = (wx - wy) * TW
//   screen.y = (wx + wy) * TH - wz * ZH
//
// TW/TH at 2:1 gives the classic SNES-era diamond. One world unit is one metre-
// ish; a car is ~4 long, a person ~0.8 wide.

export const TW = 16;   // half-width of a ground tile in screen px
export const TH = 8;    // half-height (2:1 iso)
export const ZH = 14;   // screen px per world height unit

export function toScreen(wx, wy, wz = 0) {
  return { x: (wx - wy) * TW, y: (wx + wy) * TH - wz * ZH };
}

// Inverse, for picking a world point from a screen point (ground plane, wz=0).
export function toWorld(sx, sy) {
  return { x: (sx / TW + sy / TH) / 2, y: (sy / TH - sx / TW) / 2 };
}

// Depth key. Anything further "into" the screen draws first. Ties are broken by
// height so a rooftop prop sits over the roof it stands on.
export function depth(wx, wy, wz = 0) { return (wx + wy) * 64 + wz; }

// ---------------------------------------------------------------------------
// Extruded box — the workhorse for buildings, kerbs, crates, cars.
// Draws the two visible side faces (south-west and south-east) plus the top,
// each on its own step of the ramp so the form reads without an outline pass.
// x,y is the box's min corner in world space; w,d are its footprint; h its
// height. `base` lifts it (for things stacked on a roof).
export function drawBox(ctx, R, wx, wy, w, d, h, base = 0) {
  const top = base + h;
  // the four top corners
  const a = toScreen(wx, wy, top);              // north (back)
  const b = toScreen(wx + w, wy, top);          // east (right)
  const c = toScreen(wx + w, wy + d, top);      // south (front)
  const e = toScreen(wx, wy + d, top);          // west (left)
  // the two front-facing bottom corners
  const bb = toScreen(wx + w, wy, base);
  const cb = toScreen(wx + w, wy + d, base);
  const eb = toScreen(wx, wy + d, base);

  // south-east face (catches least light — this is the turning-away side)
  ctx.fillStyle = R.d;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(cb.x, cb.y); ctx.lineTo(bb.x, bb.y);
  ctx.closePath(); ctx.fill();
  // south-west face
  ctx.fillStyle = R.b;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y); ctx.lineTo(c.x, c.y); ctx.lineTo(cb.x, cb.y); ctx.lineTo(eb.x, eb.y);
  ctx.closePath(); ctx.fill();
  // top face — the lit plane
  ctx.fillStyle = R.l;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y);
  ctx.closePath(); ctx.fill();
  // outline in the material's own darkest step, and a highlight along the
  // upper-left roof edge (the key light)
  ctx.strokeStyle = R.o; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y);
  ctx.closePath(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(e.x, e.y); ctx.lineTo(eb.x, eb.y);
  ctx.moveTo(c.x, c.y); ctx.lineTo(cb.x, cb.y);
  ctx.moveTo(b.x, b.y); ctx.lineTo(bb.x, bb.y);
  ctx.stroke();
  ctx.strokeStyle = R.h; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
}

// A flat diamond on the ground plane — road, pavement, water, park.
export function drawTile(ctx, wx, wy, fill, wz = 0) {
  const a = toScreen(wx, wy, wz);
  const b = toScreen(wx + 1, wy, wz);
  const c = toScreen(wx + 1, wy + 1, wz);
  const e = toScreen(wx, wy + 1, wz);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y);
  ctx.closePath(); ctx.fill();
}

// A quad spanning a rect of the ground plane (cheaper than per-tile diamonds
// when a whole block shares one colour).
export function drawQuad(ctx, wx, wy, w, d, fill, wz = 0) {
  const a = toScreen(wx, wy, wz);
  const b = toScreen(wx + w, wy, wz);
  const c = toScreen(wx + w, wy + d, wz);
  const e = toScreen(wx, wy + d, wz);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y);
  ctx.closePath(); ctx.fill();
}

// A ground-plane polyline in world coords -> screen points, for neon turf
// borders and lane markings.
export function projectPath(pts, wz = 0) {
  return pts.map(([x, y]) => { const s = toScreen(x, y, wz); return [s.x, s.y]; });
}

// Shadow ellipse on the ground under an entity.
export function groundShadow(ctx, wx, wy, rx, col) {
  const s = toScreen(wx, wy, 0);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx * TW * 0.9, rx * TH * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
}
