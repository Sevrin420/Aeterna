// Small synthesized sound effects — no audio assets, just short oscillator
// tones. Browsers require a user gesture before audio can play, so the
// AudioContext is created lazily on first call (button presses qualify).

let ctx = null;
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.15, delay = 0, glideTo = null }) {
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
}

export const sfx = {
  click() {
    tone({ freq: 320, duration: 0.05, type: 'square', gain: 0.06 });
  },
  power(on) {
    if (on) {
      tone({ freq: 220, duration: 0.18, type: 'triangle', gain: 0.12, glideTo: 660 });
    } else {
      tone({ freq: 660, duration: 0.18, type: 'triangle', gain: 0.1, glideTo: 180 });
    }
  },
  dutyComplete() {
    tone({ freq: 523.25, duration: 0.12, type: 'sine', gain: 0.14 });
    tone({ freq: 659.25, duration: 0.16, type: 'sine', gain: 0.12, delay: 0.09 });
  },
  streakBonus() {
    tone({ freq: 523.25, duration: 0.1, type: 'sine', gain: 0.14 });
    tone({ freq: 659.25, duration: 0.1, type: 'sine', gain: 0.13, delay: 0.08 });
    tone({ freq: 783.99, duration: 0.2, type: 'sine', gain: 0.13, delay: 0.16 });
  },
  gift() {
    tone({ freq: 440, duration: 0.1, type: 'sine', gain: 0.12, glideTo: 880 });
  },
  confession() {
    tone({ freq: 196, duration: 0.3, type: 'sawtooth', gain: 0.08, glideTo: 392 });
  },
  error() {
    tone({ freq: 180, duration: 0.14, type: 'square', gain: 0.08 });
  },
};
