// The abbey — first scene after boot + naming. A multi-room floor plan
// (church / garden / kitchen / dorms, see web/js/abbeyMap.js) rendered with
// plain canvas primitives and a camera that follows the player, wired to the
// real Fastify API (duties, gifts, confession) and Socket.io presence.

import { api, getWalletId } from '../api.js';
import { sfx } from '../sfx.js';
import { drawCharacter, getCultistSprite, getGuruSprite } from '../spritesheet.js';
import { TILE, COLS, ROWS, GRID, PROPS, tileAt, isSolid, h2 } from '../abbeyMap.js';

const W = 208, H = 208; // screen/canvas size (unchanged)
const MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
const GIFT_POLL_MS = 4000;

const px = (t) => t * TILE + TILE / 2;

const STATIONS = [
  { id: 'pray', kind: 'duty', label: 'Pray', x: px(8), y: px(3), r: 13 },
  { id: 'garden', kind: 'duty', label: 'Tend Garden', x: px(20), y: px(9), r: 12 },
  { id: 'candles', kind: 'duty', label: 'Light Candles', x: px(8), y: px(30), r: 13 },
  { id: 'guru', kind: 'guru', label: 'Offer to the Guru', x: px(23), y: px(18), r: 14 },
  { id: 'confession', kind: 'confession', label: 'Confess', x: px(4), y: px(17), r: 12 },
  { id: 'leaderboard', kind: 'leaderboard', label: 'View Leaderboard', x: px(33), y: px(9), r: 12 },
  { id: 'gate', kind: 'gate', label: 'Save & Exit [B]', x: px(8), y: px(35), r: 18 },
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
      x: px(8), y: px(36),
      w: 7, h: 7,
      speed: 46,
      dir: 'up',
      moving: false,
      bob: 0,
    };
    this.cam = { x: 0, y: 0 };
    this._updateCamera();

    this.entryMessage = `You stand within the abbey walls, ${player.prefix} ${player.name}.`;
    this.messageTimer = 4;
    this.lastEmittedMove = 0;
  }

  enter() {
    this.mySheet = getCultistSprite(getWalletId(), this.player.sex);
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

  _updateCamera() {
    this.cam.x = Math.max(0, Math.min(MAP_W - W, this.pc.x - W / 2));
    this.cam.y = Math.max(0, Math.min(MAP_H - H, this.pc.y - H / 2));
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
    this._updateCamera();

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

  _drawFloor(ctx, c0, r0, c1, r1) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(c, r);
        const x = c * TILE, y = r * TILE;
        const bhash = h2(c, r);
        if (ch === '#') {
          const shade = bhash % 5;
          ctx.fillStyle = shade === 0 ? '#44444c' : shade === 1 ? '#38383f' : '#3d3d45';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x, y, TILE, 1);
          ctx.fillStyle = 'rgba(0,0,0,0.30)';
          ctx.fillRect(x, y + TILE / 2 - 1, TILE, 1.2);
          ctx.fillRect(x, y + TILE - 2, TILE, 2);
          ctx.strokeStyle = 'rgba(20,20,24,0.6)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (ch === 'g') {
          ctx.fillStyle = (bhash % 3 === 0) ? '#3c5a30' : '#345028';
          ctx.fillRect(x, y, TILE, TILE);
          if (bhash % 5 === 0) { ctx.fillStyle = 'rgba(90,140,70,0.5)'; ctx.fillRect(x + 3, y + 3, 2, 2); }
        } else if (ch === 'k' || ch === 'd') {
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#7a5a38' : '#6e5030';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = 'rgba(40,26,12,0.4)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (ch === 'w') {
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#9a7a48' : '#8c6e40';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = 'rgba(40,26,12,0.35)';
          ctx.fillRect(x, y + 1, TILE, 0.8);
        } else if (ch === '~') {
          const shimmer = (Math.sin(this.t * 2 + c * 0.4 + r * 0.3) + 1) / 2;
          ctx.fillStyle = `rgb(${40 + shimmer * 20}, ${70 + shimmer * 30}, ${95 + shimmer * 35})`;
          ctx.fillRect(x, y, TILE, TILE);
        } else if (ch === '.') {
          const light = (r + c) % 2 === 0;
          ctx.fillStyle = light ? '#87878e' : '#7a7a81';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = 'rgba(35,35,40,0.55)';
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else {
          // exterior grass
          ctx.fillStyle = (bhash % 5 === 0) ? '#3d5a30' : (bhash % 7 === 0) ? '#182412' : '#2a4020';
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }
    // aisle carpet down the nave
    ctx.fillStyle = 'rgba(122, 30, 30, 0.55)';
    ctx.fillRect(px(8) - 2, 3 * TILE, 4, 30 * TILE);
  }

  _drawPillar(ctx, col, row) {
    const x = col * TILE, y = row * TILE;
    ctx.fillStyle = '#3d3d44';
    ctx.fillRect(x, y - TILE * 0.6, TILE, TILE * 1.6);
    ctx.fillStyle = '#57575f';
    ctx.fillRect(x + 2, y - TILE * 0.6, 3, TILE * 1.6);
    ctx.fillStyle = '#c9a13b';
    ctx.fillRect(x, y - TILE * 0.6, TILE, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
  }

  _drawLantern(ctx, col, row) {
    const x = col * TILE + TILE / 2, topY = row * TILE - TILE * 0.6;
    const flick = 0.75 + Math.sin(this.t * 9 + col * 3) * 0.15;
    ctx.fillStyle = '#2a2418';
    ctx.fillRect(x - 3, topY, 6, 2);
    ctx.fillStyle = `rgba(255, 200, 110, ${0.55 + flick * 0.25})`;
    ctx.fillRect(x - 2.3, topY + 2, 4.6, 5);
    ctx.fillStyle = '#2a2418';
    ctx.fillRect(x - 2.6, topY + 1.6, 0.7, 5.4);
    ctx.fillRect(x + 1.9, topY + 1.6, 0.7, 5.4);
    ctx.fillRect(x - 3, topY + 7, 6, 1.4);
    const glow = ctx.createRadialGradient(x, topY + 4, 1, x, topY + 4, 10);
    glow.addColorStop(0, `rgba(255, 190, 100, ${0.16 + flick * 0.08})`);
    glow.addColorStop(1, 'rgba(255, 190, 100, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 10, topY - 6, 20, 20);
  }

  _drawTorch(ctx, col, row) {
    const x = col * TILE + TILE / 2, y = row * TILE + 2;
    const flick = 0.7 + Math.sin(this.t * 14 + col) * 0.15;
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(x - 2, y - 2, 4, 8);
    ctx.fillStyle = `rgba(255, ${Math.floor(140 + flick * 60)}, 60, 0.85)`;
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 3.2 * flick, 5 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 220, 140, 0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 1.4 * flick, 2.2 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFountain(ctx, col, row) {
    const x = (col - 1) * TILE, y = (row - 1) * TILE, s = TILE * 3;
    ctx.fillStyle = '#3a4a52';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#5b7580';
    ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    const shimmer = (Math.sin(this.t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(180, 220, 230, ${0.35 + shimmer * 0.35})`;
    ctx.fillRect(x + 6, y + 6, s - 12, s - 12);
  }

  _drawProps(ctx) {
    for (const p of PROPS) {
      const x = p.col * TILE + TILE / 2, y = p.row * TILE + TILE / 2;
      switch (p.type) {
        case 'fountain': this._drawFountain(ctx, p.col, p.row); break;
        case 'fountain-block': break; // covered by the fountain draw above
        case 'pillar': this._drawPillar(ctx, p.col, p.row); this._drawLantern(ctx, p.col, p.row); break;
        case 'torch': this._drawTorch(ctx, p.col, p.row); break;
        case 'bench':
          ctx.fillStyle = '#5c4426';
          ctx.fillRect(x - 6, y - 2, 12, 4);
          ctx.fillStyle = '#3a2c18';
          ctx.fillRect(x - 5, y + 2, 1.5, 2);
          ctx.fillRect(x + 3.5, y + 2, 1.5, 2);
          break;
        case 'altar':
          ctx.fillStyle = '#3a2c18';
          ctx.fillRect(x - 7, y - 4, 14, 8);
          ctx.fillStyle = '#c9a13b';
          ctx.fillRect(x - 7, y - 4, 14, 1.5);
          ctx.fillStyle = `rgba(233,196,104,${0.5 + Math.sin(this.t * 2) * 0.25})`;
          ctx.beginPath(); ctx.arc(x, y - 6, 2.4, 0, Math.PI * 2); ctx.fill();
          break;
        case 'pew':
          ctx.fillStyle = '#4a3420';
          ctx.fillRect(x - 4, y - 3, 8, 6);
          ctx.fillStyle = '#5c4426';
          ctx.fillRect(x - 4, y - 3, 8, 1.5);
          break;
        case 'counter':
          ctx.fillStyle = '#6e4a28';
          ctx.fillRect(x - 5, y - 4, 10, 8);
          ctx.fillStyle = '#8a6238';
          ctx.fillRect(x - 5, y - 4, 10, 1.5);
          break;
        case 'stove':
          ctx.fillStyle = '#3a3a3e';
          ctx.fillRect(x - 5, y - 4, 10, 8);
          ctx.fillStyle = `rgba(255,120,60,${0.5 + Math.sin(this.t * 6) * 0.2})`;
          ctx.fillRect(x - 3, y - 2, 2.4, 2.4);
          ctx.fillRect(x + 0.6, y - 2, 2.4, 2.4);
          break;
        case 'bed':
          ctx.fillStyle = '#5c4426';
          ctx.fillRect(x - 5, y - 4, 10, 9);
          ctx.fillStyle = '#7a3a3a';
          ctx.fillRect(x - 4, y - 3, 8, 6);
          ctx.fillStyle = '#e9dcae';
          ctx.fillRect(x - 4, y - 3, 3, 2.4);
          break;
        case 'rock':
          ctx.fillStyle = '#5a5a58';
          ctx.beginPath(); ctx.ellipse(x, y, 3.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.4, 0.9, 0, 0, Math.PI * 2); ctx.fill();
          break;
        case 'bush':
          ctx.fillStyle = '#2f4a26';
          ctx.beginPath(); ctx.ellipse(x, y, 3.4, 2.8, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#3f6032';
          ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.6, 1.2, 0, 0, Math.PI * 2); ctx.fill();
          break;
      }
    }
  }

  _drawStations(ctx) {
    for (const s of STATIONS) {
      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.id === 'garden') {
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
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 7, 6, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        drawCharacter(ctx, {
          sheet: getGuruSprite(), dir: 'down', moving: false, animPhase: this.t,
          x: 0, groundY: 7, targetHeight: 32,
        });
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
      } else if (s.id === 'pray') {
        ctx.fillStyle = this.player.pray_today ? '#8fe0c8' : '#e9c468';
        const glow = 0.6 + Math.sin(this.t * 4) * 0.25;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(0, -10, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
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

  _drawRobedFigure(ctx, x, y, dir, moving, animPhase, sheet, holdingGift, label, emoji, chat, targetHeight = 30) {
    const px_ = Math.round(x);
    const py_ = Math.round(y);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px_, py_ + 5, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    const groundY = py_ + 6;
    const drawn = drawCharacter(ctx, { sheet, dir, moving, animPhase, x: px_, groundY, targetHeight });
    const drawY = drawn ? groundY - drawn.h : groundY - targetHeight;

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
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fillRect(tipX - tail + 0.5, by + h - 1, tail * 2 - 1, 1.5);

    ctx.fillStyle = '#f5d76e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tipX, by + h / 2 + 0.5);
    ctx.restore();
  }

  render(ctx) {
    ctx.fillStyle = '#0e1710';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

    const c0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1);
    const r0 = Math.max(0, Math.floor(this.cam.y / TILE) - 1);
    const c1 = Math.min(COLS - 1, Math.ceil((this.cam.x + W) / TILE) + 1);
    const r1 = Math.min(ROWS - 1, Math.ceil((this.cam.y + H) / TILE) + 1);

    this._drawFloor(ctx, c0, r0, c1, r1);
    this._drawProps(ctx);
    this._drawStations(ctx);
    this._drawGifts(ctx);

    for (const [id, rp] of this.remotePlayers) {
      if (rp.x == null) continue;
      const rpSheet = getCultistSprite(id, rp.prefix === 'Sister' ? 'female' : 'male');
      this._drawRobedFigure(ctx, rp.x, rp.y, rp.dir || 'down', false, this.t, rpSheet, false, rp.name, rp.emoji, rp.chat);
    }

    this._drawRobedFigure(ctx, this.pc.x, this.pc.y, this.pc.dir, this.pc.moving, this.pc.moving ? this.pc.bob : this.t, this.mySheet, this.holdingGift, null, this.localEmoji, this.localChat);

    ctx.restore();

    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
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
