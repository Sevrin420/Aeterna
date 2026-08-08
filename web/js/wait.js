// The PLEASE WAIT legend.
//
// Everything slow in this game is either the server or the chain, and neither
// of them moves anything on screen while it thinks. Connecting a wallet, asking
// what Bloodlines it holds, waiting for a fresh mint to appear in the holdings —
// all of it used to happen behind a still picture, which reads as a hang, and a
// player who thinks it has hung presses the button again.
//
// So it is not wired into individual call sites. It wraps the two doors out of
// the browser — req() in api.js and the contract reads in wallet.js — and any
// call through either of them raises it.
//
// THE UNIT IS THE RUN OF WORK, NOT THE REQUEST. That is the whole design, and
// getting it wrong is what made the mint flash. The mint rite is not one slow
// call, it is seven short ones in a row — is the mint open, what does a Cultist
// cost, send, wait for the receipt, read the holdings, name it, bind it — and
// treating each as its own wait gave a legend that blinked off and on in every
// gap between them. Worse, with the grace period restarting on each call, a run
// of medium ones could show nothing at all while the player sat there.
//
// So the timers here measure a CONTINUOUS RUN:
//
//   GRACE      how long the abbey must be busy before it says anything, timed
//              across the whole run rather than per call
//   IDLE_SLACK how long a gap has to be before the run counts as over — longer
//              than the hop between two awaits, far shorter than a real pause
//   MIN_VISIBLE  once up, how long it stays, timed from when it appeared
//
// The result is one legend for the whole rite, which is what a player means by
// "waiting" anyway. It does not blink: the animation is gone from
// .please-wait in styles.css, and the gaps are bridged here.

const el = () => document.getElementById('pleaseWait');

// Refcounted, because these nest: menuConnect reads the chain and then the
// server inside one wait, and the inner one finishing must not clear it.
let depth = 0;

// Shown late on purpose. Most calls answer in well under a quarter second, and
// a legend that appears and vanishes in two frames is worse than none.
const GRACE_MS = 260;
// A gap shorter than this is the seam between two calls of one rite, not a
// pause. Sequential awaits hop in well under 50ms.
const IDLE_SLACK_MS = 200;
// And once shown, it stays at least this long — long enough to read.
const MIN_VISIBLE_MS = 1500;

let graceTimer = null;   // counting down to showing it
let idleTimer = null;    // counting down to calling the run over
let hideTimer = null;    // counting down to taking it off screen
let shownAt = 0;         // when it went up; 0 when it is not up

function show() {
  graceTimer = null;
  if (depth > 0) {
    shownAt = Date.now();
    const n = el();
    if (n) n.hidden = false;
    return;
  }
  // Nothing in flight this instant, but the run may not be over — this is the
  // seam between two calls. Look again shortly rather than giving up, or
  // whether the legend appears at all comes down to which millisecond the
  // grace period happened to land on.
  if (idleTimer) graceTimer = setTimeout(show, 40);
}

function hideNow() {
  hideTimer = null;
  shownAt = 0;
  const n = el();
  if (n) n.hidden = true;
}

// The run is over: no call in flight and the slack has run out.
function goIdle() {
  idleTimer = null;
  if (depth > 0) return;
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  if (!shownAt) return;                 // never made it to the screen
  // Measured from when it APPEARED, not from now, so the minimum is a minimum
  // on what the player saw rather than a delay bolted onto every wait.
  const left = MIN_VISIBLE_MS - (Date.now() - shownAt);
  if (left <= 0) hideNow();
  else hideTimer = setTimeout(hideNow, left);
}

export function beginWait() {
  depth += 1;
  // Up and on its way down: catch it, so a rite that starts again inside the
  // hold never comes off the screen in between.
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  // Still inside the slack: the run continues rather than starting anew, so
  // the grace period is not restarted.
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (shownAt || graceTimer) return;    // already up, or already on its way up
  graceTimer = setTimeout(show, GRACE_MS);
}

export function endWait() {
  depth = Math.max(0, depth - 1);
  if (depth) return;                    // something else is still working
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(goIdle, IDLE_SLACK_MS);
}

// The only form worth using: a wait that cannot be left up by a throw.
export async function during(promise) {
  beginWait();
  try { return await promise; }
  finally { endWait(); }
}

// Belt and braces for the one case that is not a promise — a power-off, or an
// unhandled rejection somewhere upstream, should not strand the legend on
// screen forever. This one ignores every timer: the screen is going dark.
export function clearWait() {
  depth = 0;
  for (const t of [graceTimer, idleTimer, hideTimer]) if (t) clearTimeout(t);
  graceTimer = idleTimer = hideTimer = null;
  hideNow();
}
