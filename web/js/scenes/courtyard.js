// The walled abbey courtyard — first scene after boot + naming.
// Small hand-authored tile map rendered with plain canvas primitives (no sprite assets),
// wired to the real Fastify API (duties, gifts, confession) and Socket.io presence.

import { api, getWalletId } from '../api.js';
import { sfx } from '../sfx.js';
import { getCultistSprite } from '../pixelart.js';

const TILE = 13;
const COLS = 16;
const ROWS = 16;
const W = COLS * TILE;
const H = ROWS * TILE;

// # wall  .  floor  P pillar  F fountain  (blank cols/rows outside are never read)
const MAP = [
  '################',
  '#P............P#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......FF......#',
  '#......FF......#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#P............P#',
  '#######..#######',
];

const SOLID = new Set(['#', 'P', 'F']);
const TORCH_COLS = [4, 11];
const GIFT_POLL_MS = 4000;

function tileAt(col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return '#';
  return MAP[row][col];
}
function isSolid(col, row) {
  return SOLID.has(tileAt(col, row));
}

const px = (tx) => tx * TILE + TILE / 2;

const STATIONS = [
  { id: 'pray', kind: 'duty', label: 'Pray', x: px(8), y: px(2.4), r: 15 },
  { id: 'garden', kind: 'duty', label: 'Tend Garden', x: px(3), y: px(5), r: 15 },
  { id: 'candles', kind: 'duty', label: 'Light Candles', x: px(12.5), y: px(5), r: 15 },
  { id: 'guru', kind: 'guru', label: 'Offer to the Guru', x: px(7.5), y: px(11), r: 16 },
  { id: 'confession', kind: 'confession', label: 'Confess', x: px(3), y: px(12.3), r: 15 },
  { id: 'leaderboard', kind: 'leaderboard', label: 'View Leaderboard', x: px(12.5), y: px(2.2), r: 15 },
  { id: 'gate', kind: 'gate', label: 'Save & Exit [B]', x: px(7.5), y: px(14), r: 22 },
];
const EMOJI_KEYS = { Digit1: '🙏', Digit2: '✨', Digit3: '🕯️' };

export class CourtyardScene {
  constructor({ player, onPlayerUpdate, onToast, socket, onLeaderboard, onSaveExit, onChatOpen }) {
    this.player = player;
    this.onPlayerUpdate = onPlayerUpdate || (() => {});
    this.onToast = onToast || (() => {});
    this.onLeaderboard = onLeaderboard || (() => {});
    this.onSaveExit = onSaveExit || (() => {});
    this.onChatOpen = onChatOpen || (() => {});
    this.socket = socket || null;

    this.t = 0;
    this.holdingGift = !!player.held_gift_id;
    this.gifts = []; // { id, loc_x, loc_y } tile coords, ground gifts
    this.giftPollTimer = 0;
    this.localEmoji = null; // { emoji, t }
    this.localChat = null; // { text, t }

    this.remotePlayers = new Map(); // id -> { x, y, dir, name, prefix, emoji }

    this.pc = {
      x: (7.5) * TILE,
      y: (14.4) * TILE,
      w: 8,
      h: 8,
      speed: 46,
      dir: 'up',
      moving: false,
      bob: 0,
    };
    this.entryMessage = `You stand within the abbey walls, ${player.prefix} ${player.name}.`;
    this.messageTimer = 4;
    this.lastEmittedMove = 0;
  }

  enter() {
    this._refreshGifts();
    this._bindSocket();
    this._emitJoin();
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const emoji = EMOJI_KEYS[e.code];
      if (emoji) this._sendEmoji(emoji);
      if (e.code === 'KeyT') this.onChatOpen();
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  showChat(id, text) {
    if (id === 'local') {
      this.localChat = { text, t: 3.2 };
    } else {
      const existing = this.remotePlayers.get(id) || {};
      this.remotePlayers.set(id, { ...existing, chat: { text, t: 3.2 } });
    }
  }

  sendChat(text) {
    text = text.trim().slice(0, 120);
    if (!text) return;
    this.showChat('local', text);
    if (this.socket) this.socket.emit('chat', { text });
  }

  _bindSocket() {
    const s = this.socket;
    if (!s) return;
    this._onJoined = (p) => this.remotePlayers.set(p.id, p);
    this._onLeft = (p) => this.remotePlayers.delete(p.id);
    this._onMoved = (p) => {
      const existing = this.remotePlayers.get(p.id) || {};
      this.remotePlayers.set(p.id, { ...existing, ...p });
    };
    this._onEmoji = (p) => {
      const existing = this.remotePlayers.get(p.id) || {};
      this.remotePlayers.set(p.id, { ...existing, emoji: { emoji: p.emoji, t: 1.6 } });
    };
    this._onChatMsg = (p) => this.showChat(p.id, p.text);
    s.on('player_joined', this._onJoined);
    s.on('player_left', this._onLeft);
    s.on('player_moved', this._onMoved);
    s.on('emoji_show', this._onEmoji);
    s.on('chat_msg', this._onChatMsg);
  }

  _unbindSocket() {
    const s = this.socket;
    if (!s) return;
    s.off('player_joined', this._onJoined);
    s.off('player_left', this._onLeft);
    s.off('player_moved', this._onMoved);
    s.off('emoji_show', this._onEmoji);
    s.off('chat_msg', this._onChatMsg);
  }

  _sendEmoji(emoji) {
    this.localEmoji = { emoji, t: 1.6 };
    if (this.socket) this.socket.emit('emoji', { emoji });
  }

  _emitJoin() {
    if (!this.socket) return;
    this.socket.emit('join', {
      tokenId: getWalletId(),
      name: this.player.name,
      prefix: this.player.prefix,
      x: this.pc.x,
      y: this.pc.y,
    });
  }

  async _refreshGifts() {
    try {
      this.gifts = await api.giftsNearby();
    } catch {
      // non-fatal — ground gifts are cosmetic/optional
    }
  }

  _tryMove(dx, dy) {
    const p = this.pc;
    const nx = p.x + dx;
    const ny = p.y + dy;
    const half = p.w / 2;
    const corners = (x, y) => [
      [x - half, y - half], [x + half, y - half],
      [x - half, y + half], [x + half, y + half],
    ];
    const blockedX = corners(nx, p.y).some(([cx, cy]) => isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedX) p.x = nx;
    const blockedY = corners(p.x, ny).some(([cx, cy]) => isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedY) p.y = ny;
  }

  _nearestStation() {
    let best = null, bestD = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(this.pc.x - s.x, this.pc.y - s.y);
      if (d < s.r && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  _nearestGift() {
    let best = null, bestD = Infinity;
    for (const g of this.gifts) {
      const gx = px(g.loc_x), gy = px(g.loc_y);
      const d = Math.hypot(this.pc.x - gx, this.pc.y - gy);
      if (d < 12 && d < bestD) { best = g; bestD = d; }
    }
    return best;
  }

  async _handleDuty(id) {
    try {
      const res = await api.duty(id);
      if (res.alreadyDone) {
        this.onToast('Already done today.');
        return;
      }
      this.player[`${id}_today`] = 1;
      this.player.devotion += res.devotionGained;
      this.player.streak = res.streak;
      this.player.multiplier = res.multiplier;
      this.onPlayerUpdate(this.player);
      res.streakAdvanced ? sfx.streakBonus() : sfx.dutyComplete();
      this.onToast(
        res.streakAdvanced
          ? `+${res.devotionGained} Devotion — streak day ${res.streak} (${res.multiplier}x)`
          : `+${res.devotionGained} Devotion`
      );
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handleGuru() {
    if (!this.holdingGift) { this.onToast('You have nothing to offer the Guru.'); return; }
    try {
      const res = await api.giftGive({ toGuru: true });
      this.holdingGift = false;
      this.player.devotion += res.devotionGained;
      this.onPlayerUpdate(this.player);
      sfx.gift();
      this.onToast(`The Guru accepts your gift. +${res.devotionGained} Devotion`);
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handleConfession() {
    if (!this.player.needsConfession) { this.onToast('No confession needed.'); return; }
    try {
      const res = await api.confession();
      this.player.needsConfession = false;
      this.player.confessionCost = null;
      this.player.streak = res.restoredStreak;
      this.onPlayerUpdate(this.player);
      sfx.confession();
      this.onToast(`Confession accepted. Streak restored to ${res.restoredStreak}.`);
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handlePickup(gift) {
    try {
      await api.giftPickup(gift.id);
      this.holdingGift = true;
      this.gifts = this.gifts.filter((g) => g.id !== gift.id);
      if (this.socket) this.socket.emit('pickup_gift', { giftId: gift.id });
      sfx.gift();
      this.onToast('You pick up the gift.');
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handleDrop() {
    if (!this.holdingGift) return;
    try {
      await api.giftDrop(this.pc.x / TILE, this.pc.y / TILE);
      this.holdingGift = false;
      if (this.socket) this.socket.emit('drop_gift');
      this.onToast('You set the gift down.');
      this._refreshGifts();
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handleLeaderboard() {
    try {
      const rows = await api.leaderboard();
      this.onLeaderboard(rows);
    } catch (e) {
      this.onToast(e.message);
    }
  }

  async _handleSaveExit() {
    try {
      const res = await api.save();
      this.onToast(`Saved. ${res.devotion} Devotion secured.`);
      this.onSaveExit();
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  update(dt, input) {
    this.t += dt;
    if (this.messageTimer > 0) this.messageTimer -= dt;

    this.giftPollTimer += dt;
    if (this.giftPollTimer > GIFT_POLL_MS / 1000) {
      this.giftPollTimer = 0;
      this._refreshGifts();
    }

    const p = this.pc;
    let dx = 0, dy = 0;
    if (input.dirs.up) { dy -= 1; p.dir = 'up'; }
    if (input.dirs.down) { dy += 1; p.dir = 'down'; }
    if (input.dirs.left) { dx -= 1; p.dir = 'left'; }
    if (input.dirs.right) { dx += 1; p.dir = 'right'; }

    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) {
      const len = Math.hypot(dx, dy) || 1;
      this._tryMove((dx / len) * p.speed * dt, (dy / len) * p.speed * dt);
      p.bob += dt * 10;

      this.lastEmittedMove += dt;
      if (this.socket && this.lastEmittedMove > 0.08) {
        this.lastEmittedMove = 0;
        this.socket.emit('move', { x: p.x, y: p.y, dir: p.dir });
      }
    }

    this._activeStation = this._nearestStation();
    this._activeGift = this._nearestGift();

    if (input.consumeAPress()) {
      if (this._activeGift && !this.holdingGift) {
        this._handlePickup(this._activeGift);
      } else if (this._activeStation) {
        if (this._activeStation.kind === 'duty') this._handleDuty(this._activeStation.id);
        else if (this._activeStation.kind === 'guru') this._handleGuru();
        else if (this._activeStation.kind === 'confession') this._handleConfession();
        else if (this._activeStation.kind === 'leaderboard') this._handleLeaderboard();
      }
    }
    if (input.consumeBPress()) {
      if (this.holdingGift) this._handleDrop();
      else if (this._activeStation && this._activeStation.kind === 'gate') this._handleSaveExit();
    }

    if (this.localEmoji) {
      this.localEmoji.t -= dt;
      if (this.localEmoji.t <= 0) this.localEmoji = null;
    }
    if (this.localChat) {
      this.localChat.t -= dt;
      if (this.localChat.t <= 0) this.localChat = null;
    }
    for (const rp of this.remotePlayers.values()) {
      if (rp.emoji) {
        rp.emoji.t -= dt;
        if (rp.emoji.t <= 0) rp.emoji = null;
      }
      if (rp.chat) {
        rp.chat.t -= dt;
        if (rp.chat.t <= 0) rp.chat = null;
      }
    }
  }

  _drawFloor(ctx) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = MAP[r][c];
        const x = c * TILE, y = r * TILE;
        if (ch === '#') {
          ctx.fillStyle = '#2c2013';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x, y + TILE - 3, TILE, 3);
          ctx.strokeStyle = 'rgba(80,60,30,0.5)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else {
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#c9a35f' : '#bd9752';
          ctx.fillRect(x, y, TILE, TILE);
          if ((r * 7 + c * 13) % 11 === 0) {
            ctx.fillStyle = 'rgba(90,60,20,0.25)';
            ctx.fillRect(x + 3, y + 4, 2, 2);
          }
        }
      }
    }
    ctx.fillStyle = 'rgba(233, 196, 104, 0.18)';
    ctx.fillRect(7 * TILE, 15 * TILE, 2 * TILE, TILE);
  }

  _drawPillar(ctx, col, row) {
    const x = col * TILE, y = row * TILE;
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(x, y - TILE * 0.6, TILE, TILE * 1.6);
    ctx.fillStyle = '#6b552f';
    ctx.fillRect(x + 2, y - TILE * 0.6, 3, TILE * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
  }

  _drawFountain(ctx) {
    const x = 7 * TILE, y = 7 * TILE, s = TILE * 2;
    ctx.fillStyle = '#3a4a52';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#5b7580';
    ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    const shimmer = (Math.sin(this.t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(180, 220, 230, ${0.35 + shimmer * 0.35})`;
    ctx.fillRect(x + 5, y + 5, s - 10, s - 10);
  }

  _drawTorches(ctx) {
    for (const col of TORCH_COLS) {
      const x = col * TILE + TILE / 2;
      const y = 0.5 * TILE;
      const flick = 0.7 + Math.sin(this.t * 14 + col) * 0.15 + Math.random() * 0.08;
      ctx.fillStyle = '#3a2a18';
      ctx.fillRect(x - 2, y - 2, 4, 8);
      ctx.fillStyle = `rgba(255, ${Math.floor(140 + flick * 60)}, 60, 0.85)`;
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 3.5 * flick, 5.5 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 220, 140, 0.7)';
      ctx.beginPath();
      ctx.ellipse(x, y - 6, 1.5 * flick, 2.5 * flick, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawStations(ctx) {
    for (const s of STATIONS) {
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.id === 'pray') {
        ctx.fillStyle = '#5c4a2a';
        ctx.fillRect(-6, 2, 12, 4);
        ctx.fillStyle = this.player.pray_today ? '#8fe0c8' : '#e9c468';
        const glow = 0.6 + Math.sin(this.t * 4) * 0.25;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(0, -2, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (s.id === 'garden') {
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(-8, -3, 16, 8);
        const leafColor = this.player.garden_today ? '#7fd68a' : '#4f8b52';
        ctx.fillStyle = leafColor;
        for (let i = -6; i <= 6; i += 4) {
          ctx.beginPath();
          ctx.ellipse(i, -3 + Math.sin(this.t * 2 + i) * 0.6, 2, 3.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (s.id === 'candles') {
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(-2, -8, 4, 16);
        for (const off of [-6, 0, 6]) {
          const lit = this.player.candles_today;
          const flick = 0.7 + Math.sin(this.t * 12 + off) * 0.2;
          ctx.fillStyle = '#8a6a34';
          ctx.fillRect(off - 1, 4, 2, 4);
          ctx.fillStyle = lit ? `rgba(255,200,110,${flick})` : 'rgba(120,110,90,0.5)';
          ctx.beginPath();
          ctx.ellipse(off, 2, 1.4, 2.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (s.id === 'guru') {
        // stationary NPC in pale gold, taller than the player
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 7, 6, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        const sheet = getCultistSprite('guru-npc', '#e9dcae', '#a9821f');
        const scale = 1.3, sw = sheet.w * scale, sh = sheet.h * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet.down, -sw / 2, 7 - sh, sw, sh);
      } else if (s.id === 'confession') {
        ctx.fillStyle = '#241a12';
        ctx.fillRect(-7, -10, 14, 18);
        ctx.fillStyle = '#4a3a22';
        ctx.fillRect(-7, -10, 14, 3);
        ctx.fillStyle = this.player.needsConfession ? 'rgba(220,80,60,0.85)' : 'rgba(90,70,40,0.6)';
        ctx.beginPath();
        ctx.arc(0, -2, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.id === 'leaderboard') {
        ctx.fillStyle = '#4a3a22';
        ctx.fillRect(-5, 0, 10, 6);
        ctx.fillStyle = '#e9dcae';
        ctx.fillRect(-6, -6, 12, 8);
        ctx.strokeStyle = '#a9821f';
        ctx.lineWidth = 0.7;
        ctx.strokeRect(-6, -6, 12, 8);
        ctx.fillStyle = '#8a6a34';
        for (let i = -3; i <= 3; i += 3) ctx.fillRect(-4, i, 8, 1);
      }
      ctx.restore();
    }
  }

  _drawGifts(ctx) {
    for (const g of this.gifts) {
      const x = px(g.loc_x), y = px(g.loc_y);
      const bob = Math.sin(this.t * 3 + g.loc_x) * 1.2;
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.fillStyle = '#7a2f2f';
      ctx.fillRect(-4, -3, 8, 7);
      ctx.fillStyle = '#e9c468';
      ctx.fillRect(-4, -0.5, 8, 1.5);
      ctx.fillRect(-0.75, -3, 1.5, 7);
      ctx.restore();
    }
  }

  _drawRobedFigure(ctx, x, y, dir, moving, bob, seed, holdingGift, label, emoji, chat, robeBase) {
    const bobOffset = moving ? Math.sin(bob) * 1 : 0;
    const px_ = Math.round(x);
    const py_ = Math.round(y + bobOffset);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px_, py_ + 5, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const sheet = getCultistSprite(seed, robeBase);
    const sw = sheet.w, sh = sheet.h;
    const drawX = px_ - sw / 2, drawY = py_ + 6 - sh;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet[dir] || sheet.down, drawX, drawY, sw, sh);

    if (holdingGift) {
      ctx.fillStyle = '#7a2f2f';
      ctx.fillRect(px_ - 3, drawY - 6, 6, 5);
      ctx.fillStyle = '#e9c468';
      ctx.fillRect(px_ - 3, drawY - 4.5, 6, 1.2);
    }

    if (label) {
      ctx.font = '5px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(244,229,189,0.85)';
      ctx.fillText(label, px_, drawY - 3);
    }

    if (emoji) {
      ctx.save();
      const a = Math.min(1, emoji.t);
      const ey = drawY - 1 - (1.6 - emoji.t) * 4;
      ctx.globalAlpha = a * 0.5;
      const glow = ctx.createRadialGradient(px_, ey - 2, 0, px_, ey - 2, 7);
      glow.addColorStop(0, 'rgba(245, 215, 110, 0.9)');
      glow.addColorStop(1, 'rgba(245, 215, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px_ - 7, ey - 9, 14, 14);
      ctx.globalAlpha = a;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(emoji.emoji, px_, ey);
      ctx.restore();
    }

    if (chat) {
      this._drawSpeechBubble(ctx, px_, drawY - 6, chat.text, Math.min(1, chat.t));
    }
  }

  // Rounded, gold-bordered speech bubble with a small tail pointing at the
  // speaker's head — styling adapted from Club Nile's popup-panel look.
  _drawSpeechBubble(ctx, tipX, tipY, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '6px "Courier New", monospace';
    const padX = 4, padY = 3, tail = 3;
    const textW = ctx.measureText(text).width;
    const w = textW + padX * 2;
    const h = 6 + padY * 2;
    const bx = tipX - w / 2;
    const by = tipY - tail - h;
    const r = 2;

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, r);
    else ctx.rect(bx, by, w, h);
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#b98d3e';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX - tail, by + h);
    ctx.lineTo(tipX + tail, by + h);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#b98d3e';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // paint over the shared edge so the tail reads as part of the bubble
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fillRect(tipX - tail + 0.5, by + h - 1, tail * 2 - 1, 1.5);

    ctx.fillStyle = '#f5d76e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tipX, by + h / 2 + 0.5);
    ctx.restore();
  }

  render(ctx) {
    ctx.fillStyle = '#050301';
    ctx.fillRect(0, 0, W, H);

    this._drawFloor(ctx);
    this._drawFountain(ctx);
    this._drawStations(ctx);
    this._drawGifts(ctx);
    this._drawPillar(ctx, 1, 1);
    this._drawPillar(ctx, 14, 1);
    this._drawPillar(ctx, 1, 14);
    this._drawPillar(ctx, 14, 14);
    this._drawTorches(ctx);

    for (const [id, rp] of this.remotePlayers) {
      if (rp.x == null) continue;
      this._drawRobedFigure(ctx, rp.x, rp.y, rp.dir || 'down', false, 0, id, false, rp.name, rp.emoji, rp.chat);
    }

    this._drawRobedFigure(ctx, this.pc.x, this.pc.y, this.pc.dir, this.pc.moving, this.pc.bob, getWalletId(), this.holdingGift, null, this.localEmoji, this.localChat);

    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    if (this._activeGift && !this.holdingGift) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText('[A] Pick up gift', W / 2, H - 16);
    } else if (this._activeStation) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      const prefix = this._activeStation.kind === 'gate' ? '' : '[A] ';
      ctx.fillText(`${prefix}${this._activeStation.label}`, W / 2, H - 16);
    }

    if (this.messageTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.messageTimer);
      ctx.font = '7px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText(this.entryMessage, W / 2, H - 6);
      ctx.restore();
    }
  }

  exit() {
    this._unbindSocket();
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
  }
}
