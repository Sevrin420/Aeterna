import { Input, makeLoop } from './engine.js';
import { BootScene } from './scenes/boot.js';
import { CourtyardScene } from './scenes/courtyard.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const powerSwitch = document.getElementById('powerSwitch');
const hint = document.getElementById('hint');

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

function drawOff() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function goToCourtyard() {
  scene = new CourtyardScene();
  scene.enter();
  hint.textContent = 'Move with the D-pad or arrow keys.';
}

function startBoot() {
  scene = new BootScene({ onComplete: goToCourtyard });
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
  scene = null;
  drawOff();
  hint.textContent = 'Slide the switch to power on the console.';
}

powerSwitch.addEventListener('click', () => {
  if (powered) powerOff(); else powerOn();
});

drawOff();
