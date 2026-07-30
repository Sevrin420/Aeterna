import { Input, makeLoop } from './engine.js';
import { PresenterScene } from './scenes/presenter.js';
import { BootScene } from './scenes/boot.js';
import { EntranceScene } from './scenes/entrance.js';
import { CourtyardScene } from './scenes/courtyard.js';
import { api } from './api.js';
import { sfx } from './sfx.js';
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
const hudXpFill = document.getElementById('hudXpFill');
const hudXpTxt = document.getElementById('hudXpTxt');
const hudDevotion = document.getElementById('hudDevotion');
const hudStreak = document.getElementById('hudStreak');
const pipPray = document.getElementById('pipPray');
const pipGarden = document.getElementById('pipGarden');
const pipCandles = document.getElementById('pipCandles');
const toastEl = document.getElementById('toast');
const leaderboardOverlay = document.getElementById('leaderboardOverlay');
const leaderboardList = document.getElementById('leaderboardList');
const leaderboardClose = document.getElementById('leaderboardClose');
const bootVeil = document.getElementById('bootVeil');
const powerKnob = powerSwitch.querySelector('.power-knob');
const muteToggle = document.getElementById('muteToggle');
const mancalaOverlay = document.getElementById('mancalaOverlay');
const mancalaStatus = document.getElementById('mancalaStatus');
const mancalaStoreA = document.getElementById('mancalaStoreA');
const mancalaStoreB = document.getElementById('mancalaStoreB');
const mancalaPits = [...document.querySelectorAll('.mancala-pit')];
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
const MUSIC = () => [_bgm, _gameBgm].filter(Boolean);
function applyMute(m) { for (const a of MUSIC()) a.muted = m; }

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
function unlockAudio(el) {
  try {
    const p = el.play();
    el.pause();
    el.currentTime = 0;
    if (p && p.catch) p.catch(() => {});
  } catch { /* ignore */ }
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

function updateHud(player) {
  const dev = player.devotion || 0;
  const li = levelInfo(dev);
  hudLevel.textContent = `LV ${li.level}`;
  hudXpFill.style.width = `${li.pct * 100}%`;
  hudXpTxt.textContent = `${li.cur} / ${li.need} XP`;
  hudDevotion.textContent = `✦ ${dev}`;
  hudName.textContent = `${player.prefix} ${player.name}`;
  hudStreak.textContent = player.streak > 0 ? `${player.streak}d ×${player.multiplier}` : '';
  pipPray.classList.toggle('done', !!player.pray_today);
  pipGarden.classList.toggle('done', !!player.garden_today);
  pipCandles.classList.toggle('done', !!player.candles_today);
  hud.hidden = false;
}

function ensureSocket() {
  if (socket || typeof io === 'undefined') return socket;
  socket = io({ autoConnect: true });
  return socket;
}

function showLeaderboard(rows) {
  leaderboardList.innerHTML = rows.map((r) => `
    <li><span>${r.prefix} ${r.name}</span><span class="lb-devotion">${r.devotion}${r.streak > 0 ? ` · ${r.streak}d` : ''}</span></li>
  `).join('') || '<li>No Cultists yet.</li>';
  leaderboardOverlay.hidden = false;
}
leaderboardClose.addEventListener('click', () => { leaderboardOverlay.hidden = true; });

function renderMancalaBoard(board) {
  mancalaPits.forEach((b) => { b.textContent = board[Number(b.dataset.pit)]; });
  mancalaStoreA.textContent = board[6];
  mancalaStoreB.textContent = board[13];
}

function showMancala(state) {
  mancalaOverlay.hidden = false;

  if (state.type === 'end' || state.forfeited) {
    if (state.board) renderMancalaBoard(state.board);
    mancalaPits.forEach((b) => { b.disabled = true; });
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
    setTimeout(() => { mancalaOverlay.hidden = true; }, 3200);
    return;
  }

  if (state.waiting || !state.board) {
    mancalaStatus.textContent = 'Waiting for an opponent to sit...';
    mancalaPits.forEach((b) => { b.textContent = ''; b.disabled = true; });
    mancalaStoreA.textContent = '';
    mancalaStoreB.textContent = '';
    mancalaSoloBtn.hidden = false; // offer a solo game against the Abbot
    return;
  }

  renderMancalaBoard(state.board);
  mancalaSoloBtn.hidden = true;
  const yourTurn = state.turn === state.seat;
  if (state.solo) {
    mancalaStatus.textContent = yourTurn ? 'You vs the Abbot · Your move' : 'The Abbot contemplates…';
  } else {
    mancalaStatus.textContent = `${state.names[0]} vs ${state.names[1]} · Wager ${state.wager} Devotion each · ${yourTurn ? 'Your move' : "Opponent's move"}`;
  }
  mancalaPits.forEach((b) => {
    const pit = Number(b.dataset.pit);
    const ownPit = state.seat === 0 ? pit <= 5 : pit >= 7;
    b.disabled = !(yourTurn && ownPit && state.board[pit] > 0);
  });
}

mancalaPits.forEach((b) => b.addEventListener('click', () => {
  if (scene && scene.sendMancalaMove) scene.sendMancalaMove(Number(b.dataset.pit));
}));
mancalaSoloBtn.addEventListener('click', () => {
  if (scene && scene.startMancalaSolo) scene.startMancalaSolo();
});
mancalaLeaveBtn.addEventListener('click', () => {
  if (scene && scene.leaveMancala) scene.leaveMancala();
  mancalaOverlay.hidden = true;
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
  _gameBgm.volume = 0.5;
  _gameBgm.muted = false;
  _gameBgm.play().catch(() => {});
  scene = new CourtyardScene({
    player,
    onPlayerUpdate: updateHud,
    onToast: showToast,
    socket: ensureSocket(),
    onLeaderboard: showLeaderboard,
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
const docsOverlay = document.getElementById('docsOverlay');
const docsClose = document.getElementById('docsClose');
const mintOverlay = document.getElementById('mintOverlay');
const mintClose = document.getElementById('mintClose');
const walletOverlay = document.getElementById('walletOverlay');
const walletTitle = document.getElementById('walletTitle');
const walletMsg = document.getElementById('walletMsg');
const cultistGrid = document.getElementById('cultistGrid');
const walletConnectBtn = document.getElementById('walletConnect');
const walletEnterBtn = document.getElementById('walletEnter');
const walletBackBtn = document.getElementById('walletBack');

function entranceOverlaysOpen() {
  return !docsOverlay.hidden || !mintOverlay.hidden || !walletOverlay.hidden;
}

docsClose.addEventListener('click', () => { docsOverlay.hidden = true; });
mintClose.addEventListener('click', () => { mintOverlay.hidden = true; });

let entrancePlayer = null;
let chosenCultist = null;

// Save & Exit from the game returns to the entry lobby (not power off). Devotion
// was already saved by the scene before this runs.
function returnToEntrance() {
  if (scene && scene.exit) scene.exit();
  if (socket) { socket.disconnect(); socket = null; }
  hud.hidden = true;
  revealTransition(() => enterEntrance(entrancePlayer));
}

function enterEntrance(player) {
  entrancePlayer = player;
  // Entry-lobby music: the title hymn plays here (the in-game hymn is paused).
  if (_gameBgm) try { _gameBgm.pause(); } catch {}
  if (!_bgm) {
    _bgm = new Audio('assets/hymn.mp3');
    _bgm.loop = true;
    _bgm.volume = 0.55;
    _bgm.muted = sfx.isMuted();
    _bgm.play().catch(() => {});
  } else {
    _bgm.muted = sfx.isMuted();
    if (_bgm.paused) _bgm.play().catch(() => {});
  }
  scene = new EntranceScene({
    player,
    onDocs: () => { docsOverlay.hidden = false; },
    onMint: () => { mintOverlay.hidden = false; },
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
  if (!sfx.isMuted()) { try { stinger.currentTime = 0; stinger.play().catch(() => {}); } catch {} }
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

// First scene on power-on: "Presented by / Members Only". Pressing A there plays
// the title-card stinger and reveals the title card (image fade + logo drop).
function startPresenter() {
  scene = new PresenterScene({
    onComplete: () => {
      if (!sfx.isMuted()) { try { stinger.currentTime = 0; stinger.play().catch(() => {}); } catch { /* ignore */ } }
      startBoot();
    },
  });
  scene.enter();
  hint.textContent = '';
}

function powerOn() {
  if (powered) return;
  powered = true;
  // Fresh Audio inside user gesture = most reliable on mobile browsers
  _bgm = new Audio('assets/hymn.mp3');
  _bgm.loop = true;
  _bgm.volume = 0.55;
  _bgm.muted = sfx.isMuted();
  _bgm.play().catch(() => {});
  powerSwitch.setAttribute('aria-pressed', 'true');
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
  _bgm = null; _gameBgm = null;
  powerSwitch.setAttribute('aria-pressed', 'false');
  if (scene && scene.exit) scene.exit();
  scene = null;
  if (socket) { socket.disconnect(); socket = null; }
  chatForm.hidden = true;
  hud.hidden = true;
  toastEl.hidden = true;
  leaderboardOverlay.hidden = true;
  mancalaOverlay.hidden = true;
  communionOverlay.hidden = true;
  docsOverlay.hidden = true;
  mintOverlay.hidden = true;
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
  communionOverlay, mancalaOverlay, leaderboardOverlay,
  walletOverlay, docsOverlay, mintOverlay, chatForm,
];
function anyOverlayOpen() { return backableOverlays().some((o) => o && !o.hidden); }
function backOut() {
  if (!communionOverlay.hidden) { communionOverlay.hidden = true; return true; }
  if (!mancalaOverlay.hidden) { if (scene && scene.leaveMancala) scene.leaveMancala(); mancalaOverlay.hidden = true; return true; }
  if (!leaderboardOverlay.hidden) { leaderboardOverlay.hidden = true; return true; }
  if (!walletOverlay.hidden) { walletOverlay.hidden = true; if (scene && scene.resume) scene.resume(); return true; }
  if (!docsOverlay.hidden) { docsOverlay.hidden = true; return true; }
  if (!mintOverlay.hidden) { mintOverlay.hidden = true; return true; }
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
