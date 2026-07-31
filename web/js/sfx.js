// Small synthesized sound effects — no audio assets, just short oscillator
// tones. Browsers require a user gesture before audio can play, so the
// AudioContext is created lazily on first call (button presses qualify).

let ctx = null;
let muted = localStorage.getItem('aeterna_muted') === '1';

function getCtx() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    // Some privacy-hardened browsers (e.g. DuckDuckGo, which deliberately
    // instruments/restricts the Web Audio API to defeat audio fingerprinting)
    // can make AudioContext construction or resume() throw or misbehave. These
    // are decorative click sounds — a failure here must never propagate to the
    // caller and block real input handling (that was the root cause of the
    // on-screen d-pad silently not registering presses in such browsers).
    return null;
  }
}

function tone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.15, delay = 0, glideTo = null }) {
  if (muted) return;
  try {
    const c = getCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + delay + duration);
    amp.gain.setValueAtTime(0, c.currentTime + delay);
    amp.gain.linearRampToValueAtTime(gain, c.currentTime + delay + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
    osc.connect(amp).connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.02);
  } catch {
    // ignore — see getCtx() above
  }
}

export const sfx = {
  isMuted() { return muted; },
  toggleMute() {
    muted = !muted;
    localStorage.setItem('aeterna_muted', muted ? '1' : '0');
    return muted;
  },
  setMuted(v) {
    muted = !!v;
    localStorage.setItem('aeterna_muted', muted ? '1' : '0');
    return muted;
  },
  click() {
    tone({ freq: 320, duration: 0.05, type: 'square', gain: 0.036 });
  },
  bootConfirm() {
    tone({ freq: 392, duration: 0.08, type: 'square', gain: 0.078 });
    tone({ freq: 587.33, duration: 0.14, type: 'square', gain: 0.072, delay: 0.08 });
  },
  power(on) {
    if (on) {
      tone({ freq: 220, duration: 0.18, type: 'triangle', gain: 0.072, glideTo: 660 });
    } else {
      tone({ freq: 660, duration: 0.18, type: 'triangle', gain: 0.06, glideTo: 180 });
    }
  },
  dutyComplete() {
    tone({ freq: 523.25, duration: 0.12, type: 'sine', gain: 0.084 });
    tone({ freq: 659.25, duration: 0.16, type: 'sine', gain: 0.072, delay: 0.09 });
  },
  streakBonus() {
    tone({ freq: 523.25, duration: 0.1, type: 'sine', gain: 0.084 });
    tone({ freq: 659.25, duration: 0.1, type: 'sine', gain: 0.078, delay: 0.08 });
    tone({ freq: 783.99, duration: 0.2, type: 'sine', gain: 0.078, delay: 0.16 });
  },
  gift() {
    tone({ freq: 440, duration: 0.1, type: 'sine', gain: 0.072, glideTo: 880 });
  },
  confession() {
    tone({ freq: 196, duration: 0.3, type: 'sawtooth', gain: 0.048, glideTo: 392 });
  },
  error() {
    tone({ freq: 180, duration: 0.14, type: 'square', gain: 0.048 });
  },
  // The scourge. A crack is a very short bright transient falling off a cliff,
  // plus a body thud underneath it — two oscillators get surprisingly close.
  // Each lash is pitched a little higher and hits a little harder than the
  // last, so the five blows escalate by ear as well as by eye.
  lash(i = 0) {
    tone({ freq: 1500 + i * 190, duration: 0.055, type: 'square', gain: 0.062 + i * 0.008, glideTo: 200 });
    tone({ freq: 96, duration: 0.2, type: 'sawtooth', gain: 0.05 + i * 0.007, glideTo: 38, delay: 0.012 });
  },
  snap() {
    tone({ freq: 620, duration: 0.05, type: 'square', gain: 0.07, glideTo: 140 });
    tone({ freq: 300, duration: 0.09, type: 'triangle', gain: 0.05, glideTo: 90, delay: 0.03 });
  },
  // What is left of you when it stops: a rising open fifth, no percussion.
  purify() {
    tone({ freq: 261.63, duration: 0.5, type: 'sine', gain: 0.055 });
    tone({ freq: 392, duration: 0.5, type: 'sine', gain: 0.05, delay: 0.12 });
    tone({ freq: 523.25, duration: 0.7, type: 'sine', gain: 0.045, delay: 0.26 });
  },
};
