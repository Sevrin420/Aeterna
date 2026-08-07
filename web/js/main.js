import { Input, makeLoop } from './engine.js';
import { BootScene } from './scenes/boot.js';
import { MenuScene } from './scenes/menu.js';
import { DialogueBox, THEMES } from './dialogue.js';
import { EmojiWheel } from './emojiwheel.js';
import { LORE } from './lore.js';
import { CourtyardScene } from './scenes/courtyard.js';
import { api, setTokenId, getTokenId } from './api.js';
import { sfx, AUDIO_MASTER } from './sfx.js';
import { PAGE_TITLE } from './config.js';
import {
  connectWallet, fetchBloodlines, totalCultists, mintBloodline, fetchMintOpen,
  fetchPricePerCultist, formatAvax, waitForTx, shortAddr, hasWalletConnect, isDemoMode,
  ensureChain, currentChainId, disconnectWallet,
} from './wallet.js';

// The tab follows the flag too, so ?oldName=1 rolls the rename back everywhere
// the player can read it and not just inside the canvas.
document.title = PAGE_TITLE;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const powerSwitch = document.getElementById('powerSwitch');
const hint = document.getElementById('hint');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const hud = document.getElementById('hud');
const hudName = document.getElementById('hudName');
const hudLevel = document.getElementById('hudLevel');
const hudXp = document.querySelector('.hud-xp');
const hudXpFill = document.getElementById('hudXpFill');
const hudXpTxt = document.getElementById('hudXpTxt');
const hudDevotion = document.getElementById('hudDevotion');
const hudStreak = document.getElementById('hudStreak');
const pipDay = document.getElementById('pipDay');
const toastEl = document.getElementById('toast');
const bootVeil = document.getElementById('bootVeil');
const powerKnob = powerSwitch.querySelector('.power-knob');
const muteToggle = document.getElementById('muteToggle');
const communionOverlay = document.getElementById('communionOverlay');
const communionBody = document.getElementById('communionBody');
const communionClose = document.getElementById('communionClose');
const emojiToggle = document.getElementById('emojiToggle');
const emojiWheelEl = document.getElementById('emojiWheel');

// Speech in the abbey is emoji and nothing else. The ring is built once and
// reused; picking sends through the scene, which broadcasts it and floats it
// over the player's own head for a moment.
const emojiWheel = new EmojiWheel(emojiWheelEl, (e) => {
  if (scene && scene._sendEmoji) scene._sendEmoji(e);
});
emojiToggle.addEventListener('click', (ev) => {
  ev.stopPropagation();
  // Only meaningful with a scene that can speak — the menu has no one to
  // speak to, so the button does nothing there rather than opening onto a
  // ring that cannot send. Turned with the d-pad and sent with A once open.
  if (!scene || !scene._sendEmoji) { showToast('Nobody to speak to here.'); return; }
  emojiWheel.toggle();
});

// Two looping hymns. Created fresh inside their respective user-gesture
// handlers (powerOn / enterCourtyard) so mobile browsers always allow
// playback — pre-creating Audio elements on page load can silently fail.
let _bgm = null;
let _gameBgm = null;
// The title-card stinger. This was referenced in two places and declared in
// none: `stinger.currentTime` threw a ReferenceError every time, and both call
// sites sat inside a bare try/catch, so the sound simply never played and
// nothing ever said why. Declared here and built in powerOn(), inside the
// power switch's real user gesture, so unlockAudio() can prime it.
let _stinger = null;
let _stingerPrimed = false;
let _priming = false;
const MUSIC = () => [_bgm, _gameBgm].filter(Boolean);
function applyMute(m) { for (const a of MUSIC()) a.muted = m; }

// Which track SHOULD be sounding right now — the title hymn in the lobby and
// on the title card, the game hymn in the abbey. kickAudio() needs to know
// this to tell "silent because it was blocked" from "silent on purpose".
let _want = null;
// Every rejection any play() ever gets, kept for the ?audio readout. A silent
// console with no error is impossible to debug remotely; this makes the
// browser's own reason for refusing visible on the device that refused.
const _audioLog = [];
function note(msg) {
  _audioLog.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (_audioLog.length > 12) _audioLog.shift();
}

// Every play() in the app goes through here, so a refusal is recorded rather
// than swallowed by a bare .catch().
function tryPlay(el, label) {
  if (!el) return;
  try {
    const p = el.play();
    if (p && p.then) {
      p.then(() => note(`${label}: playing`))
       .catch((e) => note(`${label}: REFUSED ${e.name} — ${e.message}`.slice(0, 90)));
    }
  } catch (e) {
    note(`${label}: threw ${e.name}`);
  }
}

// Browsers only let a media element start from inside an event that counts as
// user activation, and `pointermove` is not one of them on WebKit. The power
// switch is a SLIDER: drag it across and powerOn() commits from pointermove,
// so the hymn's play() is rejected and the .catch() swallows it — the console
// comes on in silence and nothing anywhere says why. The same applies to the
// game hymn, which is created inside a scene transition with no gesture behind
// it at all.
//
// Rather than guess which browsers are strict, every subsequent gesture is
// treated as another chance: if the track that should be playing is paused,
// try it again. This is a no-op the moment the music is actually running.
function kickAudio() {
  if (!powered) return;
  // Keep trying the prime until one actually succeeds — a blocked prime that
  // was recorded as done would leave the stinger locked for the whole session,
  // and it is played from a rAF callback where a fresh attempt has no gesture
  // to lean on.
  // One prime at a time. kickAudio runs on both pointerdown AND pointerup of
  // the same click, and two overlapping primes race on the muted flag: the
  // second reads muted=true as the "previous" value and restores it, leaving
  // the stinger permanently silent.
  if (_stinger && !_stingerPrimed && !_priming) {
    _priming = true;
    const el = _stinger;
    unlockAudio(el).then((ok) => {
      _priming = false;
      if (ok && _stinger === el) _stingerPrimed = true;
    });
  }
  if (!_want || !_want.paused) return;
  tryPlay(_want, 'kick');
}
for (const ev of ['pointerup', 'pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(ev, kickAudio, { passive: true });
}

// Strict-autoplay browsers (Safari/WebKit-based — this includes DuckDuckGo's
// in-app browser) require a media element's FIRST play() to happen
// synchronously inside a real user gesture; once that succeeds, later
// programmatic play() calls on that SAME element are allowed from anywhere,
// gesture or not, for the rest of the session. `bgm` gets that direct gesture
// via its real play() in powerOn() below, but `gameBgm` and `stinger` are only
// ever played later from inside requestAnimationFrame (the game loop's
// consumeAPress() check, and the nested rAF in revealTransition) — outside any
// gesture's synchronous call stack — so on strict browsers those calls were
// silently swallowed by the existing .catch(() => {}). Priming each element
// with an immediate play()+pause() right here, inside the power switch's real
// gesture, unlocks them so the later deferred play() calls actually work.
// Returns a promise that resolves true only if the browser actually let the
// element start. The caller needs to know: a prime that was itself blocked
// leaves the element locked, and marking it primed anyway would mean never
// trying again. Primed muted so the unlock is inaudible.
function unlockAudio(el) {
  try {
    const wasMuted = el.muted;
    el.muted = true;
    const p = el.play();
    const done = () => { el.pause(); el.currentTime = 0; el.muted = wasMuted; };
    if (p && p.then) {
      return p.then(() => { done(); return true; }).catch(() => { done(); return false; });
    }
    done();
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

muteToggle.setAttribute('aria-pressed', String(sfx.isMuted()));
muteToggle.addEventListener('click', () => {
  const nowMuted = sfx.toggleMute();
  muteToggle.setAttribute('aria-pressed', String(nowMuted));
  applyMute(nowMuted);
});

const input = new Input();
input.bindDpadZone(document.getElementById('dpad'));
input.bindButton(document.getElementById('btnA'), 'a');
input.bindButton(document.getElementById('btnB'), 'b');

// Every control is placed as a percentage of .console, which only lands on the
// artwork while .console is genuinely its containing block. A stray </div> once
// closed .console early and left the whole row of them children of .stage, which
// is not positioned — so the percentages resolved against the VIEWPORT instead.
// The zones then moved with the browser's chrome rather than with the console
// and missed their buttons by a different amount in every browser. That failure
// is invisible by construction, because the hit zones are transparent: nothing
// looks wrong, the presses just land somewhere else. So check it out loud.
const consoleEl = document.getElementById('console');
for (const el of document.querySelectorAll('.btn-hit, .dpad-zone, .power-switch, .mute-toggle, .emoji-toggle')) {
  if (el.offsetParent && el.offsetParent !== consoleEl) {
    const against = el.offsetParent.className || el.offsetParent.tagName;
    console.error(`[aeterna] ${el.id || el.className} resolves its position against ${against}, not .console — its hit zone will not line up with the artwork.`);
  }
}

// Scenes draw in a fixed 208-logical coordinate space; the canvas backing
// store is 2x that (416x412) so the pixel art stays crisp when the console
// is scaled up on a phone (Club Nile does the same — a 240-logical world
// drawn 2x into a 480 buffer). Every frame we reset to this 2x base
// transform before the scene renders.
const RES = 2;

let powered = false;
let scene = null;
let stopLoop = null;
let toastTimer = null;
let socket = null;

// The beat between the title card's A press and the abbey fading up.
function playStinger() {
  if (!_stinger || sfx.isMuted()) return;
  try {
    _stinger.muted = false;      // never trust a lost restore from priming
    _stinger.currentTime = 0;
    tryPlay(_stinger, 'stinger');
  } catch { /* a missing stinger must never block the transition */ }
}

// Open the site with ?audio to get a live readout of the audio stack pinned
// under the console. It is the only practical way to see WHY a phone is
// silent: the browser's refusal reason never reaches a desktop console.
function initAudioDebug() {
  if (!new URLSearchParams(location.search).has('audio')) return;
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99;margin:0;'
    + 'padding:6px 8px;background:rgba(0,0,0,.88);color:#7dffb0;font:10px/1.45 monospace;'
    + 'white-space:pre-wrap;max-height:46vh;overflow:auto;border-top:1px solid #2f7a4e';
  document.body.appendChild(box);
  const line = (label, el) => {
    if (!el) return `${label.padEnd(9)} —`;
    return `${label.padEnd(9)} paused=${el.paused} muted=${el.muted} vol=${el.volume}`
      + ` t=${el.currentTime.toFixed(1)} ready=${el.readyState} net=${el.networkState}`
      + ` err=${el.error ? el.error.code : '-'}`;
  };
  setInterval(() => {
    let ctxState = 'n/a';
    try { ctxState = sfx.ctxState ? sfx.ctxState() : 'n/a'; } catch { ctxState = 'threw'; }
    box.textContent = [
      `powered=${powered}  sfxMuted=${sfx.isMuted()}  audioCtx=${ctxState}`,
      `wanted=${_want === _bgm ? 'hymn' : _want === _gameBgm ? 'game-hymn' : 'none'}`
        + `  stingerPrimed=${_stingerPrimed}`,
      line('hymn', _bgm),
      line('game', _gameBgm),
      line('stinger', _stinger),
      '',
      ..._audioLog,
    ].join('\n');
  }, 250);
}
initAudioDebug();

function drawOff() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Everything the abbey says back that is not a dialogue box goes through here.
//
// The size is chosen from the message, not fixed: see the .toast block in
// styles.css. A Devotion award is a handful of characters and wants the screen;
// the explanation of why a wallet holds no Bloodline is a hundred and fourteen
// and would bury it. So would a fixed time on screen — a line long enough to
// need three lines of type needs longer than one worth four words, so the dwell
// is read-time rather than a constant.
//
// A caller can OVERRIDE both, and one does. Length is a decent guess at how
// much a message matters, but only a guess: "Saved. 150 Devotion secured."
// and "Saved. 1500 Devotion secured." are the same moment and land either side
// of a tier boundary purely on the digit count. Anything that matters at a
// fixed size should say so rather than hope its wording stays short.
function showToast(msg, { size = null, dwell = null } = {}) {
  const text = String(msg ?? '');
  toastEl.textContent = text;
  const tier = size || (text.length <= 28 ? 't-big' : text.length <= 64 ? 't-mid' : 't-small');
  toastEl.className = `toast ${tier}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  // ~14 characters a second on top of a fixed beat, capped so nothing camps on
  // the middle of the screen.
  const ms = dwell ?? Math.min(5200, 1700 + text.length * 45);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// Character level is derived from total Devotion (Devotion *is* the XP). Each
// level costs a bit more than the last, so the bar keeps its meaning as you
// climb. Shared by the HUD and anywhere else that wants to show a level.
function levelInfo(devotion) {
  let level = 1, acc = 0, need = 100;
  while (devotion >= acc + need) { acc += need; level += 1; need = 100 + (level - 1) * 50; }
  const cur = devotion - acc;
  return { level, cur, need, pct: Math.max(0, Math.min(1, cur / need)) };
}

// Restarting a CSS animation needs the class off, a forced reflow, then the
// class back on — without the reflow the browser coalesces the two changes and
// nothing replays. Two awards in quick succession must each get their pulse.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

let lastDevotion = null;
let lastLevel = null;
let levelUpTimer = null;
let awardTimer = null;

// The .awarded class carries BOTH the pulse keyframes and the slow fill
// transition, so it has to outlive the pulse (0.62s) and stay until the fill
// has finished (0.22s delay + 1.25s), or the bar would snap the rest of the
// way the moment the animation ended. It is cleared afterwards so ordinary
// HUD refreshes — a reconnect, a scene change — go back to being instant.
function clearAward() {
  clearTimeout(awardTimer);
  awardTimer = setTimeout(() => {
    hudXp.classList.remove('awarded');
    hudDevotion.classList.remove('awarded');
  }, 1600);
}

function updateHud(player) {
  const dev = player.devotion || 0;
  const li = levelInfo(dev);
  const awarded = lastDevotion != null && dev > lastDevotion;
  const levelledUp = awarded && lastLevel != null && li.level > lastLevel;

  hudLevel.textContent = `LV ${li.level}`;
  hudXpTxt.textContent = `${li.cur} / ${li.need} XP`;
  hudDevotion.textContent = `✦ ${dev}`;

  clearTimeout(levelUpTimer);
  if (awarded) {
    // Pulse first, then fill — the .awarded class carries both the keyframes
    // and the slow transition, so the two are always in step.
    replay(hudXp, 'awarded');
    replay(hudDevotion, 'awarded');
    clearAward();
    if (levelledUp) {
      // Run the old bar out to full before starting the new level from empty,
      // otherwise levelling up reads as the bar going BACKWARDS.
      hudXpFill.style.width = '100%';
      levelUpTimer = setTimeout(() => {
        hudXpFill.style.transition = 'none';
        hudXpFill.style.width = '0%';
        void hudXpFill.offsetWidth;
        hudXpFill.style.transition = '';
        hudXpFill.style.width = `${li.pct * 100}%`;
        clearAward();
      }, 1500);
    } else {
      hudXpFill.style.width = `${li.pct * 100}%`;
    }
  } else {
    hudXpFill.style.width = `${li.pct * 100}%`;
  }
  lastDevotion = dev;
  lastLevel = li.level;
  hudName.textContent = `${player.prefix} ${player.name}`;
  hudStreak.textContent = player.streak > 0 ? `${player.streak}d ×${player.multiplier}` : '';
  // Lit only when every duty is kept. A partial count would leak the total.
  const dayKept = !!player.candles_today && !!player.scourge_today && !!player.garden_today;
  pipDay.classList.toggle('done', dayKept);
  hud.hidden = false;
}

function ensureSocket() {
  if (socket || typeof io === 'undefined') return socket;
  socket = io({ autoConnect: true });
  return socket;
}

// The drawn board owns every pit, every stone and every click on them. It is
function showFinalCommunion(info) {
  communionBody.textContent = `Season ${info.season}, Day ${info.day} has arrived. The abbey gathers for Final Communion — gold reveal and the choice to Leave or Tithe are not yet available in this build; the Abbot will announce next steps.`;
  communionOverlay.hidden = false;
}
communionClose.addEventListener('click', () => { communionOverlay.hidden = true; });

function openChat() {
  chatForm.hidden = false;
  chatInput.value = '';
  chatInput.focus();
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (scene && scene.sendChat) scene.sendChat(chatInput.value);
  chatForm.hidden = true;
});
chatInput.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { chatForm.hidden = true; }
  e.stopPropagation();
});

const CROWD = parseInt(new URLSearchParams(location.search).get('crowd') || '0', 10) || 0;

function enterCourtyard(player) {
  updateHud(player);
  // Entering the game: auto-unmute, create fresh game bgm, pause title bgm.
  sfx.setMuted(false);
  muteToggle.setAttribute('aria-pressed', 'false');
  applyMute(false);
  if (_bgm) try { _bgm.pause(); } catch {}
  _gameBgm = new Audio('assets/hymn-game.mp3');
  _gameBgm.loop = true;
  _gameBgm.volume = 0.5 * AUDIO_MASTER;
  _gameBgm.muted = false;
  _want = _gameBgm;
  tryPlay(_gameBgm, 'game-hymn');
  scene = new CourtyardScene({
    player,
    onPlayerUpdate: updateHud,
    onToast: showToast,
    socket: ensureSocket(),
    onSaveExit: returnToEntrance,
    onChatOpen: openChat,
    onFinalCommunion: showFinalCommunion,
    crowd: CROWD,
  });
  scene.enter();
  hint.textContent = '';
  window.__aeterna = { scene, player };
}

// Dev-mode stand-in for real identity: until Cultist NFTs are attached,
// new players get an auto-assigned name/sex instead of a naming form.
// Names are drawn from 12th-13th century English monastic rolls -- the
// brothers and sisters of a 1200 AD abbey.
const AUTO_NAMES = {
  male: ['Aldric', 'Cuthbert', 'Edmund', 'Godwin', 'Wulfstan', 'Oswald', 'Anselm', 'Alcuin', 'Dunstan', 'Osbern', 'Wilfrid', 'Baldwin'],
  female: ['Agnes', 'Hild', 'Edith', 'Mildred', 'Winifred', 'Etheldreda', 'Clare', 'Milburga', 'Werburgh', 'Frideswide', 'Osgyth', 'Aethelthryth'],
};
function randomIdentity() {
  const sex = Math.random() < 0.5 ? 'male' : 'female';
  const pool = AUTO_NAMES[sex];
  const name = pool[Math.floor(Math.random() * pool.length)];
  return { name, sex };
}

// A black veil instantly covers the screen, the next scene loads underneath
// unseen, then the veil slowly lifts — same "confirm -> darken -> reveal the
// room" beat as Club Nile's boot sequence.
function revealTransition(next) {
  bootVeil.style.transition = 'none';
  bootVeil.style.opacity = '1';
  requestAnimationFrame(() => {
    next();
    requestAnimationFrame(() => {
      bootVeil.style.transition = 'opacity 1.5s ease';
      bootVeil.style.opacity = '0';
    });
  });
}

// ---- Entrance lobby (wallet -> Bloodline -> the abbey) ----
const walletOverlay = document.getElementById('walletOverlay');
const walletTitle = document.getElementById('walletTitle');
const walletMsg = document.getElementById('walletMsg');
const cultistGrid = document.getElementById('cultistGrid');
const walletConnectBtn = document.getElementById('walletConnect');
const walletBackBtn = document.getElementById('walletBack');
const walletInput = document.getElementById('walletInput');
const walletSubmitBtn = document.getElementById('walletSubmit');
const walletSkipBtn = document.getElementById('walletSkip');
const cultistSlider = document.getElementById('cultistSlider');
const cultistRange = document.getElementById('cultistRange');
const cultistCount = document.getElementById('cultistCount');
const cultistCost = document.getElementById('cultistCost');
// Cleanup for whichever mint rite is currently open. Held at module level
// because opening MINT a second time must dismantle the first: two live
// onRaise listeners would send two transactions for one press.
let _mintTeardown = null;
let _mintInput = null;         // owns the controls while the mint slider is up

// The Doctrine and the mint rite are read in the in-canvas dialogue box now,
// so the only DOM overlay the entrance still raises is the wallet flow.
function entranceOverlaysOpen() {
  return !walletOverlay.hidden;
}

let entrancePlayer = null;
let chosenCultist = null;
// What the title menu shows: the bound address and how many Cultists it holds.
let connectedAddr = null;
let heldCultists = 0;
// Every Bloodline the connected wallet holds, and the one being played. A
// wallet may hold several; the game makes you play one at a time, so the
// Devotion that follows belongs to `boundToken`, not to the address.
let heldBloodlines = [];
let boundToken = getTokenId();

// WHY THE ABBEY WOULD NOT LET YOU IN, or null if it will.
//
// There is no walking the abbey unbound any more. The old spirit — connected or
// not, holding nothing, drifting through a world it could not touch — is gone:
// a playtester spent minutes inside it wondering why nothing responded, which
// is what a state that looks like play but is not will always cost.
function playBlockedBy() {
  if (!connectedAddr) return 'wallet';
  if (!heldBloodlines.length) return 'bloodline';
  if (!boundToken) return 'unbound';
  return null;
}
// Mirrors REFERRAL_DEVOTION in server/src/lib/gameLogic.js. Shown to the
// player before they answer; the server is what actually pays, so if the two
// ever drift the server wins and this is only a wrong promise on screen.
const REFERRAL_DEVOTION = 10;

// Save & Exit from the game returns to the entry lobby (not power off). Devotion
// was already saved by the scene before this runs.
// Leaving the abbey means walking out of its SOUTH door, so the player comes
// back into the courtyard at its north end — under the arch they went in by.
// Arriving fresh (or after a reload) starts them in the middle of the yard.
// Ending the day drops you back to the title menu, which is the only screen
// outside the abbey now that the entrance courtyard is gone.
function returnToEntrance() {
  if (scene && scene.exit) scene.exit();
  if (socket) { socket.disconnect(); socket = null; }
  hud.hidden = true;
  revealTransition(() => enterEntrance(entrancePlayer));
}

function enterEntrance(player) {
  entrancePlayer = player;
  // Title-menu music: the lobby hymn plays here (the in-game hymn is paused).
  if (_gameBgm) try { _gameBgm.pause(); } catch {}
  if (!_bgm) {
    _bgm = new Audio('assets/hymn.mp3');
    _bgm.loop = true;
    _bgm.volume = 0.55 * AUDIO_MASTER;
    _bgm.muted = sfx.isMuted();
    tryPlay(_bgm, 'hymn@menu');
  } else {
    _bgm.muted = sfx.isMuted();
    if (_bgm.paused) tryPlay(_bgm, 'hymn@menu');
  }
  _want = _bgm;

  // Docs and Mint are read in the abbey's own box, drawn over the menu. They
  // used to be two signposts in a courtyard you had to walk across to find.
  const box = new DialogueBox();
  const menu = new MenuScene({
    wallet: connectedAddr ? shortAddr(connectedAddr) : null,
    cultists: heldCultists,
    seed: (player && player.wallet) || 'menu',
    sex: (player && player.sex) || 'male',
    onConnect: () => menuConnect(menu),
    onPlay: () => {
      const why = playBlockedBy();
      if (why) { box.show([LORE.blocked[why]], { theme: THEMES.bitumen }); return; }
      proceedIntoGame();
    },
    // Mint and Docs are opened FROM the menu and are read on the same screen,
    // so they wear the same bitumen. Every box inside the abbey is untouched.
    onMint: () => { box.show(LORE.mint, { theme: THEMES.bitumen, onClose: () => openMintPicker(menu) }); },
    onDocs: () => box.show(LORE.doctrine, { theme: THEMES.bitumen }),
    onLines: () => openLinesScreen(menu),
  });
  // The box owns input and the screen while it is up, exactly as in the abbey.
  const baseUpdate = menu.update.bind(menu);
  const baseRender = menu.render.bind(menu);
  menu.update = (dt, input) => {
    if (box.active) { box.update(dt, input); return; }
    baseUpdate(dt, input);
  };
  menu.render = (ctx) => { baseRender(ctx); box.render(ctx); };
  menu.box = box;

  scene = menu;
  scene.enter();
  hint.textContent = '';
  window.__aeterna = { scene, player, menu };
}

// The menu's Connect button. It does the connection itself and writes the
// result straight back into the panel — the old HTML overlay is still there for
// the Cultist picker, but binding a wallet no longer needs a detour through it.
async function menuConnect(menu) {
  if (menu.busy) return;
  menu.busy = true;
  menu.status = 'OPENING WALLET…';
  try {
    const addr = await connectWallet();
    connectedAddr = addr;
    // Move the wallet to Avalanche before reading anything. On any other chain
    // this contract does not exist, and every answer comes back as zero —
    // which the game would otherwise show as "no Bloodlines, mint closed".
    menu.status = 'SWITCHING TO AVALANCHE…';
    await ensureChain();
    menu.status = 'READING THE CHAIN…';
    heldBloodlines = await withNames(await fetchBloodlines(addr));
    heldCultists = totalCultists(heldBloodlines);
    menu.setWallet(shortAddr(addr), heldCultists, addr);
    menu.status = null;

    if (!heldBloodlines.length) {
      // No Bloodline: there is nothing to walk in AS. Point at the mint.
      menu.sel = 2;                     // point them at MINT
      showToast('No Bloodline in this wallet. MINT to be counted.');
    } else if (heldBloodlines.length === 1) {
      await bindBloodline(heldBloodlines[0], menu);
    } else {
      // Several. They have to choose which one this day's Devotion belongs to.
      openBloodlinePicker(menu);
    }
  } catch (e) {
    const why = {
      NO_WALLET: hasWalletConnect() ? 'NO WALLET FOUND' : 'WALLETCONNECT NOT CONFIGURED',
      WC_NOT_CONFIGURED: 'WALLETCONNECT NOT CONFIGURED',
      WC_LOAD_FAILED: 'COULD NOT REACH WALLETCONNECT',
      NO_ACCOUNT: 'NO ACCOUNT RETURNED',
      NO_CONTRACT: 'COLLECTION NOT CONFIGURED',
      CHAIN_UNREACHABLE: 'COULD NOT REACH THE CHAIN',
      WRONG_CHAIN: 'SWITCH YOUR WALLET TO AVALANCHE',
      NO_CONTRACT_HERE: 'NO COLLECTION AT THAT ADDRESS',
    }[e && e.message] || 'CONNECTION REFUSED';
    menu.status = why;
    sfx.error();
  } finally {
    menu.busy = false;
  }
}

// The chain knows which Bloodlines a wallet holds and how many Cultists each
// carries; it does not know what its holder called them. This fills that in, so
// the picker offers "House Vane" rather than "Bloodline #1".
//
// A failure here is cosmetic and must not block play: the chain-derived label
// stays, and the player picks by number as before.
// Wait until the wallet REPORTS one more Bloodline than it had.
//
// The receipt is not the thing the rest of the entrance depends on — the
// holding is. Those two come apart in both directions: waitForTx gives up after
// two minutes on a slow chain while the mint still lands, and an RPC can hand
// back a receipt and then answer the very next holdings call from a block it
// has not caught up to. Waiting on the fact itself covers both.
//
// This is what a playtester fell into: the receipt timed out, the mint handler
// gave up, and they were left holding a Bloodline the game had not bound —
// connected, paid, and unable to play.
async function waitForNewBloodline(before, { tries = 40, everyMs = 3000 } = {}) {
  if (isDemoMode()) return fetchBloodlines(connectedAddr);
  for (let i = 0; i < tries; i++) {
    try {
      const list = await fetchBloodlines(connectedAddr);
      if (list.length > before) return list;
    } catch { /* an RPC hiccup is not an answer — keep asking */ }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return null;
}

async function withNames(list) {
  if (!list.length || isDemoMode()) return list;
  try {
    const rows = await api.bloodlines(list.map((b) => b.id));
    const byId = new Map(rows.map((r) => [r.token_id, r]));
    for (const b of list) {
      const r = byId.get(b.id);
      if (r && r.bloodline_name) b.name = r.bloodline_name;
      if (r && typeof r.devotion === 'number') b.devotion = r.devotion;
    }
  } catch { /* names are a nicety; the numbers still work */ }
  return list;
}

// Tell the server which Bloodline this player is. Everything that touches
// Devotion afterwards is keyed to it.
async function bindBloodline(bl, menu, bloodlineName) {
  if (isDemoMode()) {
    boundToken = bl.id;
    chosenCultist = bl;
    if (menu) { menu.sel = 1; menu.setWallet(shortAddr(connectedAddr), bl.cultists, connectedAddr); }
    showToast(`${bloodlineName || bl.name} walks — Bloodline #${bl.id}, ${bl.cultists} Cultists. (demo)`);
    return;
  }
  try {
    if (menu) menu.status = 'BINDING BLOODLINE…';
    const row = await api.bind(bl.id, connectedAddr, bloodlineName);
    boundToken = bl.id;
    setTokenId(bl.id);
    chosenCultist = bl;
    heldCultists = bl.cultists;
    // Re-read through /me: bind returns the raw row, but the entrance needs the
    // derived fields too (multiplier, whether a confession is owed, and whether
    // this wallet has already been brought in by someone).
    let full = row;
    try { full = await api.me(); } catch { /* the raw row is enough to play */ }
    entrancePlayer = full;
    if (menu) {
      menu.setWallet(shortAddr(connectedAddr), bl.cultists, connectedAddr);
      menu.status = null;
      menu.sel = 1;                     // move them on to PLAY
    }
    // The line's own name is what the abbey calls it. The token number is kept
    // in the toast so a holder of several can still tell two alike names apart.
    const called = full.bloodline_name || row.bloodline_name || `Bloodline #${bl.id}`;
    showToast(`${called} walks — Bloodline #${bl.id}, ${bl.cultists} Cultists, ${full.devotion || 0} Devotion.`);
    await offerXHandleAndReferral(full);
  } catch (e) {
    // A failed bind leaves a paid-for Bloodline that the game cannot see, so
    // it must say so plainly and say how to retry. Pressing WALLET re-reads the
    // chain and comes straight back here.
    if (menu) menu.status = 'BIND FAILED — PRESS WALLET';
    showToast(`${e.message || 'Could not bind that Bloodline.'} Your Bloodline is safe on-chain — press WALLET to try again.`);
    sfx.error();
  }
}

// The picker, for a wallet holding more than one. Reuses the entrance overlay
// the Cultist chooser already lived in.
//
// Driven by the console's own controls — d-pad to move, A to take up, B to back
// out — because this screen appears on a device whose whole face is a d-pad and
// two buttons, and asking the player to reach past them and tap a card is
// asking them to stop using the thing they are holding. Tapping still works.
let _picker = null;

function openBloodlinePicker(menu) {
  if (_mintTeardown) _mintTeardown();
  walletOverlay.classList.remove('picking');
  walletOverlay.hidden = false;
  walletConnectBtn.hidden = true;
  walletInput.hidden = true;
  walletSubmitBtn.hidden = true;
  walletSkipBtn.hidden = true;
  cultistSlider.hidden = true;
  cultistGrid.hidden = false;
  cultistGrid.className = 'cultist-grid bloodline-list';
  walletOverlay.classList.add('picking');   // see the .picking block in styles.css
  cultistGrid.innerHTML = '';
  walletTitle.textContent = 'Choose your Bloodline';
  // Everything here that was not a CHOICE is gone, and the room it took goes
  // into the type. The address said nothing that helps pick between two lines;
  // the count was the length of a list already on screen; and "you play one at
  // a time, and its Devotion is its own" is a rule, not a difference between
  // the things being chosen. The controls stay: they are the one thing here a
  // player cannot work out by reading the cards.
  walletMsg.innerHTML = '<span class="bl-hint">D-PAD · A TAKE UP · B BACK</span>';

  const cards = heldBloodlines.map((bl) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cultist-card';
    // The name is the whole point of this screen, so it gets its own line and
    // the largest type here. A line that was never named still reads as itself
    // rather than as a blank: the token number IS its name until it has one.
    const name = document.createElement('span');
    name.className = 'bl-name';
    name.textContent = (bl.name && bl.name.trim()) || `Bloodline #${bl.id}`;
    const sub = document.createElement('span');
    sub.className = 'bl-sub';
    const dev = typeof bl.devotion === 'number' ? `  ·  ${bl.devotion} Devotion` : '';
    // No token number: named, it is noise; unnamed, the name above IS the number.
    sub.textContent = `${bl.cultists} Cultist${bl.cultists === 1 ? '' : 's'}${dev}`;
    card.append(name, sub);
    if (bl.id === boundToken) card.classList.add('current');
    card.addEventListener('click', () => _picker && _picker.choose(heldBloodlines.indexOf(bl)));
    cultistGrid.appendChild(card);
    return card;
  });

  // Nothing queued carries into this screen. Without it the B that backed out
  // of the picker is still unread when the picker is opened again, and the
  // next frame spends it closing what just opened.
  input.flush();

  // Start on the Bloodline already being borne, so the common case — a holder
  // reconnecting to carry on where they left off — is one press of A.
  const startAt = Math.max(0, heldBloodlines.findIndex((bl) => bl.id === boundToken));
  _picker = {
    index: startAt,
    busy: false,
    paint() {
      cards.forEach((c, i) => c.classList.toggle('sel', i === this.index));
      const el = cards[this.index];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    },
    move(step) {
      if (!cards.length) return;
      this.index = (this.index + step + cards.length) % cards.length;
      sfx.click();
      this.paint();
    },
    async choose(i) {
      if (this.busy) return;
      this.busy = true;
      const bl = heldBloodlines[i];
      closeBloodlinePicker();
      await bindBloodline(bl, menu);
    },
    handleInput(input) {
      const d = input.consumeDir ? input.consumeDir() : null;
      if (d === 'up' || d === 'left') this.move(-1);
      else if (d === 'down' || d === 'right') this.move(1);
      if (input.consumeAPress()) { this.choose(this.index); return; }
      // B backs out without choosing. The wallet is still connected, so WALLET
      // on the menu brings this straight back.
      if (input.consumeBPress()) { closeBloodlinePicker(); if (menu) menu.sel = 0; }
    },
  };
  _picker.paint();
}

function closeBloodlinePicker() {
  _picker = null;
  walletOverlay.hidden = true;
  // Hand the grid back to the Cultist picker exactly as it found it.
  cultistGrid.className = 'cultist-grid';
  // And the mint's own dress along with it. Left on, the next screen to borrow
  // this overlay would come up in the mint's larger type with its Back button
  // hidden — and those screens have no B exit of their own. Same for the
  // picker's.
  walletOverlay.classList.remove('minting');
  walletOverlay.classList.remove('picking');
}

// ---- LINES: what you hold, and the two things you can still put on it ------
//
// A playtester quit during the naming prompt and never got it back — the name
// was offered once, at the mint, and nowhere else — so they finished a session
// not knowing what their own Bloodlines were called. The referral was worse:
// pressing "not now" recorded a decline server-side and it was never offered
// again.
//
// This screen is where both live afterwards. Nothing here can be CHANGED — a
// name and a referrer are set once — but anything still unset can be set, at
// any time, which is the difference between "once" and "once, and you had to be
// looking".
let _lines = null;
// The question currently on screen, or null. A prompt is a DOM form, but the
// console's own A and B are what a player reaches for — and with nothing
// holding them they fell straight through to the menu BEHIND the overlay,
// which re-fired the very button that opened the prompt.
let _asking = null;

async function openLinesScreen(menu) {
  if (!connectedAddr) { showToast('Connect a wallet first.'); if (menu) menu.sel = 0; return; }
  if (_mintTeardown) _mintTeardown();
  walletOverlay.hidden = false;
  walletOverlay.classList.remove('picking', 'minting');
  walletOverlay.classList.add('lines');
  walletConnectBtn.hidden = true;
  walletInput.hidden = true;
  walletSkipBtn.hidden = true;
  walletSubmitBtn.hidden = true;
  cultistSlider.hidden = true;
  walletTitle.textContent = 'Your Bloodlines';
  walletMsg.innerHTML = '<span class="bl-hint">D-PAD · A TO SET · B BACK</span>';
  cultistGrid.hidden = false;
  cultistGrid.className = 'cultist-grid bloodline-list';

  // Freshest names and handles, and who brought this wallet in.
  try { heldBloodlines = await withNames(await fetchBloodlines(connectedAddr)); } catch { /* show what we have */ }
  let me = null;
  try { me = await api.me(); } catch { /* the referrer row simply reads unknown */ }

  const rows = [];
  // The referrer is a property of the WALLET, not of one line — the referrals
  // table is unique on the referee — so it is one row above the list rather
  // than repeated against every Bloodline.
  rows.push({
    kind: 'referrer',
    label: 'Brought here by',
    value: me && me.referred ? `@${me.referred}` : null,
    empty: 'not set — press A',
  });
  for (const bl of heldBloodlines) {
    rows.push({
      kind: 'name',
      bl,
      label: bl.name && bl.name.trim() && !/^Bloodline #/.test(bl.name) ? bl.name : null,
      value: bl.name && bl.name.trim() && !/^Bloodline #/.test(bl.name) ? bl.name : null,
      empty: 'unnamed — press A',
      sub: `Bloodline #${bl.id}${bl.x_handle ? `  ·  @${bl.x_handle}` : ''}`,
    });
  }

  const paint = () => {
    cultistGrid.innerHTML = '';
    rows.forEach((r, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cultist-card' + (i === _lines.index ? ' sel' : '') + (r.value ? '' : ' unset');
      const n = document.createElement('span');
      n.className = 'bl-name';
      n.textContent = r.kind === 'referrer'
        ? (r.value ? `${r.label}: ${r.value}` : r.label)
        : (r.value || 'Unnamed');
      const sub = document.createElement('span');
      sub.className = 'bl-sub';
      sub.textContent = r.value ? (r.sub || 'set') : r.empty;
      card.append(n, sub);
      card.addEventListener('click', () => { _lines.index = i; paint(); _lines.choose(); });
      cultistGrid.appendChild(card);
    });
  };

  _lines = {
    index: 0,
    paint,
    busy: false,
    async choose() {
      // A card can be tapped as well as chosen with A, and a tap does not go
      // through handleInput — so the guard lives here rather than there.
      if (this.busy) return;
      const r = rows[this.index];
      if (!r || r.value) { showToast('That is already set, and set once.'); return; }
      this.busy = true;
      if (r.kind === 'referrer') {
        const who = await askOverlay({
          title: 'Who brought you here?',
          message: `Name the X handle of the Cultist who brought you in. You are both granted ${REFERRAL_DEVOTION} Devotion — once.`,
          placeholder: '@theirhandle',
          confirm: 'Speak the name',
        });
        if (who) {
          try {
            const res = await api.referral(who);
            r.value = `@${String(who).replace(/^@/, '')}`;
            showToast(res && res.credited ? 'Named. You are both counted.' : 'Named.');
          } catch (e) { showToast((e && e.message) || 'That name was not accepted.'); }
        }
      } else {
        const given = await askOverlay({
          title: 'Name the Bloodline',
          message: 'A line is named once. This one has no name yet.',
          placeholder: 'House Vane',
          confirm: 'Name it',
        });
        if (given) {
          try {
            await api.bind(r.bl.id, connectedAddr, given);
            r.bl.name = given;
            r.value = given;
            showToast(`Named — ${given}.`);
          } catch (e) { showToast((e && e.message) || 'That name was not accepted.'); }
        }
      }
      // Re-opened rather than repainted: askOverlay borrows this same overlay,
      // leaves it dressed for a prompt, and has just cleared _lines. Awaited,
      // so nothing runs against a half-built screen.
      this.busy = false;
      await openLinesScreen(menu);
    },
    handleInput(inp) {
      const d = inp.consumeDir ? inp.consumeDir() : null;
      if (d === 'up' || d === 'down') {
        const n = rows.length;
        this.index = (this.index + (d === 'down' ? 1 : n - 1)) % n;
        sfx.click();
        paint();
      }
      if (inp.consumeAPress()) { this.choose(); return; }
      if (inp.consumeBPress()) closeLinesScreen(menu);
    },
  };
  paint();
  input.flush();
}

// `menu` is optional: the on-screen Back button has no reference to it.
function closeLinesScreen(menu) {
  _lines = null;
  walletOverlay.hidden = true;
  walletOverlay.classList.remove('lines');
  cultistGrid.className = 'cultist-grid';
  cultistGrid.innerHTML = '';
  if (menu) menu.sel = 0;
}

// ---- Asking for a single line of text in the entrance overlay ----------------
// Both the X handle and the referral are one short answer with a way out, so
// they share this. Resolves with the trimmed string, or null if skipped.
function askOverlay({ title, message, placeholder, confirm = 'Confirm', skip = 'Not now' }) {
  return new Promise((resolve) => {
    if (_mintTeardown) _mintTeardown();
    // AND the LINES screen, which is the one that opens these. It is a d-pad
    // screen holding the controls, and left live it goes on eating A presses
    // while its own prompt is up: pressing A to confirm a name re-entered
    // choose(), opened a SECOND prompt over the first, and wiped what had been
    // typed — two prompts then sharing one pair of buttons, each removing the
    // other's listeners. That is the naming "glitch". It re-opens itself when
    // the prompt resolves.
    _lines = null;
    walletOverlay.classList.remove('picking', 'lines', 'minting');
    // Naming, the X handle and the referral are all one short question with a
    // way out. They get their own dress — see the `.asking` block in
    // styles.css — because a question with three words of prose on it can
    // carry far larger type than a screen that has to hold a list.
    walletOverlay.classList.add('asking');
    walletOverlay.hidden = false;
    cultistGrid.hidden = true;
    cultistGrid.innerHTML = '';
    cultistSlider.hidden = true;
    walletConnectBtn.hidden = true;
    walletTitle.textContent = title;
    walletMsg.innerHTML = message;
    walletInput.value = '';
    walletInput.placeholder = placeholder || '';
    walletInput.hidden = false;
    walletSubmitBtn.hidden = false;
    walletSkipBtn.hidden = false;
    walletSubmitBtn.textContent = confirm;
    walletSkipBtn.textContent = skip;
    // Own the enabled state rather than inheriting it. The mint rite disables
    // this same button while it waits on the chain, and it re-enables it in a
    // finally that cannot run until THIS prompt resolves — which needs a click
    // on the button the mint rite left disabled. That deadlock killed both
    // prompts outright.
    walletSubmitBtn.disabled = false;
    walletSkipBtn.disabled = false;
    try { walletInput.focus(); } catch { /* not focusable on some mobile shells */ }

    const done = (value) => {
      _asking = null;
      // Off on EVERY exit — confirmed, skipped or Entered. Left on, the next
      // screen to borrow this overlay comes up wearing type meant for a
      // three-word question.
      walletOverlay.classList.remove('asking');
      walletInput.hidden = true;
      walletSubmitBtn.hidden = true;
      walletSkipBtn.hidden = true;
      walletSubmitBtn.removeEventListener('click', onOk);
      walletSkipBtn.removeEventListener('click', onSkip);
      walletInput.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onOk = () => { const v = walletInput.value.trim(); done(v || null); };
    const onSkip = () => done(null);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };
    walletSubmitBtn.addEventListener('click', onOk);
    walletSkipBtn.addEventListener('click', onSkip);
    walletInput.addEventListener('keydown', onKey);
    // A confirms, B backs out — the same two buttons that mean that everywhere
    // else. Typing is unaffected: the engine ignores the keyboard entirely
    // while a text field has focus, so this only ever fires from the console's
    // own on-screen buttons.
    _asking = { ok: onOk, skip: onSkip };
  });
}

// After a bind: offer to put an X handle on the Bloodline, then to name whoever
// brought them in. Both are optional and each is asked ONCE — a player who
// skips is not nagged on every connect, and a player who already has a handle
// or has already been referred is never asked at all.
const _askedThisSession = new Set();

async function offerXHandleAndReferral(player) {
  if (isDemoMode() || !player) return;
  const key = String(player.token_id || player.id);

  if (!player.x_handle && !_askedThisSession.has(`x:${key}`)) {
    _askedThisSession.add(`x:${key}`);
    const handle = await askOverlay({
      title: 'Mark the Bloodline',
      message: 'Your X handle is carved on the Bloodline’s card, and is the name '
        + 'others speak to credit you for bringing them in.',
      placeholder: '@yourhandle',
      confirm: 'Carve it',
    });
    if (handle) {
      try {
        const r = await api.setXHandle(handle);
        showToast(`The Bloodline is marked @${r.xHandle}.`);
        player.x_handle = r.xHandle;
      } catch (e) {
        showToast(e.message || 'That handle could not be carved.');
        sfx.error();
      }
    }
  }

  // Asked ONCE, for good. `referralAsked` is the server's record that the
  // question has already been put — whether it was answered with a handle or
  // waved away — so it survives a reload, a new browser and a second Bloodline.
  // The in-memory Set stays only to stop a double-ask inside one session,
  // before the server has been told.
  if (!player.referred && !player.referralAsked && !_askedThisSession.has(`ref:${key}`)) {
    _askedThisSession.add(`ref:${key}`);
    const who = await askOverlay({
      title: 'Who brought you here?',
      message: `Name the X handle of the Cultist who brought you in. You are both `
        + `granted ${REFERRAL_DEVOTION} Devotion — once, and only once. `
        + `<em>You are asked this once.</em>`,
      placeholder: '@theirhandle',
      confirm: 'Speak the name',
      skip: 'Nobody',
    });
    let credited = false;
    if (who) {
      try {
        const r = await api.referral(who);
        showToast(`@${r.referrer} brought you in. ${r.devotionGained} Devotion to you both.`);
        credited = true;
        player.referred = r.referrer;
      } catch (e) {
        showToast(e.message || 'That name is not known here.');
        sfx.error();
      }
    }
    // Nothing was credited, so the question is closed rather than left to come
    // back on the next connect. A failed handle counts: they were asked, they
    // answered, and being nagged after a typo is the same nuisance.
    if (!credited) {
      player.referralAsked = true;
      try { await api.declineReferral(); } catch { /* it will be asked once more at worst */ }
    }
  }
  walletOverlay.hidden = true;
}

// The mint rite. The Doctrine is read first (the dialogue box above), then this
// asks the one question the contract actually takes: how many Cultists.
//
// The count is fixed at mint and there is deliberately no function anywhere in
// the contract that raises it, so this is the only moment it is ever chosen.
// Price comes from the chain rather than a constant here — the contract demands
// exact payment and reverts on anything else, so a stale number in the client
// would be a guaranteed failed transaction.
async function openMintPicker(menu) {
  if (!connectedAddr) {
    showToast('Connect a wallet first.');
    if (menu) menu.sel = 0;
    return;
  }
  if (_mintTeardown) _mintTeardown();
  walletOverlay.classList.remove('picking');
  walletOverlay.hidden = false;
  walletConnectBtn.hidden = true;
  walletInput.hidden = true;
  walletSkipBtn.hidden = true;
  cultistGrid.hidden = true;
  cultistGrid.innerHTML = '';
  walletTitle.textContent = 'Raise a Bloodline';
  walletMsg.textContent = 'Consulting the chain…';

  let price;
  try {
    await ensureChain();
    if (!(await fetchMintOpen())) {
      walletMsg.textContent = 'The mint is not open yet. Leave by the Back door.';
      return;
    }
    price = await fetchPricePerCultist();
  } catch (e) {
    // Each of these used to surface as "the mint is not open", because a chain
    // with no contract on it answers every call with zero.
    const chain = await currentChainId();
    walletMsg.textContent = {
      WRONG_CHAIN: `Your wallet is on chain ${chain ?? '?'}. The Bloodlines live on Avalanche (43114) — switch, then try again.`,
      NO_CONTRACT_HERE: 'No collection found at the configured address.',
      NO_WALLET: 'No wallet connected.',
      NO_CONTRACT: 'The collection is not configured.',
    }[e && e.message] || 'Could not reach the chain. Try again shortly.';
    return;
  }

  const total = (n) => price * BigInt(n);
  walletMsg.innerHTML = 'How many Cultists shall this Bloodline hold? The count is fixed '
    + `forever at the moment it is raised. <span class="addr">${formatAvax(price)} AVAX</span> each.`;

  cultistSlider.hidden = false;
  walletSubmitBtn.hidden = false;
  walletSubmitBtn.textContent = 'Raise it';
  cultistRange.value = '1';
  // Bigger type, and no Back button — see the `.minting` block in styles.css.
  walletOverlay.classList.add('minting');

  const paint = () => {
    const n = Number(cultistRange.value);
    cultistCount.textContent = `${n} Cultist${n === 1 ? '' : 's'}`;
    cultistCost.textContent = `${formatAvax(total(n))} AVAX`;
  };
  paint();

  // Cleared on every exit from this rite, or the listeners stack up each time
  // the player opens MINT and one press would fire several mints.
  const teardown = () => {
    cultistSlider.hidden = true;
    walletSubmitBtn.hidden = true;
    walletOverlay.classList.remove('minting');
    cultistRange.removeEventListener('input', paint);
    walletSubmitBtn.removeEventListener('click', onRaise);
    walletBackBtn.removeEventListener('click', teardown);
    _mintTeardown = null;
    _mintInput = null;
  };
  _mintTeardown = teardown;

  // The console drives this screen: d-pad sets the count, A raises the
  // Bloodline, B backs out. B is also the only way OUT — the Back button is
  // hidden while the count is being chosen, so without this the exits left
  // would be buying a Bloodline or reloading the page.
  //
  // Left/right step by one and up/down by five. consumeDir is edge-triggered
  // and deliberately never repeats (see engine.js), so a pure ±1 slider would
  // be nineteen separate presses to reach the top of the range; the coarse
  // axis makes the far end reachable without giving up single-Cultist aim.
  _mintInput = {
    handleInput(inp) {
      // While the transaction is in flight the controls are disabled, and that
      // has to include these — otherwise A fires a second mint over the first.
      if (cultistRange.disabled) return;
      const lo = Number(cultistRange.min) || 1;
      const hi = Number(cultistRange.max) || 20;
      let d;
      // Drained rather than read once: the queue can hold more than one press
      // between frames, and dropping the rest makes the slider feel sticky.
      while ((d = inp.consumeDir ? inp.consumeDir() : null)) {
        const step = (d === 'up' || d === 'down') ? 5 : 1;
        const way = (d === 'right' || d === 'up') ? 1 : -1;
        const was = Number(cultistRange.value);
        const now = Math.min(hi, Math.max(lo, was + way * step));
        if (now !== was) { cultistRange.value = String(now); paint(); sfx.click(); }
      }
      if (inp.consumeAPress()) { onRaise(); return; }
      if (inp.consumeBPress()) {
        teardown();
        closeBloodlinePicker();
        if (menu) menu.sel = 0;
      }
    },
  };
  // The A press that chose MINT is still sitting in the queue. Unflushed, the
  // very next frame reads it as "Raise it" and sends a real transaction the
  // player never asked for.
  input.flush();

  async function onRaise() {
    const n = Number(cultistRange.value);
    cultistRange.disabled = true;
    walletSubmitBtn.disabled = true;
    walletMsg.textContent = `Confirm ${n} Cultist${n === 1 ? '' : 's'} in your wallet…`;
    try {
      const before = heldBloodlines.length;
      const hash = await mintBloodline(connectedAddr, n);
      walletMsg.innerHTML = `Sent. Waiting for the chain to seal it…<br><span class="addr">${String(hash).slice(0, 18)}…</span>`;
      const receipt = await waitForTx(hash);
      if (receipt && receipt.status === '0x0') throw new Error('The transaction was reverted.');

      // A timed-out receipt is NOT a failed mint, and is no longer treated as
      // one. Either way the wait runs until the line actually shows up in the
      // wallet. The overlay stays up for it: the player has just paid, and a
      // menu with nothing happening on it is the worst place to leave them.
      walletMsg.textContent = 'Raised. Waiting for the abbey to see it…';
      const list = await waitForNewBloodline(before);

      teardown();
      // Hand the controls back BEFORE the bind, which opens the handle and
      // referral prompts on this same button. Leaving them disabled until the
      // finally below is a deadlock: that finally waits on those prompts.
      cultistRange.disabled = false;
      walletSubmitBtn.disabled = false;
      walletOverlay.hidden = true;
      if (!list) {
        // Not lost — not seen yet. The name can be given later from LINES, so
        // nothing is stranded by this.
        showToast('The mint is sent but has not appeared yet. Press WALLET when it lands.');
        return;
      }
      heldBloodlines = await withNames(list);
      heldCultists = totalCultists(heldBloodlines);
      const fresh = heldBloodlines[heldBloodlines.length - 1];
      showToast(`The Bloodline is raised — ${n} Cultist${n === 1 ? '' : 's'}.`);
      // Offered here, at the moment it is raised. No longer the ONLY chance:
      // skipping it leaves the line unnamed and LINES can name it later.
      let given = null;
      if (fresh) {
        given = await askOverlay({
          title: 'Name the Bloodline',
          message: 'What shall this line be called? The abbey will use this name '
            + 'every time you take it up, and it is carved on its card.',
          placeholder: 'House Vane',
          confirm: 'Name it',
          skip: 'Leave it unnamed',
        });
      }
      if (fresh) await bindBloodline(fresh, menu, given);
    } catch (e) {
      const why = {
        MINT_CLOSED: 'The mint is not open yet.',
        BAD_CULTISTS: 'A Bloodline holds between 1 and 20 Cultists.',
        NO_WALLET: 'No wallet connected.',
        NO_CONTRACT: 'The collection is not configured.',
        WRONG_CHAIN: 'Switch your wallet to Avalanche and try again.',
        NO_CONTRACT_HERE: 'No collection found at the configured address.',
      }[e && e.message] || (e && e.message) || 'The rite failed.';
      walletMsg.textContent = why;
      sfx.error();
    } finally {
      cultistRange.disabled = false;
      walletSubmitBtn.disabled = false;
    }
  }

  cultistRange.addEventListener('input', paint);
  walletSubmitBtn.addEventListener('click', onRaise);
  walletBackBtn.addEventListener('click', teardown);
}

// The entrance overlay used to run a whole second wallet flow of its own —
// openWalletFlow() + its own Connect handler + a Cultist chooser — but nothing
// has called it since the title menu took over connecting. It is gone rather
// than left sitting there: it counted a wallet's holdings the old way (one
// Cultist per token) and would have quietly disagreed with the menu about how
// many Cultists somebody had. The overlay itself is still used, by the
// Bloodline picker and the mint rite above.

function proceedIntoGame() {
  walletOverlay.hidden = true;
  if (scene && scene.exit) scene.exit();
  const chosen = chosenCultist;
  revealTransition(() => {
    enterCourtyard(entrancePlayer);
    if (chosen) showToast(`You enter as ${chosen.name}.`);
  });
}

walletBackBtn.addEventListener('click', () => {
  if (_lines) { closeLinesScreen(null); return; }
  // Through closeBloodlinePicker, not by hiding the overlay directly: a live
  // picker left behind would go on swallowing every d-pad and A press with
  // nothing on screen to show for it.
  closeBloodlinePicker();
  if (scene && scene.resume) scene.resume();
});

async function afterBoot() {
  playStinger();
  try {
    let player;
    try { player = await api.me(); }
    catch {
      const { name, sex } = randomIdentity();
      await api.register(name, sex, '');
      player = await api.me();
    }
    revealTransition(() => enterEntrance(player));
  } catch (err) {
    showToast(err.message);
  }
}

function startBoot() {
  scene = new BootScene({ onComplete: afterBoot });
  scene.enter();
  hint.textContent = '';
}

// The "Presented by / Members Only" card is gone. It was never reachable —
// powerOn() has always gone straight to the title card — and its only real job
// was to give the browser a second user gesture to start the music on, which
// kickAudio() below now does properly and invisibly. The scene itself is still
// in scenes/presenter.js if it is ever wanted as a card in its own right.

function powerOn() {
  if (powered) return;
  powered = true;
  // Fresh Audio inside user gesture = most reliable on mobile browsers
  _bgm = new Audio('assets/hymn.mp3');
  _bgm.loop = true;
  _bgm.volume = 0.55 * AUDIO_MASTER;
  _bgm.muted = sfx.isMuted();
  tryPlay(_bgm, 'hymn@power');
  // Strict-autoplay browsers only allow later programmatic play() on an element
  // whose FIRST play() happened inside a real gesture — which is what
  // unlockAudio() is for, and why the stinger has to be built here rather than
  // at the moment it is needed. (unlockAudio had no callers at all until now.)
  _want = _bgm;
  _stinger = new Audio('assets/title-a.mp3');
  _stinger.volume = 0.7 * AUDIO_MASTER;
  _stingerPrimed = false;
  kickAudio();          // primes the stinger, and retries the hymn if it balked
  powerSwitch.setAttribute('aria-pressed', 'true');
  document.body.classList.add('powered');
  startBoot();
  if (!stopLoop) {
    stopLoop = makeLoop(
      (dt) => {
        // The ring owns the controls while it is up, so a d-pad press turns it
        // instead of also walking the player underneath.
        if (emojiWheel.open) { emojiWheel.handleInput(input); return; }
        // Likewise the Bloodline chooser: without this an A press would both
        // take up a Bloodline AND fire whatever the menu had selected behind it.
        // A question owns the buttons before anything else does.
        if (_asking) {
          if (input.consumeAPress()) _asking.ok();
          else if (input.consumeBPress()) _asking.skip();
          if (input.consumeDir) input.consumeDir();
          return;
        }
        if (_picker) { _picker.handleInput(input); return; }
        // The mint slider likewise: d-pad to set the count, A to raise, B to
        // back out. It swallows the rest of the input while it is up, or a
        // press would also work the menu sitting behind the overlay.
        if (_mintInput) { _mintInput.handleInput(input); return; }
        // LINES likewise: d-pad to move, A to set what is unset, B out.
        if (_lines) { _lines.handleInput(input); return; }
        if (scene) scene.update(dt, input);
      },
      () => {
        if (powered && scene) {
          ctx.setTransform(RES, 0, 0, RES, 0, 0);
          ctx.imageSmoothingEnabled = false;
          scene.render(ctx);
        } else {
          drawOff();
        }
      }
    );
  }
}

function powerOff() {
  if (!powered) return;
  powered = false;
  for (const a of MUSIC()) { try { a.pause(); a.currentTime = 0; } catch {} }
  _bgm = null; _gameBgm = null; _want = null;
  powerSwitch.setAttribute('aria-pressed', 'false');
  document.body.classList.remove('powered');
  _stinger = null;
  _stingerPrimed = false;
  _priming = false;
  if (scene && scene.exit) scene.exit();
  scene = null;
  if (socket) { socket.disconnect(); socket = null; }

  // THE SWITCH IS A POWER SWITCH. It used to tear down the scene, the socket
  // and the music and leave the wallet exactly where it was, so turning the
  // console off and on again came back still holding someone's Bloodline — and
  // a playtester reasonably expected otherwise. It now lets go of everything
  // the session knew about the player, which also makes power-cycling the
  // reliable way back to the naming and referral prompts.
  //
  // For an injected wallet there is no true disconnect: the page can drop what
  // it knows, but the provider stays authorised. Dropping our own state is the
  // part that is ours to do.
  disconnectWallet().catch(() => { /* nothing to hang up */ });
  connectedAddr = null;
  heldBloodlines = [];
  heldCultists = 0;
  boundToken = null;
  setTokenId(null);
  chosenCultist = null;
  entrancePlayer = null;
  _askedThisSession.clear();

  chatForm.hidden = true;
  hud.hidden = true;
  toastEl.hidden = true;
  communionOverlay.hidden = true;
  walletOverlay.hidden = true;
  drawOff();
  hint.textContent = '';
}

// Drag the knob across the track, or just tap the switch — either commits.
let drag = null;
powerSwitch.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  powerSwitch.setPointerCapture(e.pointerId);
  powerSwitch.classList.add('dragging');
  drag = { x0: e.clientX, w: powerSwitch.getBoundingClientRect().width * 0.5, f: powered ? 1 : 0, moved: false };
});
powerSwitch.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const f = Math.max(0, Math.min(1, drag.f + (e.clientX - drag.x0) / drag.w));
  if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
  powerKnob.style.left = `${3 + f * 50}%`;
  if (powered ? f < 0.25 : f > 0.75) {
    if (powered) powerOff(); else powerOn();
    drag = null;
    powerSwitch.classList.remove('dragging');
  }
});
['pointerup', 'pointercancel'].forEach((ev) => powerSwitch.addEventListener(ev, () => {
  if (drag && !drag.moved) { if (powered) powerOff(); else powerOn(); }
  drag = null;
  powerSwitch.classList.remove('dragging');
  powerKnob.style.left = '';
}));

// ---- B always backs out ----
// Whatever overlay is open, B (the console button or the keyboard B keys)
// closes the topmost one. We listen in the capture phase, ABOVE the button /
// window, so this runs before the engine's own B handling and can swallow the
// press — the scene underneath never sees it, so B won't also drop a gift etc.
const backableOverlays = () => [
  communionOverlay,
  walletOverlay, chatForm,
];
function anyOverlayOpen() { return backableOverlays().some((o) => o && !o.hidden); }
// The overlay screens that run their own input loop each have a B of their own,
// and theirs knows what to undo. This escape hatch predates all of them and
// knows only one move — hide the wallet overlay and call the picker closed —
// so on a naming prompt it left the prompt's promise unresolved, its dress
// still on the overlay and the screen simply gone. That was the other half of
// the naming "glitch": B did not back out of the question, it deleted it.
function screenOwnsB() { return !!(_asking || _picker || _mintInput || _lines); }
function backOut() {
  if (!communionOverlay.hidden) { communionOverlay.hidden = true; return true; }
  if (!walletOverlay.hidden) { closeBloodlinePicker(); if (scene && scene.resume) scene.resume(); return true; }
  if (!chatForm.hidden) { chatForm.hidden = true; return true; }
  return false;
}

const btnBEl = document.getElementById('btnB');
document.addEventListener('pointerdown', (e) => {
  if (!anyOverlayOpen() || screenOwnsB()) return;
  if (e.target === btnBEl || (btnBEl && btnBEl.contains(e.target))) {
    e.stopImmediatePropagation(); e.preventDefault();
    sfx.click(); backOut();
  }
}, true);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyX' && e.code !== 'ShiftLeft') return;
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  if (typing || !anyOverlayOpen() || screenOwnsB()) return;
  e.stopImmediatePropagation(); e.preventDefault();
  backOut();
}, true);

drawOff();
