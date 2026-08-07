// The blinking PLEASE WAIT.
//
// Everything slow in this game is either the server or the chain, and neither
// of them moves anything on screen while it thinks. Connecting a wallet, asking
// what Bloodlines it holds, waiting for a fresh mint to appear in the holdings —
// all of it used to happen behind a still picture, which reads as a hang, and a
// player who thinks it has hung presses the button again.
//
// So it is not wired into individual call sites. It wraps the two doors out of
// the browser — req() in api.js and the contract reads in wallet.js — and any
// call through either of them raises it. Nothing polls on a timer (checked), so
// there is no background chatter to make it flicker on its own.

const el = () => document.getElementById('pleaseWait');

// Refcounted, because these nest: menuConnect reads the chain and then the
// server inside one wait, and the inner one finishing must not clear it.
let depth = 0;
// Shown late on purpose. Most calls answer in well under a quarter second, and
// a legend that appears and vanishes in two frames is worse than none — it
// reads as a glitch rather than as work.
const GRACE_MS = 260;
let timer = null;

export function beginWait() {
  depth += 1;
  if (depth > 1 || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const n = el();
    if (n && depth > 0) n.hidden = false;
  }, GRACE_MS);
}

export function endWait() {
  depth = Math.max(0, depth - 1);
  if (depth) return;
  if (timer) { clearTimeout(timer); timer = null; }
  const n = el();
  if (n) n.hidden = true;
}

// The only form worth using: a wait that cannot be left up by a throw.
export async function during(promise) {
  beginWait();
  try { return await promise; }
  finally { endWait(); }
}

// Belt and braces for the one case that is not a promise — a power-off, or an
// unhandled rejection somewhere upstream, should not strand the legend on
// screen forever.
export function clearWait() {
  depth = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  const n = el();
  if (n) n.hidden = true;
}
