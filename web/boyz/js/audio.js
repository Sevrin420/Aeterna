// BOYZ N THE HOOD — sound.
//
// Entirely synthesised at runtime. There are no audio files anywhere in this
// project and there is no build step, so every sound here is built out of
// oscillators, one shared noise buffer, and filters. That constraint turns out
// to suit the game: a 16-bit city wants sounds with edges, not samples.
//
// Structure is a small mixer rather than a pile of one-shots:
//
//   sources ─┬─► sfx bus ────┐
//            ├─► engine bus ─┼─► master ─► compressor ─► out
//            └─► ambience ───┘
//
// The compressor is not decoration. Ten overlapping gunshots plus an explosion
// plus an engine will clip hard into the destination node, and clipping in
// WebAudio sounds like the tab is broken. One limiter on the end fixes it.
//
// Everything is lazy: no AudioContext exists until the first sound, because
// browsers refuse to start one before a user gesture and a suspended context
// throws on every call.

const MASTER_KEY = 'boyz_audio';

let ctx = null;
let master = null, busSfx = null, busEngine = null, busAmb = null;
let noiseBuf = null;
let engineNodes = null;
let ambNodes = null;
let muted = false;
try { muted = localStorage.getItem(MASTER_KEY) === 'off'; } catch { /* private mode */ }

function init() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return false; }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 10;
  comp.attack.value = 0.004;
  comp.release.value = 0.16;
  comp.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.85;
  master.connect(comp);

  busSfx = ctx.createGain(); busSfx.gain.value = 0.9; busSfx.connect(master);
  busEngine = ctx.createGain(); busEngine.gain.value = 0.5; busEngine.connect(master);
  busAmb = ctx.createGain(); busAmb.gain.value = 0.35; busAmb.connect(master);

  // One second of white noise, reused by every impact, shot and skid. Cheaper
  // than generating a buffer per sound and it never runs out because each
  // player starts at a random offset.
  const n = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, n, n);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

function ready() {
  if (!init()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// --- small builders -------------------------------------------------------
function noise(dur, offset = Math.random() * 0.8) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(ctx.currentTime, offset, dur + 0.05);
  s.stop(ctx.currentTime + dur + 0.05);
  return s;
}

function env(peak, dur, shape = 'exp', delay = 0) {
  const g = ctx.createGain();
  const t = ctx.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  if (shape === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  else g.gain.linearRampToValueAtTime(0.0001, t + dur);
  return g;
}

function filt(type, freq, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}

function tone(type, f0, f1, dur, peak, delay = 0) {
  const o = ctx.createOscillator();
  const t = ctx.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = env(peak, dur, 'exp', delay);
  o.connect(g);
  o.start(t); o.stop(t + dur + 0.02);
  return g;
}

// --- one-shots ------------------------------------------------------------
// Each of these is a body plus a transient. A gunshot that is only a noise
// burst sounds like a hiss; the low thump underneath it is what makes it read
// as a weapon rather than static.
const SHOTS = {
  pistol: { crackHz: 1800, bodyHz: 190, dur: 0.13, peak: 0.30 },
  smg: { crackHz: 2400, bodyHz: 240, dur: 0.08, peak: 0.22 },
  shotgun: { crackHz: 1100, bodyHz: 110, dur: 0.26, peak: 0.42 },
  rifle: { crackHz: 3000, bodyHz: 150, dur: 0.18, peak: 0.36 },
};

function shot(weapon = 'pistol', gain = 1) {
  const s = SHOTS[weapon] || SHOTS.pistol;
  // crack: bright noise through a bandpass, gone almost instantly
  const nz = noise(s.dur);
  const bp = filt('bandpass', s.crackHz, 0.8);
  const g1 = env(s.peak * gain, s.dur * 0.55);
  nz.connect(bp); bp.connect(g1); g1.connect(busSfx);
  // body: a short pitch drop, which is the part you feel
  tone('square', s.bodyHz, s.bodyHz * 0.35, s.dur, s.peak * 0.55 * gain).connect(busSfx);
  // tail: the street bouncing it back, delayed and dull
  const tail = noise(0.18);
  const lp = filt('lowpass', 900);
  const g2 = env(s.peak * 0.16 * gain, 0.18, 'exp', 0.035);
  tail.connect(lp); lp.connect(g2); g2.connect(busSfx);
}

function hit(gain = 1) {
  const nz = noise(0.12);
  const bp = filt('bandpass', 420, 1.4);
  const g = env(0.24 * gain, 0.12);
  nz.connect(bp); bp.connect(g); g.connect(busSfx);
  tone('sawtooth', 150, 60, 0.14, 0.16 * gain).connect(busSfx);
}

function crash(force = 1) {
  const f = Math.max(0.3, Math.min(1.6, force));
  // metal: bright noise with a resonant peak, plus a crumple underneath
  const nz = noise(0.3);
  const bp = filt('bandpass', 2600, 3.5);
  const g = env(0.3 * f, 0.28);
  nz.connect(bp); bp.connect(g); g.connect(busSfx);
  const nz2 = noise(0.22);
  const lp = filt('lowpass', 700);
  const g2 = env(0.34 * f, 0.22);
  nz2.connect(lp); lp.connect(g2); g2.connect(busSfx);
  tone('square', 220 * f, 55, 0.2, 0.2 * f).connect(busSfx);
}

function boom() {
  // Sub first, then the debris. The order matters: a blast that starts with
  // its noise reads as a bin lid, one that starts with the sub reads as a car.
  tone('sine', 130, 22, 0.85, 0.75).connect(busSfx);
  tone('sawtooth', 90, 30, 0.4, 0.3).connect(busSfx);
  const nz = noise(0.9);
  const lp = filt('lowpass', 1600);
  lp.frequency.setValueAtTime(2600, ctx.currentTime);
  lp.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.8);
  const g = env(0.5, 0.85);
  nz.connect(lp); lp.connect(g); g.connect(busSfx);
}

function pickup() {
  tone('triangle', 620, 1240, 0.16, 0.22).connect(busSfx);
  tone('triangle', 930, 1860, 0.12, 0.10, 0.05).connect(busSfx);
}

function good() {
  // a small rising third, the one deliberately musical sound in the game
  tone('triangle', 523, 523, 0.16, 0.16).connect(busSfx);
  tone('triangle', 659, 659, 0.2, 0.16, 0.09).connect(busSfx);
  tone('triangle', 784, 784, 0.3, 0.15, 0.18).connect(busSfx);
}

function bad() {
  tone('sawtooth', 220, 110, 0.34, 0.2).connect(busSfx);
  tone('sawtooth', 164, 82, 0.4, 0.16, 0.07).connect(busSfx);
}

function skid(gain = 1) {
  const nz = noise(0.34);
  const bp = filt('bandpass', 1500, 6);
  const g = env(0.2 * gain, 0.34, 'lin');
  nz.connect(bp); bp.connect(g); g.connect(busSfx);
}

const ONE_SHOTS = { hit, crash, boom, pickup, good, bad, skid };

export function sfx(kind, arg) {
  if (!ready() || muted) return;
  try {
    if (kind === 'shot') shot(arg);
    else ONE_SHOTS[kind]?.(arg);
  } catch { /* audio is never worth throwing over */ }
}

// --- the car you are driving ----------------------------------------------
// A continuous voice rather than a one-shot: two detuned saws through a lowpass
// that both open up with speed. Detuning is what stops it sounding like a test
// tone — two oscillators a few cents apart beat against each other and the
// result reads as an engine.
function startEngine() {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'sawtooth';
  o2.detune.value = 14;
  const lp = filt('lowpass', 300, 3);
  const g = ctx.createGain(); g.gain.value = 0;
  // a little grit, so it is not a pure synth pad
  const nz = ctx.createBufferSource();
  nz.buffer = noiseBuf; nz.loop = true;
  const nlp = filt('lowpass', 220);
  const ng = ctx.createGain(); ng.gain.value = 0;
  nz.connect(nlp); nlp.connect(ng); ng.connect(g);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(busEngine);
  o1.start(); o2.start(); nz.start();
  return { o1, o2, lp, g, ng, nz };
}

// Called every frame with the player's car, or null when on foot.
export function engine(car) {
  if (muted || !ready()) return;
  if (!car) {
    if (engineNodes) engineNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    return;
  }
  if (!engineNodes) engineNodes = startEngine();
  const e = engineNodes;
  const top = car.topSpeed || 16;
  const rev = Math.min(1, Math.abs(car.speed) / top);
  // Fake a gearbox: pitch climbs through a gear then drops as it changes up.
  // Constant pitch across the whole speed range sounds like a milk float.
  const gear = Math.min(3, Math.floor(rev * 4));
  const within = rev * 4 - gear;
  const hz = 42 + within * 46 + gear * 8;
  const t = ctx.currentTime;
  e.o1.frequency.setTargetAtTime(hz, t, 0.05);
  e.o2.frequency.setTargetAtTime(hz * 1.005, t, 0.05);
  e.lp.frequency.setTargetAtTime(240 + rev * 1500, t, 0.06);
  e.g.gain.setTargetAtTime(0.1 + rev * 0.2, t, 0.06);
  e.ng.gain.setTargetAtTime(0.05 + rev * 0.14, t, 0.06);
}

// --- ambience -------------------------------------------------------------
// A city bed: filtered noise for distant traffic, plus a very low hum. Kept
// under everything else — you should only notice it when it stops.
function startAmbience() {
  const nz = ctx.createBufferSource();
  nz.buffer = noiseBuf; nz.loop = true;
  const lp = filt('lowpass', 420);
  const hp = filt('highpass', 90);
  const g = ctx.createGain(); g.gain.value = 0.16;
  nz.connect(hp); hp.connect(lp); lp.connect(g); g.connect(busAmb);
  nz.start();

  const hum = ctx.createOscillator();
  hum.type = 'sine'; hum.frequency.value = 56;
  const hg = ctx.createGain(); hg.gain.value = 0.07;
  hum.connect(hg); hg.connect(busAmb);
  hum.start();
  return { nz, lp, g, hum, hg };
}

// Heat raises the bed and detunes the hum, so a five-star chase sounds
// different from an empty street before any siren is audible.
export function ambience(wanted = 0) {
  if (muted || !ready()) return;
  if (!ambNodes) ambNodes = startAmbience();
  const t = ctx.currentTime;
  ambNodes.g.gain.setTargetAtTime(0.14 + wanted * 0.04, t, 0.4);
  ambNodes.lp.frequency.setTargetAtTime(420 + wanted * 260, t, 0.4);
  ambNodes.hg.gain.setTargetAtTime(0.06 + wanted * 0.02, t, 0.4);
}

// --- sirens ---------------------------------------------------------------
// One voice for the whole police presence rather than one per car: a dozen
// overlapping two-tone wails is noise, and the player only needs to know how
// close the nearest one is. `dist` is in world cells; null silences it.
let sirenNodes = null;
export function siren(dist) {
  if (muted || !ready()) return;
  if (dist == null || dist > 42) {
    if (sirenNodes) sirenNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    return;
  }
  if (!sirenNodes) {
    const o = ctx.createOscillator(); o.type = 'square';
    const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 1.1;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 190;
    lfo.connect(lfoAmt); lfoAmt.connect(o.frequency);
    o.frequency.value = 760;
    const bp = filt('bandpass', 900, 2);
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(bp); bp.connect(g); g.connect(busSfx);
    o.start(); lfo.start();
    sirenNodes = { o, g, bp };
  }
  // inverse falloff, and dull it with distance the way a real street does
  const near = 1 - Math.min(1, dist / 42);
  sirenNodes.g.gain.setTargetAtTime(0.02 + near * near * 0.14, ctx.currentTime, 0.12);
  sirenNodes.bp.frequency.setTargetAtTime(500 + near * 900, ctx.currentTime, 0.2);
}

// --- control --------------------------------------------------------------
export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem(MASTER_KEY, muted ? 'off' : 'on'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.05);
  return muted;
}

// Duck everything while the pause menu is open, so the engine doesn't idle
// forever behind a static screen.
export function setPaused(on) {
  if (!ctx || muted) return;
  master.gain.setTargetAtTime(on ? 0.12 : 0.85, ctx.currentTime, 0.08);
}
