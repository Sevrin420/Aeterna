import { Input, makeLoop } from './engine.js';
import { BootScene } from './scenes/boot.js';
import { EntranceScene } from './scenes/entrance.js';
import { CourtyardScene } from './scenes/courtyard.js';
import { api } from './api.js';
import { MancalaBoard } from './mancala.js';
import { sfx, AUDIO_MASTER } from './sfx.js';
import { connectWallet, fetchCultists, shortAddr, hasInjectedWallet } from './wallet.js';

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
const mancalaOverlay = document.getElementById('mancalaOverlay');
const mancalaStatus = document.getElementById('mancalaStatus');
const mancalaCanvas = document.getElementById('mancalaCanvas');
const mancalaLeaveBtn = document.getElementById('mancalaLeave');
const mancalaSoloBtn = document.getElementById('mancalaSolo');
const communionOverlay = document.getElementById('communionOverlay');
const communionBody = document.getElementById('communionBody');
const communionClose = document.getElementById('communionClose');

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

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
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
// built on first use rather than at load, because the canvas has no size until
// the overlay is shown and a zero-sized canvas measures itself as zero forever.
let mancalaBoard = null;
function getMancalaBoard() {
  if (!mancalaBoard) {
    mancalaBoard = new MancalaBoard(mancalaCanvas, {
      onPit: (pit) => { if (scene && scene.sendMancalaMove) scene.sendMancalaMove(pit); },
    });
  }
  return mancalaBoard;
}

function showMancala(state) {
  mancalaOverlay.hidden = false;
  const mb = getMancalaBoard();
  mb.start();

  if (state.type === 'end' || state.forfeited) {
    mb.setState({ ...state, board: state.board || null });
    mancalaSoloBtn.hidden = true;
    const won = state.winnerSeat === state.seat;
    mancalaStatus.textContent = state.forfeited
      ? 'Your opponent left the table. Your wager was refunded.'
      : state.solo
        ? (state.draw ? 'A stalemate with the Abbot.' : won ? 'You beat the Abbot! The order takes note.' : 'The Abbot bests you.')
        : state.draw
          ? 'A draw — both wagers refunded.'
          : won ? `You win! +${state.payout} Devotion.` : 'You lose the wager.';
    if (!state.forfeited && !state.draw) sfx[won ? 'streakBonus' : 'error']?.();
    api.me().then(updateHud).catch(() => {});
    // Longer than it was: the final score is now painted on the board itself,
    // and 3.2s was not enough to read a scoreline you were not expecting.
    setTimeout(() => { mancalaOverlay.hidden = true; mb.stop(); }, 6000);
    return;
  }

  if (state.waiting || !state.board) {
    mancalaStatus.textContent = 'Waiting for an opponent to sit...';
    mb.setState(state);
    mancalaSoloBtn.hidden = false; // offer a solo game against the Abbot
    return;
  }

  mb.setState(state);
  mancalaSoloBtn.hidden = true;
  const yourTurn = state.turn === state.seat;
  if (state.solo) {
    mancalaStatus.textContent = yourTurn ? 'You vs the Abbot · Your move' : 'The Abbot contemplates…';
  } else {
    mancalaStatus.textContent = `${state.names[0]} vs ${state.names[1]} · Wager ${state.wager} Devotion each · ${yourTurn ? 'Your move' : "Opponent's move"}`;
  }
}

mancalaSoloBtn.addEventListener('click', () => {
  if (scene && scene.startMancalaSolo) scene.startMancalaSolo();
});
mancalaLeaveBtn.addEventListener('click', () => {
  if (scene && scene.leaveMancala) scene.leaveMancala();
  mancalaOverlay.hidden = true;
  if (mancalaBoard) mancalaBoard.stop();
});

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
    onMancala: showMancala,
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

// ---- Entrance lobby (ghost -> Docs/Mint tables -> north arch -> wallet) ----
const walletOverlay = document.getElementById('walletOverlay');
const walletTitle = document.getElementById('walletTitle');
const walletMsg = document.getElementById('walletMsg');
const cultistGrid = document.getElementById('cultistGrid');
const walletConnectBtn = document.getElementById('walletConnect');
const walletEnterBtn = document.getElementById('walletEnter');
const walletBackBtn = document.getElementById('walletBack');

// The Doctrine and the mint rite are read in the in-canvas dialogue box now,
// so the only DOM overlay the entrance still raises is the wallet flow.
function entranceOverlaysOpen() {
  return !walletOverlay.hidden;
}

let entrancePlayer = null;
let chosenCultist = null;

// Save & Exit from the game returns to the entry lobby (not power off). Devotion
// was already saved by the scene before this runs.
// Leaving the abbey means walking out of its SOUTH door, so the player comes
// back into the courtyard at its north end — under the arch they went in by.
// Arriving fresh (or after a reload) starts them in the middle of the yard.
function returnToEntrance() {
  if (scene && scene.exit) scene.exit();
  if (socket) { socket.disconnect(); socket = null; }
  hud.hidden = true;
  revealTransition(() => enterEntrance(entrancePlayer, 'north'));
}

function enterEntrance(player, spawn = 'centre') {
  entrancePlayer = player;
  // Entry-lobby music: the title hymn plays here (the in-game hymn is paused).
  if (_gameBgm) try { _gameBgm.pause(); } catch {}
  if (!_bgm) {
    _bgm = new Audio('assets/hymn.mp3');
    _bgm.loop = true;
    _bgm.volume = 0.55 * AUDIO_MASTER;
    _bgm.muted = sfx.isMuted();
    tryPlay(_bgm, 'hymn@lobby');
  } else {
    _bgm.muted = sfx.isMuted();
    if (_bgm.paused) tryPlay(_bgm, 'hymn@lobby');
  }
  _want = _bgm;
  scene = new EntranceScene({
    player,
    spawn,
    onWallet: openWalletFlow,
    isBusy: entranceOverlaysOpen,
  });
  scene.enter();
  hint.textContent = '';
  window.__aeterna = { scene, player };
}

function openWalletFlow() {
  walletOverlay.hidden = false;
  cultistGrid.hidden = true;
  cultistGrid.innerHTML = '';
  walletEnterBtn.hidden = true;
  walletConnectBtn.hidden = false;
  chosenCultist = null;
  walletTitle.textContent = 'Enter the Sanctum';
  if (hasInjectedWallet()) {
    walletConnectBtn.textContent = 'Connect Wallet';
    walletMsg.innerHTML = 'Connect your wallet to choose your Cultist.';
  } else {
    // no injected provider (e.g. a normal desktop browser) — let them in
    walletConnectBtn.textContent = 'Connect Wallet';
    walletMsg.innerHTML = 'Open <span class="addr">membersonly.cc</span> inside your wallet’s browser to connect — or enter as a spirit.';
    walletEnterBtn.hidden = false;
  }
}

function proceedIntoGame() {
  walletOverlay.hidden = true;
  if (scene && scene.exit) scene.exit();
  const chosen = chosenCultist;
  revealTransition(() => {
    enterCourtyard(entrancePlayer);
    if (chosen) showToast(`You enter as ${chosen.name}.`);
  });
}

walletConnectBtn.addEventListener('click', async () => {
  walletConnectBtn.disabled = true;
  walletMsg.textContent = 'Requesting wallet…';
  try {
    const addr = await connectWallet();
    walletMsg.innerHTML = `Connected <span class="addr">${shortAddr(addr)}</span>. Seeking your Cultists…`;
    const cultists = await fetchCultists(addr);
    if (!cultists.length) {
      walletMsg.innerHTML = `Connected <span class="addr">${shortAddr(addr)}</span>. No Cultist NFTs found in this wallet.`;
      walletConnectBtn.hidden = true;
      walletEnterBtn.hidden = false;
    } else {
      renderCultistChoices(cultists);
    }
  } catch (err) {
    const m = err && err.message === 'NO_WALLET'
      ? 'No wallet found. Open membersonly.cc in your wallet’s browser — or enter as a spirit.'
      : 'Wallet not connected. You can still enter as a spirit.';
    walletMsg.textContent = m;
    walletEnterBtn.hidden = false;
  } finally {
    walletConnectBtn.disabled = false;
  }
});

function renderCultistChoices(cultists) {
  walletTitle.textContent = 'Choose your Cultist';
  walletConnectBtn.hidden = true;
  cultistGrid.hidden = false;
  cultistGrid.innerHTML = '';
  cultists.forEach((c) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cultist-card';
    card.textContent = c.name || `#${c.id}`;
    card.addEventListener('click', () => {
      chosenCultist = c;
      [...cultistGrid.children].forEach((el) => el.classList.remove('sel'));
      card.classList.add('sel');
      walletEnterBtn.hidden = false;
      walletEnterBtn.textContent = 'Enter the Sanctum';
    });
    cultistGrid.appendChild(card);
  });
  // (the chosen Cultist's NFT will drive the player's on-chain name/face once
  // the collection is live; for now selecting it just carries the name in.)
}

walletEnterBtn.addEventListener('click', proceedIntoGame);
walletBackBtn.addEventListener('click', () => {
  walletOverlay.hidden = true;
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
      (dt) => { if (scene) scene.update(dt, input); },
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
  chatForm.hidden = true;
  hud.hidden = true;
  toastEl.hidden = true;
  mancalaOverlay.hidden = true;
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
  communionOverlay, mancalaOverlay,
  walletOverlay, chatForm,
];
function anyOverlayOpen() { return backableOverlays().some((o) => o && !o.hidden); }
function backOut() {
  if (!communionOverlay.hidden) { communionOverlay.hidden = true; return true; }
  if (!mancalaOverlay.hidden) { if (scene && scene.leaveMancala) scene.leaveMancala(); mancalaOverlay.hidden = true; return true; }
  if (!walletOverlay.hidden) { walletOverlay.hidden = true; if (scene && scene.resume) scene.resume(); return true; }
  if (!chatForm.hidden) { chatForm.hidden = true; return true; }
  return false;
}

const btnBEl = document.getElementById('btnB');
document.addEventListener('pointerdown', (e) => {
  if (!anyOverlayOpen()) return;
  if (e.target === btnBEl || (btnBEl && btnBEl.contains(e.target))) {
    e.stopImmediatePropagation(); e.preventDefault();
    sfx.click(); backOut();
  }
}, true);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyX' && e.code !== 'ShiftLeft') return;
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  if (typing || !anyOverlayOpen()) return;
  e.stopImmediatePropagation(); e.preventDefault();
  backOut();
}, true);

drawOff();
