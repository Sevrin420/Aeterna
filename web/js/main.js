import { Input, makeLoop } from './engine.js';
import { BootScene } from './scenes/boot.js';
import { CourtyardScene } from './scenes/courtyard.js';
import { api } from './api.js';
import { sfx } from './sfx.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const powerSwitch = document.getElementById('powerSwitch');
const hint = document.getElementById('hint');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const hud = document.getElementById('hud');
const hudName = document.getElementById('hudName');
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
const communionOverlay = document.getElementById('communionOverlay');
const communionBody = document.getElementById('communionBody');
const communionClose = document.getElementById('communionClose');

muteToggle.setAttribute('aria-pressed', String(sfx.isMuted()));
muteToggle.addEventListener('click', () => {
  const nowMuted = sfx.toggleMute();
  muteToggle.setAttribute('aria-pressed', String(nowMuted));
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

function updateHud(player) {
  hudName.textContent = `${player.prefix} ${player.name}`;
  hudDevotion.textContent = `Devotion ${player.devotion}`;
  hudStreak.textContent = player.streak > 0 ? ` · Streak ${player.streak}d (${player.multiplier}x)` : '';
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
    mancalaStatus.textContent = state.forfeited
      ? 'Your opponent left the table. Your wager was refunded.'
      : state.draw
        ? 'A draw — both wagers refunded.'
        : state.winnerSeat === state.seat
          ? `You win! +${state.payout} Devotion.`
          : 'You lose the wager.';
    if (!state.forfeited && !state.draw) sfx[state.winnerSeat === state.seat ? 'streakBonus' : 'error']?.();
    api.me().then(updateHud).catch(() => {});
    setTimeout(() => { mancalaOverlay.hidden = true; }, 3200);
    return;
  }

  if (state.waiting || !state.board) {
    mancalaStatus.textContent = 'Waiting for an opponent to sit...';
    mancalaPits.forEach((b) => { b.textContent = ''; b.disabled = true; });
    mancalaStoreA.textContent = '';
    mancalaStoreB.textContent = '';
    return;
  }

  renderMancalaBoard(state.board);
  const yourTurn = state.turn === state.seat;
  mancalaStatus.textContent = `${state.names[0]} vs ${state.names[1]} · Wager ${state.wager} Devotion each · ${yourTurn ? 'Your move' : "Opponent's move"}`;
  mancalaPits.forEach((b) => {
    const pit = Number(b.dataset.pit);
    const ownPit = state.seat === 0 ? pit <= 5 : pit >= 7;
    b.disabled = !(yourTurn && ownPit && state.board[pit] > 0);
  });
}

mancalaPits.forEach((b) => b.addEventListener('click', () => {
  if (scene && scene.sendMancalaMove) scene.sendMancalaMove(Number(b.dataset.pit));
}));
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

function enterCourtyard(player) {
  updateHud(player);
  scene = new CourtyardScene({
    player,
    onPlayerUpdate: updateHud,
    onToast: showToast,
    socket: ensureSocket(),
    onLeaderboard: showLeaderboard,
    onSaveExit: powerOff,
    onChatOpen: openChat,
    onMancala: showMancala,
    onFinalCommunion: showFinalCommunion,
  });
  scene.enter();
  hint.textContent = 'D-pad/arrows to move · A to interact · B to drop, T to chat.';
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

async function afterBoot() {
  sfx.bootConfirm();
  try {
    const player = await api.me();
    revealTransition(() => enterCourtyard(player));
  } catch {
    try {
      const { name, sex } = randomIdentity();
      await api.register(name, sex, '');
      const player = await api.me();
      revealTransition(() => enterCourtyard(player));
    } catch (err) {
      showToast(err.message);
    }
  }
}

function startBoot() {
  scene = new BootScene({ onComplete: afterBoot });
  scene.enter();
  hint.textContent = 'Press A when the console is ready.';
}

function powerOn() {
  if (powered) return;
  powered = true;
  sfx.power(true);
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
  sfx.power(false);
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
  drawOff();
  hint.textContent = 'Slide the switch to power on the console.';
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

drawOff();
