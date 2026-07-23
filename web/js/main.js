import { Input, makeLoop } from './engine.js';
import { BootScene } from './scenes/boot.js';
import { CourtyardScene } from './scenes/courtyard.js';
import { api } from './api.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const powerSwitch = document.getElementById('powerSwitch');
const hint = document.getElementById('hint');
const namingForm = document.getElementById('namingForm');
const namingName = document.getElementById('namingName');
const namingHandle = document.getElementById('namingHandle');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const hud = document.getElementById('hud');
const hudName = document.getElementById('hudName');
const hudDevotion = document.getElementById('hudDevotion');
const hudStreak = document.getElementById('hudStreak');
const toastEl = document.getElementById('toast');
const leaderboardOverlay = document.getElementById('leaderboardOverlay');
const leaderboardList = document.getElementById('leaderboardList');
const leaderboardClose = document.getElementById('leaderboardClose');

const input = new Input();
input.bindDpad(document.getElementById('dpadUp'), 'up');
input.bindDpad(document.getElementById('dpadDown'), 'down');
input.bindDpad(document.getElementById('dpadLeft'), 'left');
input.bindDpad(document.getElementById('dpadRight'), 'right');
input.bindButton(document.getElementById('btnA'), 'a');
input.bindButton(document.getElementById('btnB'), 'b');

let powered = false;
let scene = null;
let stopLoop = null;
let toastTimer = null;
let socket = null;

function drawOff() {
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
  namingForm.hidden = true;
  updateHud(player);
  scene = new CourtyardScene({
    player,
    onPlayerUpdate: updateHud,
    onToast: showToast,
    socket: ensureSocket(),
    onLeaderboard: showLeaderboard,
    onSaveExit: powerOff,
    onChatOpen: openChat,
  });
  scene.enter();
  hint.textContent = 'D-pad/arrows to move · A to interact · B to drop, T to chat.';
  window.__aeterna = { scene, player };
}

function showNamingForm() {
  hud.hidden = true;
  namingForm.hidden = false;
  namingName.focus();
  hint.textContent = 'Enter your name to join the abbey.';
}

async function afterBoot() {
  try {
    const player = await api.me();
    enterCourtyard(player);
  } catch {
    showNamingForm();
  }
}

namingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = namingName.value.trim();
  if (!name) return;
  const sex = namingForm.querySelector('input[name="sex"]:checked').value;
  const xHandle = namingHandle.value.trim();
  try {
    await api.register(name, sex, xHandle);
    const player = await api.me();
    enterCourtyard(player);
  } catch (err) {
    showToast(err.message);
  }
});

function startBoot() {
  scene = new BootScene({ onComplete: afterBoot });
  scene.enter();
  hint.textContent = 'Press A when the console is ready.';
}

function powerOn() {
  if (powered) return;
  powered = true;
  powerSwitch.setAttribute('aria-pressed', 'true');
  startBoot();
  if (!stopLoop) {
    stopLoop = makeLoop(
      (dt) => { if (scene) scene.update(dt, input); },
      () => { if (powered && scene) scene.render(ctx); else drawOff(); }
    );
  }
}

function powerOff() {
  if (!powered) return;
  powered = false;
  powerSwitch.setAttribute('aria-pressed', 'false');
  if (scene && scene.exit) scene.exit();
  scene = null;
  if (socket) { socket.disconnect(); socket = null; }
  namingForm.hidden = true;
  chatForm.hidden = true;
  hud.hidden = true;
  toastEl.hidden = true;
  leaderboardOverlay.hidden = true;
  drawOff();
  hint.textContent = 'Slide the switch to power on the console.';
}

powerSwitch.addEventListener('click', () => {
  if (powered) powerOff(); else powerOn();
});

drawOff();
