// The abbey — first scene after boot + naming. A multi-room floor plan
// (church / garden / kitchen / dorms, see web/js/abbeyMap.js) rendered with
// plain canvas primitives and a camera that follows the player, wired to the
// real Fastify API (duties, gifts, confession) and Socket.io presence.

import { api, getWalletId } from '../api.js';
import { sfx } from '../sfx.js';
import { drawCharacter, getCultistSprite, getGuruSprite } from '../spritesheet.js';
import { TILE, COLS, ROWS, GRID, PROPS, tileAt, isSolid, h2, CATHEDRAL_ALCOVES } from '../abbeyMap.js';

const W = 208, H = 208; // screen/canvas size (unchanged)
const MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
const GIFT_POLL_MS = 4000;

const px = (t) => t * TILE + TILE / 2;

const STATIONS = [
  { id: 'pray', kind: 'duty', label: 'Pray', x: px(8), y: px(3), r: 13 },
  { id: 'garden', kind: 'duty', label: 'Tend Garden', x: px(20), y: px(9), r: 12 },
  { id: 'candles', kind: 'duty', label: 'Light Candles', x: px(8), y: px(30), r: 13 },
  { id: 'guru', kind: 'guru', label: 'Offer to the Abbot', x: px(23), y: px(18), r: 14 },
  { id: 'confession', kind: 'confession', label: 'Confess', x: px(4), y: px(17), r: 12 },
  { id: 'leaderboard', kind: 'leaderboard', label: 'View Leaderboard', x: px(33), y: px(9), r: 12 },
  { id: 'gate', kind: 'gate', label: 'Save & Exit [B]', x: px(8), y: px(35), r: 18 },
  { id: 'bulletin', kind: 'bulletin', label: 'Read the Bulletin', x: px(5), y: px(34), r: 12 },
  { id: 'soul-altar', kind: 'soul-altar', label: 'Approach the Soul Altar', x: px(36), y: px(4), r: 12 },
  { id: 'nursery', kind: 'nursery', label: 'Approach the Nursery', x: px(36), y: px(20), r: 12 },
  { id: 'mancala', kind: 'mancala', label: 'Sit at the Mancala Table', x: px(20), y: px(30), r: 12 },
  ...CATHEDRAL_ALCOVES.map((a) => ({
    id: a.id, kind: 'cathedral', roomId: a.id, label: 'Claim this Alcove',
    x: px(a.col), y: px(a.row), r: 10,
  })),
];
const EMOJI_KEYS = { Digit1: '🙏', Digit2: '✨', Digit3: '🕯️' };

export class CourtyardScene {
  constructor({ player, onPlayerUpdate, onToast, socket, onLeaderboard, onSaveExit, onChatOpen, onMancala, onFinalCommunion }) {
    this.player = player;
    this.onPlayerUpdate = onPlayerUpdate || (() => {});
    this.onToast = onToast || (() => {});
    this.onLeaderboard = onLeaderboard || (() => {});
    this.onSaveExit = onSaveExit || (() => {});
    this.onChatOpen = onChatOpen || (() => {});
    this.onMancala = onMancala || (() => {});
    this.onFinalCommunion = onFinalCommunion || (() => {});
    this.socket = socket || null;

    this.t = 0;
    this.holdingGift = !!player.held_gift_id;
    this.gifts = []; // { id, loc_x, loc_y } tile coords, ground gifts
    this.giftPollTimer = 0;
    this.localEmoji = null; // { emoji, t }
    this.localChat = null; // { text, t }
    this.seasonInfo = null; // { season, day, inBreak, daysUntilCommunion, isFinalCommunion }
    this.cathedralRooms = new Map(); // roomId -> { owner_id, owner_name }
    this.finalCommunionShown = false;

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
    this.footDust = []; // { x, y, t } fading dust puffs left by the player's steps
    this._dustTimer = 0;
    this.fireflies = this._initFireflies();
    this._updateCamera();

    this.entryMessage = `You stand within the abbey walls, ${player.prefix} ${player.name}.`;
    this.messageTimer = 4;
    this.lastEmittedMove = 0;
  }

  enter() {
    this.mySheet = getCultistSprite(getWalletId(), this.player.sex);
    this._refreshGifts();
    this._refreshSeason();
    this._refreshCathedral();
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
    this._onMancalaState = (state) => this.onMancala({ type: 'state', ...state });
    this._onMancalaEnd = (state) => this.onMancala({ type: 'end', ...state });
    this._onMancalaError = (data) => this.onToast(data.message);
    this._onMancalaFull = () => this.onToast('The table is full — wait for a seat.');
    s.on('player_joined', this._onJoined);
    s.on('player_left', this._onLeft);
    s.on('player_moved', this._onMoved);
    s.on('emoji_show', this._onEmoji);
    s.on('chat_msg', this._onChatMsg);
    s.on('mancala_state', this._onMancalaState);
    s.on('mancala_end', this._onMancalaEnd);
    s.on('mancala_error', this._onMancalaError);
    s.on('mancala_full', this._onMancalaFull);
  }

  _unbindSocket() {
    const s = this.socket;
    if (!s) return;
    s.off('player_joined', this._onJoined);
    s.off('player_left', this._onLeft);
    s.off('player_moved', this._onMoved);
    s.off('emoji_show', this._onEmoji);
    s.off('chat_msg', this._onChatMsg);
    s.off('mancala_state', this._onMancalaState);
    s.off('mancala_end', this._onMancalaEnd);
    s.off('mancala_error', this._onMancalaError);
    s.off('mancala_full', this._onMancalaFull);
  }

  _sendEmoji(emoji) {
    this.localEmoji = { emoji, t: 1.6 };
    if (this.socket) this.socket.emit('emoji', { emoji });
  }

  sendMancalaMove(pit) {
    if (this.socket) this.socket.emit('mancala_move', { pit });
  }

  leaveMancala() {
    if (this.socket) this.socket.emit('mancala_leave');
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

  async _refreshSeason() {
    try {
      this.seasonInfo = await api.season();
      if (this.seasonInfo.isFinalCommunion && !this.finalCommunionShown) {
        this.finalCommunionShown = true;
        this.onFinalCommunion(this.seasonInfo);
      }
    } catch {
      // non-fatal — the bulletin just won't have anything to say
    }
  }

  async _refreshCathedral() {
    try {
      const rooms = await api.cathedralList();
      this.cathedralRooms = new Map(rooms.map((r) => [r.id, r]));
    } catch {
      // non-fatal — alcoves just render unclaimed until this succeeds
    }
  }

  // Scatters a handful of fireflies across the open exterior grounds
  // (tiles the map generator left untouched — not inside any room, corridor,
  // or the river/dock band) for ambient nighttime atmosphere.
  _initFireflies() {
    const list = [];
    for (let i = 0; i < 60 && list.length < 16; i++) {
      const c = h2(i * 11, 41) % COLS;
      const r = h2(41, i * 11) % ROWS;
      if (tileAt(c, r) !== ' ') continue;
      list.push({ baseX: c * TILE + TILE / 2, baseY: r * TILE + TILE / 2, seed: i });
    }
    return list;
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

  // With a dt, eases toward the target instead of snapping — smooths out the
  // scroll as the player moves. Called with no dt (e.g. on spawn, or by
  // tests) to jump straight to the target.
  _updateCamera(dt) {
    const targetX = Math.max(0, Math.min(MAP_W - W, this.pc.x - W / 2));
    const targetY = Math.max(0, Math.min(MAP_H - H, this.pc.y - H / 2));
    if (dt == null) {
      this.cam.x = targetX;
      this.cam.y = targetY;
    } else {
      const k = 1 - Math.exp(-10 * dt);
      this.cam.x += (targetX - this.cam.x) * k;
      this.cam.y += (targetY - this.cam.y) * k;
    }
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
    if (!this.holdingGift) { this.onToast('You have nothing to offer the Abbot.'); return; }
    try {
      const res = await api.giftGive({ toGuru: true });
      this.holdingGift = false;
      this.player.devotion += res.devotionGained;
      this.onPlayerUpdate(this.player);
      sfx.gift();
      this.onToast(`The Abbot accepts your gift. +${res.devotionGained} Devotion`);
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

  async _handleBulletin() {
    await this._refreshSeason();
    const s = this.seasonInfo;
    if (!s) { this.onToast('The bulletin is unreadable.'); return; }
    if (s.inBreak) {
      this.onToast(`Season ${s.season} is between cycles. The abbey rests.`);
    } else if (s.isFinalCommunion) {
      this.onToast(`Season ${s.season}, Day ${s.day} — Final Communion is upon us.`);
    } else {
      this.onToast(`Season ${s.season}, Day ${s.day}/56 — ${s.daysUntilCommunion} days until Final Communion.`);
    }
  }

  async _handleCathedral(roomId) {
    const room = this.cathedralRooms.get(roomId);
    const myName = `${this.player.prefix} ${this.player.name}`;
    if (room && room.owner_id) {
      this.onToast(room.owner_name === myName ? 'This alcove is already yours.' : `Claimed by ${room.owner_name}.`);
      return;
    }
    try {
      const res = await api.cathedralClaim(roomId);
      this.cathedralRooms.set(roomId, res.room);
      sfx.dutyComplete();
      this.onToast('You claim this Cathedral Room as your own.');
    } catch (e) {
      this.onToast(e.message);
      this._refreshCathedral();
    }
  }

  _handleSoulAltar() {
    const season = this.seasonInfo?.season ?? 1;
    this.onToast(season >= 2
      ? 'The Soul Altar stirs, but binding is not yet consecrated.'
      : 'The Soul Altar lies dormant. It will awaken in Season 2.');
  }

  _handleNursery() {
    this.onToast('The Nursery is not yet consecrated. Bloodlines will be recognized in a future season.');
  }

  _handleMancala() {
    if (this.socket) this.socket.emit('mancala_sit');
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

      this._dustTimer += dt;
      if (this._dustTimer > 0.16) {
        this._dustTimer = 0;
        this.footDust.push({ x: p.x, y: p.y + 4, t: 0 });
      }

      this.lastEmittedMove += dt;
      if (this.socket && this.lastEmittedMove > 0.08) {
        this.lastEmittedMove = 0;
        this.socket.emit('move', { x: p.x, y: p.y, dir: p.dir });
      }
    }
    this._updateCamera(dt);

    for (let i = this.footDust.length - 1; i >= 0; i--) {
      this.footDust[i].t += dt;
      if (this.footDust[i].t > 0.5) this.footDust.splice(i, 1);
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
        else if (this._activeStation.kind === 'bulletin') this._handleBulletin();
        else if (this._activeStation.kind === 'cathedral') this._handleCathedral(this._activeStation.roomId);
        else if (this._activeStation.kind === 'soul-altar') this._handleSoulAltar();
        else if (this._activeStation.kind === 'nursery') this._handleNursery();
        else if (this._activeStation.kind === 'mancala') this._handleMancala();
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
          const shade = bhash % 3;
          ctx.fillStyle = shade === 0 ? '#8c8f92' : shade === 1 ? '#7e8184' : '#85888c';
          ctx.fillRect(x, y, TILE, TILE);
          // beveled block edges (bright top/left, dark bottom/right) for a
          // chunky, cartoon SNES-tile look instead of flat photographic shading
          ctx.fillStyle = 'rgba(228,230,228,0.4)';
          ctx.fillRect(x, y, TILE, 1.6);
          ctx.fillRect(x, y, 1.6, TILE);
          ctx.fillStyle = 'rgba(20,22,24,0.4)';
          ctx.fillRect(x, y + TILE - 1.8, TILE, 1.8);
          ctx.fillRect(x + TILE - 1.8, y, 1.8, TILE);
          ctx.strokeStyle = 'rgba(18,19,20,0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          // moss creeping onto wall tiles that border the garden
          const nearGarden = tileAt(c, r - 1) === 'g' || tileAt(c, r + 1) === 'g' ||
            tileAt(c - 1, r) === 'g' || tileAt(c + 1, r) === 'g';
          if (nearGarden && bhash % 3 !== 0) {
            ctx.fillStyle = 'rgba(70,150,60,0.35)';
            ctx.fillRect(x, y + TILE - 3, TILE, 3);
          }
        } else if (ch === 'g') {
          ctx.fillStyle = (bhash % 3 === 0) ? '#3c5a30' : '#345028';
          ctx.fillRect(x, y, TILE, TILE);
          if (bhash % 5 === 0) { ctx.fillStyle = 'rgba(90,140,70,0.5)'; ctx.fillRect(x + 3, y + 3, 2, 2); }
          if (bhash % 13 === 0) { ctx.fillStyle = 'rgba(60,45,25,0.25)'; ctx.fillRect(x + 2, y + 5, 4, 2); }
          if (bhash % 4 === 0) {
            const sway = Math.sin(this.t * 2 + bhash) * 0.8;
            ctx.strokeStyle = 'rgba(110,160,90,0.5)';
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(x + 3, y + TILE - 1);
            ctx.lineTo(x + 3 + sway, y + TILE - 5);
            ctx.moveTo(x + 7, y + TILE - 1);
            ctx.lineTo(x + 7 + sway * 0.7, y + TILE - 4);
            ctx.stroke();
          }
        } else if (ch === 'k' || ch === 'd') {
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#a87840' : '#9a6c38';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(255,220,160,0.4)';
          ctx.fillRect(x, y, TILE, 1.4);
          ctx.fillStyle = 'rgba(60,36,14,0.4)';
          ctx.fillRect(x, y + TILE - 1.5, TILE, 1.5);
          ctx.strokeStyle = 'rgba(48,28,10,0.7)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (ch === 'w') {
          ctx.fillStyle = ((r + c) % 2 === 0) ? '#c99a54' : '#bb8c48';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = 'rgba(255,230,180,0.4)';
          ctx.fillRect(x, y, TILE, 1.3);
          ctx.fillStyle = 'rgba(60,36,14,0.35)';
          ctx.fillRect(x, y + TILE - 1.4, TILE, 1.4);
          ctx.strokeStyle = 'rgba(58,36,14,0.55)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else if (ch === '~') {
          const shimmer = (Math.sin(this.t * 2 + c * 0.4 + r * 0.3) + 1) / 2;
          ctx.fillStyle = `rgb(${40 + shimmer * 20}, ${70 + shimmer * 30}, ${95 + shimmer * 35})`;
          ctx.fillRect(x, y, TILE, TILE);
        } else if (ch === '.') {
          const light = (r + c) % 2 === 0;
          ctx.fillStyle = light ? '#a3a196' : '#939186';
          ctx.fillRect(x, y, TILE, TILE);
          // beveled limestone flagstone: bright top/left, dark bottom/right,
          // bold grout outline -- flat, saturated, cartoon-tile look, cool
          // grey stone (English abbey flagstone, not desert sandstone)
          ctx.fillStyle = 'rgba(224,224,216,0.5)';
          ctx.fillRect(x, y, TILE, 1.5);
          ctx.fillRect(x, y, 1.5, TILE);
          ctx.fillStyle = 'rgba(38,36,32,0.4)';
          ctx.fillRect(x, y + TILE - 1.6, TILE, 1.6);
          ctx.fillRect(x + TILE - 1.6, y, 1.6, TILE);
          ctx.strokeStyle = 'rgba(32,31,28,0.75)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          // worn, lighter stone either side of the aisle carpet from foot traffic
          if (c === 7 || c === 9) {
            ctx.fillStyle = 'rgba(230,228,218,0.12)';
            ctx.fillRect(x, y, TILE, TILE);
          }
        } else {
          // exterior grass
          ctx.fillStyle = (bhash % 5 === 0) ? '#3d5a30' : (bhash % 7 === 0) ? '#182412' : '#2a4020';
          ctx.fillRect(x, y, TILE, TILE);
          if (bhash % 6 === 0) {
            const sway = Math.sin(this.t * 1.8 + bhash) * 0.7;
            ctx.strokeStyle = 'rgba(90,130,70,0.35)';
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(x + 4, y + TILE - 1);
            ctx.lineTo(x + 4 + sway, y + TILE - 4);
            ctx.stroke();
          }
        }
      }
    }
    // aisle carpet down the nave
    ctx.fillStyle = 'rgba(122, 30, 30, 0.55)';
    ctx.fillRect(px(8) - 2, 3 * TILE, 4, 30 * TILE);
  }

  // Soft ellipse shadow, offset down-right to imply one consistent light
  // angle (upper-left) across every solid prop in the abbey.
  _dropShadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x + 1.3, y + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPillar(ctx, col, row) {
    const x = col * TILE, y = row * TILE;
    this._dropShadow(ctx, x + TILE / 2, y + TILE - 1, 5.5, 2.2);
    ctx.fillStyle = '#3d3d44';
    ctx.fillRect(x, y - TILE * 0.6, TILE, TILE * 1.6);
    ctx.fillStyle = '#57575f';
    ctx.fillRect(x + 2, y - TILE * 0.6, 3, TILE * 1.6);
    ctx.fillStyle = '#c9a13b';
    ctx.fillRect(x, y - TILE * 0.6, TILE, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y + TILE - 4, TILE, 4);
  }

  // Slow-drifting dust motes rising through a light source's glow.
  _drawDustMotes(ctx, x, y, seed) {
    for (let i = 0; i < 2; i++) {
      const phase = (this.t * 0.25 + seed * 0.37 + i * 0.5) % 1;
      const mx = x + Math.sin(this.t * 0.8 + seed + i) * 3;
      const my = y - phase * 11;
      const a = Math.sin(phase * Math.PI) * 0.35;
      ctx.fillStyle = `rgba(255,225,180,${a})`;
      ctx.beginPath(); ctx.arc(mx, my, 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawLantern(ctx, col, row) {
    const x = col * TILE + TILE / 2, topY = row * TILE - TILE * 0.6;
    const flick = 0.75 + Math.sin(this.t * 9 + col * 2.7 + row * 1.4) * 0.15;
    // light pool on the floor beneath the lantern
    const poolY = row * TILE + TILE * 0.6;
    const pool = ctx.createRadialGradient(x, poolY, 1, x, poolY, 13);
    pool.addColorStop(0, `rgba(255, 195, 110, ${0.14 + flick * 0.08})`);
    pool.addColorStop(1, 'rgba(255, 195, 110, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(x - 13, poolY - 13, 26, 26);
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
    this._drawDustMotes(ctx, x, topY + 4, col * 3 + row);
  }

  _drawTorch(ctx, col, row) {
    const x = col * TILE + TILE / 2, y = row * TILE + 2;
    const flick = 0.7 + Math.sin(this.t * 14 + col * 2.3 + row * 1.7) * 0.15;
    const pool = ctx.createRadialGradient(x, y + 3, 1, x, y + 3, 11);
    pool.addColorStop(0, `rgba(255, 170, 80, ${0.13 + flick * 0.07})`);
    pool.addColorStop(1, 'rgba(255, 170, 80, 0)');
    ctx.fillStyle = pool;
    ctx.fillRect(x - 11, y - 8, 22, 22);
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
    this._drawDustMotes(ctx, x, y - 6, col * 3 + row);
  }

  _drawFountain(ctx, col, row) {
    const x = (col - 1) * TILE, y = (row - 1) * TILE, s = TILE * 3;
    const cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2;
    this._dropShadow(ctx, cx, y + s - 2, s / 2 - 1, 3);
    ctx.fillStyle = '#3a4a52';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#5b7580';
    ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    const shimmer = (Math.sin(this.t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(180, 220, 230, ${0.35 + shimmer * 0.35})`;
    ctx.fillRect(x + 6, y + 6, s - 12, s - 12);
    // ripple rings expanding out from center and fading
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 0.6 + i / 3) % 1;
      const r = phase * (s / 2 - 4);
      ctx.strokeStyle = `rgba(220, 240, 245, ${(1 - phase) * 0.35})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // an occasional sparkle catching the light
    const sparkPhase = (this.t * 1.3) % 1;
    if (sparkPhase < 0.5) {
      const sa = (h2(Math.floor(this.t * 2), 5) / 97) * Math.PI * 2;
      const sx = cx + Math.cos(sa) * (s / 2 - 5);
      const sy = cy + Math.sin(sa) * (s / 2 - 5) * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${(0.5 - sparkPhase) * 1.6})`;
      ctx.beginPath(); ctx.arc(sx, sy, 1, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawProp(ctx, p) {
    const x = p.col * TILE + TILE / 2, y = p.row * TILE + TILE / 2;
    switch (p.type) {
      case 'fountain': this._drawFountain(ctx, p.col, p.row); break;
      case 'fountain-block': break; // covered by the fountain draw above
      case 'pillar': this._drawPillar(ctx, p.col, p.row); this._drawLantern(ctx, p.col, p.row); break;
      case 'torch': this._drawTorch(ctx, p.col, p.row); break;
      case 'bench':
        this._dropShadow(ctx, x, y + 3, 7, 2.2);
        ctx.fillStyle = '#5c4426';
        ctx.fillRect(x - 6, y - 2, 12, 4);
        ctx.fillStyle = '#6e5230';
        ctx.fillRect(x - 6, y - 2, 12, 1.2);
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(x - 5, y + 2, 1.5, 2);
        ctx.fillRect(x + 3.5, y + 2, 1.5, 2);
        break;
      case 'altar': {
        this._dropShadow(ctx, x, y + 5, 8, 2.6);
        const glowA = 0.5 + Math.sin(this.t * 2) * 0.25;
        const pool = ctx.createRadialGradient(x, y - 4, 1, x, y - 4, 12);
        pool.addColorStop(0, `rgba(233,196,104,${0.18 + glowA * 0.08})`);
        pool.addColorStop(1, 'rgba(233,196,104,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 12, y - 16, 24, 24);
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(x - 7, y - 4, 14, 8);
        ctx.fillStyle = '#c9a13b';
        ctx.fillRect(x - 7, y - 4, 14, 1.5);
        ctx.fillStyle = `rgba(233,196,104,${glowA})`;
        ctx.beginPath(); ctx.arc(x, y - 6, 2.4, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 2; i++) {
          const phase = (this.t * 0.2 + i * 0.5) % 1;
          const sx = x + Math.sin(this.t * 0.6 + i * 2) * (2 + phase * 3);
          const sy = y - 6 - phase * 14;
          const sa = Math.sin(phase * Math.PI) * 0.22;
          ctx.fillStyle = `rgba(220,215,200,${sa})`;
          ctx.beginPath(); ctx.arc(sx, sy, 1 + phase * 1.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pew':
        this._dropShadow(ctx, x, y + 2, 5, 1.8);
        ctx.fillStyle = '#4a3420';
        ctx.fillRect(x - 4, y - 3, 8, 6);
        ctx.fillStyle = '#5c4426';
        ctx.fillRect(x - 4, y - 3, 8, 1.5);
        break;
      case 'counter':
        this._dropShadow(ctx, x, y + 3, 6, 2);
        ctx.fillStyle = '#6e4a28';
        ctx.fillRect(x - 5, y - 4, 10, 8);
        ctx.fillStyle = '#8a6238';
        ctx.fillRect(x - 5, y - 4, 10, 1.5);
        break;
      case 'stove': {
        this._dropShadow(ctx, x, y + 3, 6, 2);
        const flick = 0.5 + Math.sin(this.t * 6) * 0.2;
        const pool = ctx.createRadialGradient(x, y, 1, x, y, 10);
        pool.addColorStop(0, `rgba(255,120,60,${0.12 + flick * 0.06})`);
        pool.addColorStop(1, 'rgba(255,120,60,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.fillStyle = '#3a3a3e';
        ctx.fillRect(x - 5, y - 4, 10, 8);
        ctx.fillStyle = `rgba(255,120,60,${flick})`;
        ctx.fillRect(x - 3, y - 2, 2.4, 2.4);
        ctx.fillRect(x + 0.6, y - 2, 2.4, 2.4);
        break;
      }
      case 'bed':
        this._dropShadow(ctx, x, y + 4, 6, 2.2);
        ctx.fillStyle = '#5c4426';
        ctx.fillRect(x - 5, y - 4, 10, 9);
        ctx.fillStyle = '#7a3a3a';
        ctx.fillRect(x - 4, y - 3, 8, 6);
        ctx.fillStyle = '#e9dcae';
        ctx.fillRect(x - 4, y - 3, 3, 2.4);
        break;
      case 'rock':
        this._dropShadow(ctx, x, y + 1, 4, 1.6);
        ctx.fillStyle = '#5a5a58';
        ctx.beginPath(); ctx.ellipse(x, y, 3.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.4, 0.9, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bush':
        this._dropShadow(ctx, x, y + 1.5, 3.8, 1.6);
        ctx.fillStyle = '#2f4a26';
        ctx.beginPath(); ctx.ellipse(x, y, 3.4, 2.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f6032';
        ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.6, 1.2, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bulletin':
        this._dropShadow(ctx, x, y + 5, 6, 2);
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(x - 6, y - 9, 12, 14);
        ctx.fillStyle = '#e9dcae';
        ctx.fillRect(x - 5, y - 8, 10, 11);
        ctx.strokeStyle = '#a9821f';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x - 5, y - 8, 10, 11);
        ctx.fillStyle = '#8a6a34';
        for (let i = -5; i <= 3; i += 3) ctx.fillRect(x - 3, y - 6 + i, 6, 1);
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(x - 1, y + 5, 2, 4);
        break;
      case 'cathedral-alcove': {
        const room = this.cathedralRooms.get(p.roomId);
        const owned = !!(room && room.owner_id);
        this._dropShadow(ctx, x, y + 4, 6, 2);
        ctx.fillStyle = owned ? '#3a2c48' : '#2a2420';
        ctx.fillRect(x - 6, y - 10, 12, 15);
        ctx.fillStyle = owned ? '#7a5aa8' : '#4a4038';
        ctx.fillRect(x - 5, y - 9, 10, 12);
        ctx.fillStyle = owned ? '#c9a13b' : 'rgba(160,150,130,0.4)';
        ctx.fillRect(x - 5, y - 9, 10, 1.5);
        if (owned) {
          ctx.font = '3.4px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#e9dcae';
          const shortName = room.owner_name.split(' ').slice(-1)[0];
          ctx.fillText(shortName.slice(0, 8), x, y - 2);
        }
        break;
      }
      case 'soul-altar': {
        const active = (this.seasonInfo?.season ?? 1) >= 2;
        this._dropShadow(ctx, x, y + 5, 7, 2.4);
        ctx.fillStyle = '#241a30';
        ctx.fillRect(x - 6, y - 3, 12, 7);
        const glowA = active ? 0.5 + Math.sin(this.t * 2.4) * 0.3 : 0.12;
        ctx.fillStyle = `rgba(150,110,220,${glowA})`;
        ctx.beginPath(); ctx.arc(x, y - 5, 2.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'nursery':
        this._dropShadow(ctx, x, y + 4, 6, 2);
        ctx.fillStyle = '#3a4a30';
        ctx.fillRect(x - 5, y - 4, 10, 8);
        ctx.fillStyle = 'rgba(150,200,140,0.4)';
        ctx.beginPath(); ctx.ellipse(x, y - 4, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'mancala-table':
        this._dropShadow(ctx, x, y + 4, 9, 3);
        ctx.fillStyle = '#5c4426';
        ctx.fillRect(x - 9, y - 3, 18, 7);
        ctx.fillStyle = '#3a2c18';
        for (let i = -6; i <= 6; i += 3) {
          ctx.beginPath(); ctx.arc(x + i, y, 1.4, 0, Math.PI * 2); ctx.fill();
        }
        break;
    }
  }

  _drawStation(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.id === 'garden') {
      this._dropShadow(ctx, 0, 5, 9, 2.4);
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
      this._dropShadow(ctx, 0, 7, 3, 1.6);
      ctx.fillStyle = '#3a2c18';
      ctx.fillRect(-2, -8, 4, 16);
      for (const off of [-6, 0, 6]) {
        const lit = this.player.candles_today;
        const flick = 0.7 + Math.sin(this.t * 12 + off) * 0.2;
        if (lit) {
          const pool = ctx.createRadialGradient(off, 3, 0.5, off, 3, 7);
          pool.addColorStop(0, `rgba(255,200,110,${0.15 + flick * 0.08})`);
          pool.addColorStop(1, 'rgba(255,200,110,0)');
          ctx.fillStyle = pool;
          ctx.fillRect(off - 7, -4, 14, 14);
        }
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
        x: 0, groundY: 7, targetHeight: 22.4,
      });
    } else if (s.id === 'confession') {
      this._dropShadow(ctx, 0, 9, 8, 2.4);
      ctx.fillStyle = '#241a12';
      ctx.fillRect(-7, -10, 14, 18);
      ctx.fillStyle = '#4a3a22';
      ctx.fillRect(-7, -10, 14, 3);
      ctx.fillStyle = this.player.needsConfession ? 'rgba(220,80,60,0.85)' : 'rgba(90,70,40,0.6)';
      ctx.beginPath();
      ctx.arc(0, -2, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.id === 'leaderboard') {
      this._dropShadow(ctx, 0, 6, 7, 2);
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

  _drawGift(ctx, g) {
    const x = px(g.loc_x), y = px(g.loc_y);
    const bob = Math.sin(this.t * 3 + g.loc_x) * 1.2;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 4, 4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a2f2f';
    ctx.fillRect(-4, -3, 8, 7);
    ctx.fillStyle = '#e9c468';
    ctx.fillRect(-4, -0.5, 8, 1.5);
    ctx.fillRect(-0.75, -3, 1.5, 7);
    ctx.restore();
  }

  // A glow that grows with the player's current Devotion streak tier
  // (7/14/21/28-day multiplier thresholds from the GDD), so the streak
  // system is visible on the character, not just a HUD number.
  _streakAura() {
    const streak = this.player.streak || 0;
    if (streak < 7) return null;
    const tier = streak >= 28 ? 4 : streak >= 21 ? 3 : streak >= 14 ? 2 : 1;
    const radii = [0, 11, 13, 16, 19];
    const pulse = 0.6 + Math.sin(this.t * 3) * 0.25;
    return { radius: radii[tier], alpha: (0.28 + tier * 0.06) * pulse, tier };
  }

  _drawLocalPlayer(ctx) {
    for (const d of this.footDust) {
      const a = 1 - d.t / 0.5;
      const r = 1.5 + d.t * 3;
      ctx.fillStyle = `rgba(200,190,160,${a * 0.3})`;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    this._drawRobedFigure(
      ctx, this.pc.x, this.pc.y, this.pc.dir, this.pc.moving,
      this.pc.moving ? this.pc.bob : this.t, this.mySheet, this.holdingGift,
      null, this.localEmoji, this.localChat, undefined, this._streakAura()
    );
  }

  _drawRemotePlayer(ctx, id, rp) {
    const rpSheet = getCultistSprite(id, rp.prefix === 'Sister' ? 'female' : 'male');
    this._drawRobedFigure(ctx, rp.x, rp.y, rp.dir || 'down', false, this.t, rpSheet, false, rp.name, rp.emoji, rp.chat);
  }

  // Collects every prop, station, gift, and character into one list and
  // sorts by ground (y) position so a player standing "in front of" a
  // pillar/pew/bed draws over it, and one standing "behind" it is hidden —
  // a simple top-down painter's-algorithm depth sort.
  _collectDrawables(ctx) {
    const items = [];
    for (const p of PROPS) {
      if (p.type === 'fountain-block') continue;
      items.push({ y: p.row * TILE + TILE, draw: () => this._drawProp(ctx, p) });
    }
    for (const s of STATIONS) {
      items.push({ y: s.y + 6, draw: () => this._drawStation(ctx, s) });
    }
    for (const g of this.gifts) {
      items.push({ y: px(g.loc_y), draw: () => this._drawGift(ctx, g) });
    }
    for (const [id, rp] of this.remotePlayers) {
      if (rp.x == null) continue;
      items.push({ y: rp.y, draw: () => this._drawRemotePlayer(ctx, id, rp) });
    }
    items.push({ y: this.pc.y, draw: () => this._drawLocalPlayer(ctx) });
    items.sort((a, b) => a.y - b.y);
    return items;
  }

  // Ambient fireflies wandering slowly over the open exterior grounds.
  _drawFireflies(ctx) {
    for (const f of this.fireflies) {
      const x = f.baseX + Math.sin(this.t * 0.6 + f.seed) * 8;
      const y = f.baseY + Math.cos(this.t * 0.5 + f.seed * 1.3) * 6;
      const a = Math.max(0, 0.4 + Math.sin(this.t * 3 + f.seed * 2) * 0.45);
      if (a <= 0.01) continue;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 4);
      glow.addColorStop(0, `rgba(230,255,160,${a})`);
      glow.addColorStop(0.4, `rgba(220,255,150,${a * 0.5})`);
      glow.addColorStop(1, 'rgba(220,255,150,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = `rgba(255,255,220,${Math.min(1, a * 1.5)})`;
      ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }

  // A faint per-room color wash, keyed off the tile the player is standing
  // on, so each room reads with its own atmosphere (warm stone in the nave,
  // cool green in the garden, hearth-orange in the kitchen, blue at the
  // river) instead of one flat vignette everywhere.
  _roomTint() {
    const ch = tileAt(Math.floor(this.pc.x / TILE), Math.floor(this.pc.y / TILE));
    switch (ch) {
      case '.': return 'rgba(120, 80, 30, 0.045)';
      case 'g': return 'rgba(60, 140, 80, 0.05)';
      case 'k': return 'rgba(220, 110, 40, 0.05)';
      case 'd': return 'rgba(120, 90, 150, 0.04)';
      case 'w': return 'rgba(80, 130, 160, 0.06)';
      case '~': return 'rgba(50, 90, 140, 0.08)';
      case '#': return 'rgba(90, 70, 40, 0.05)';
      default: return 'rgba(40, 70, 30, 0.04)';
    }
  }

  _drawRobedFigure(ctx, x, y, dir, moving, animPhase, sheet, holdingGift, label, emoji, chat, targetHeight = 21, aura = null) {
    const px_ = Math.round(x);
    const py_ = Math.round(y);

    if (aura) {
      const glow = ctx.createRadialGradient(px_, py_, 1, px_, py_, aura.radius);
      glow.addColorStop(0, `rgba(233,196,104,${aura.alpha})`);
      glow.addColorStop(1, 'rgba(233,196,104,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px_ - aura.radius, py_ - aura.radius, aura.radius * 2, aura.radius * 2);
      if (aura.tier >= 4) {
        for (let i = 0; i < 3; i++) {
          const ang = this.t * 2 + (i * Math.PI * 2) / 3;
          const mx = px_ + Math.cos(ang) * (aura.radius - 3);
          const my = py_ + Math.sin(ang) * (aura.radius - 3) * 0.6;
          ctx.fillStyle = 'rgba(255,235,170,0.85)';
          ctx.beginPath(); ctx.arc(mx, my, 0.9, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

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
    for (const item of this._collectDrawables(ctx)) item.draw();
    this._drawFireflies(ctx);

    ctx.restore();

    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = this._roomTint();
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    const promptBounce = Math.sin(this.t * 6) * 1.2;
    if (this._activeGift && !this.holdingGift) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText('[A] Pick up gift', W / 2, H - 16 + promptBounce);
    } else if (this._activeStation) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      const prefix = this._activeStation.kind === 'gate' ? '' : '[A] ';
      ctx.fillText(`${prefix}${this._activeStation.label}`, W / 2, H - 16 + promptBounce);
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
