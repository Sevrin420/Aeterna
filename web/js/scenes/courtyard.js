// The abbey — first scene after boot + naming. A multi-room floor plan
// (church / garden / kitchen / dorms, see web/js/abbeyMap.js) rendered with
// plain canvas primitives and a camera that follows the player, wired to the
// real Fastify API (duties, gifts, confession) and Socket.io presence.

import { api, getWalletId } from '../api.js';
import { sfx } from '../sfx.js';
import { drawCharacter, getCultistSprite, getGuruSprite, getCultistSpriteVariant } from '../spritesheet.js';
import { rollCultTraits, drawRegaliaBack, drawRegaliaFront } from '../cultLook.js';
import {
  TILE, COLS, ROWS, GRID, PROPS, tileAt, isSolid, h2, CATHEDRAL_ALCOVES, STAIRS,
  ALCOVES, DOORS, ROOMS, SKULL_ROOM, NAVE, TRANSEPT, NAVE_CX, SKULL_WALL_ROW,
} from '../abbeyMap.js';

const W = 208, H = 208; // logical screen size (canvas backing store is RES x this)
const RES = 2;          // must match the 2x transform main.js sets each frame
const MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
const GIFT_POLL_MS = 4000;
const DIRS = ['down', 'up', 'left', 'right']; // decode of the server's DIR_CODE
const PEER_STALE_MS = 700;    // drop a peer not seen in a snapshot this long
const INTERP_TIME = 0.1;      // seconds to ease a peer to its latest target (~tick rate)

const px = (t) => t * TILE + TILE / 2;

// One clean, calm grass surface used everywhere outdoors. Two close medium
// greens picked per ~2x2 clump (not per tile) so it reads as soft grass, not a
// noisy checker; a rare single blade for a touch of life. No near-black
// splotches or competing shades — keeps the palette simple.
function drawGrass(ctx, x, y, c, r) {
  const clump = h2(c >> 1, r >> 1) % 2;
  ctx.fillStyle = clump === 0 ? '#5f8c4c' : '#57853f';
  ctx.fillRect(x, y, TILE, TILE);
  if (h2(c, r) % 12 === 0) {
    ctx.fillStyle = 'rgba(122,168,96,0.35)';
    ctx.fillRect(x + 4, y + TILE - 5, 1, 4);
  }
}

const STATIONS = [
  // church nave + transept
  { id: 'pray', kind: 'duty', label: 'Kneel & Pray', x: px(NAVE_CX), y: px(13), r: 13 },
  { id: 'guru', kind: 'guru', label: 'Offer to the Abbot', x: px(NAVE_CX), y: px(11), r: 13 },
  { id: 'confession', kind: 'confession', label: 'Confess', x: px(TRANSEPT.x0 + 3), y: px(58), r: 13 },
  { id: 'leaderboard', kind: 'leaderboard', label: 'View the Devout', x: px(TRANSEPT.x1 - 3), y: px(58), r: 13 },
  { id: 'gate', kind: 'gate', label: 'Save & Exit', x: px(NAVE_CX), y: px(75), r: 14 },
  { id: 'bulletin', kind: 'bulletin', label: 'Read the Bulletin', x: px(NAVE.x0 + 1), y: px(11), r: 12 },
  // east skull chamber — the daily chant (was "tend the ossuary")
  { id: 'garden', kind: 'chant', label: 'Chant to the Skulls', x: px(Math.round((SKULL_ROOM.x0 + SKULL_ROOM.x1) / 2)), y: px(SKULL_WALL_ROW + 3), r: 14 },
  { id: 'nursery', kind: 'nursery', label: 'Approach the Cradle', x: px(ROOMS[0].x0 + 3), y: px(ROOMS[0].y0 + 3), r: 12 },
  { id: 'soul-altar', kind: 'soul-altar', label: 'Approach the Soul Altar', x: px(SKULL_ROOM.x0 + 4), y: px(SKULL_ROOM.y1 - 2), r: 12 },
  { id: 'mancala', kind: 'mancala', label: 'Sit at the Mancala Table', x: px(SKULL_ROOM.x1 - 4), y: px(SKULL_ROOM.y1 - 2), r: 12 },
  // the fire-shrine duty: light any brazier down the nave (was "light candles")
  ...ALCOVES.map((a, i) => ({
    id: 'candles', kind: 'fire', label: 'Light the Brazier', alcove: i,
    x: px(a.brazier.col), y: px(a.brazier.row), r: 14,
  })),
];
const EMOJI_KEYS = { Digit1: '🙏', Digit2: '✨', Digit3: '🕯️' };

export class CourtyardScene {
  constructor({ player, onPlayerUpdate, onToast, socket, onLeaderboard, onSaveExit, onChatOpen, onMancala, onFinalCommunion, crowd }) {
    this.player = player;
    this.crowd = this._spawnCrowd(crowd || 0); // demo NPC cultists wandering the sanctuary
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

    // Keyed by network id (uint16 assigned by the server). Each entry carries
    // the peer's identity (id=tokenId, name, prefix), its latest server target
    // (tx,ty,dir), the interpolated render position (rx,ry), a lastSnap
    // timestamp for staleness eviction, plus transient emoji/chat bubbles.
    this.remotePlayers = new Map();
    this.myNet = 0;

    // fire-alcove braziers that have been lit (keyed "col,row"), the openable
    // room doors (keyed "col,row" -> open?), and the running skull chant.
    this.litBraziers = new Set();
    this.doors = new Map(DOORS.map((d) => [`${d.col},${d.row}`, false])); // closed
    this._fireStep = 0;   // 0 = need wood, 1 = wood laid (need torch)
    this._chant = null;   // { n, line, t } while chanting

    this.pc = {
      x: px(NAVE_CX), y: px(74), // just inside the door, at the foot of the cross
      w: 7, h: 7,
      speed: 60, // +30% walk speed (was 46)
      dir: 'up',
      moving: false,
      bob: 0,
    };
    this._stairLock = false; // true while standing on the stair we just used
    this.cam = { x: 0, y: 0 };
    this.footDust = []; // { x, y, t } fading dust puffs left by the player's steps
    this._dustTimer = 0;
    this.fireflies = this._initFireflies();
    this._updateCamera();

    this.entryMessage = `The candles gutter. You enter the unhallowed nave, ${player.prefix} ${player.name}.`;
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

  showChat(key, text) {
    if (key === 'local') {
      this.localChat = { text, t: 3.2 };
    } else {
      const rp = this.remotePlayers.get(key);
      if (rp) rp.chat = { text, t: 3.2 };
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

    // Server tells us our own network id so we can ignore ourselves in snaps.
    this._onWelcome = (p) => { this.myNet = p.net || p.netId || 0; };

    // Identity metadata for peers newly entering our interest radius. Sent as
    // JSON, once each, so the per-tick position snapshot can stay tiny.
    this._onPeers = (list) => {
      for (const m of list) {
        const rp = this.remotePlayers.get(m.net) || {};
        rp.id = m.id; rp.name = m.name; rp.prefix = m.prefix;
        this.remotePlayers.set(m.net, rp);
      }
    };

    // Binary position snapshot: uint16 count, then per peer
    // netId(u16) x(i16) y(i16) dir(u8). We set the target and let update()
    // interpolate the render position toward it.
    this._onSnap = (buf) => {
      const view = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer || buf);
      const count = view.getUint16(0);
      const now = performance.now();
      let off = 2;
      for (let i = 0; i < count; i++) {
        const net = view.getUint16(off); off += 2;
        const x = view.getInt16(off); off += 2;
        const y = view.getInt16(off); off += 2;
        const dir = DIRS[view.getUint8(off)] || 'down'; off += 1;
        if (net === this.myNet) continue;
        let rp = this.remotePlayers.get(net);
        if (!rp) { rp = {}; this.remotePlayers.set(net, rp); }
        if (rp.rx == null) { rp.rx = x; rp.ry = y; } // snap in on first sight
        rp.tx = x; rp.ty = y; rp.dir = dir; rp.lastSnap = now;
      }
    };

    this._onPeerLeft = (p) => { if (p && p.net != null) this.remotePlayers.delete(p.net); };
    this._onEmoji = (p) => {
      const rp = this.remotePlayers.get(p.net);
      if (rp) rp.emoji = { emoji: p.emoji, t: 1.6 };
    };
    this._onChatMsg = (p) => this.showChat(p.net, p.text);

    this._onMancalaState = (state) => this.onMancala({ type: 'state', ...state });
    this._onMancalaEnd = (state) => this.onMancala({ type: 'end', ...state });
    this._onMancalaError = (data) => this.onToast(data.message);
    this._onMancalaFull = () => this.onToast('The table is full — wait for a seat.');

    s.on('welcome', this._onWelcome);
    s.on('peers', this._onPeers);
    s.on('snap', this._onSnap);
    s.on('peer_left', this._onPeerLeft);
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
    s.off('welcome', this._onWelcome);
    s.off('peers', this._onPeers);
    s.off('snap', this._onSnap);
    s.off('peer_left', this._onPeerLeft);
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

  startMancalaSolo() {
    if (this.socket) this.socket.emit('mancala_solo_start');
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
  // A few dim embers/ash motes drifting over the church & crypt floors for a
  // heavy, sacred-dread atmosphere (replaces the old outdoor fireflies).
  _initFireflies() {
    const list = [];
    for (let i = 0; i < 120 && list.length < 12; i++) {
      const c = h2(i * 11, 41) % COLS;
      const r = h2(41, i * 11) % ROWS;
      const ch = tileAt(c, r);
      if (ch !== '.' && ch !== 'c') continue;
      list.push({ baseX: c * TILE + TILE / 2, baseY: r * TILE + TILE / 2, seed: i });
    }
    return list;
  }

  // A tile blocks movement if it's a wall/void OR a currently-closed room door.
  _blocked(col, row) {
    if (isSolid(col, row)) return true;
    return this.doors.get(`${col},${row}`) === false; // door present & shut
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
    const blockedX = corners(nx, p.y).some(([cx, cy]) => this._blocked(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedX) p.x = nx;
    const blockedY = corners(p.x, ny).some(([cx, cy]) => this._blocked(Math.floor(cx / TILE), Math.floor(cy / TILE)));
    if (!blockedY) p.y = ny;
  }

  // Lock the camera exactly to the player every frame. For a pixel-art game
  // this is what keeps the world rock-steady: the player stays pinned to the
  // centre and the background scrolls in clean whole-pixel steps. (An eased
  // camera lags and catches up in 1px hops that don't line up with the
  // player's sub-pixel motion, which reads as a jitter/shimmer while walking.)
  _updateCamera() {
    this.cam.x = Math.max(0, Math.min(MAP_W - W, this.pc.x - W / 2));
    this.cam.y = Math.max(0, Math.min(MAP_H - H, this.pc.y - H / 2));
  }

  // Demo crowd: spawn N wandering Cultist NPCs (each a real generated Cultist
  // with rolled cult traits — hood/mask/horns/halo/blood robe) so you can see
  // the collection walking around the sanctuary. Enabled via ?crowd=N.
  _spawnCrowd(n) {
    if (!n) return [];
    n = Math.max(0, Math.min(60, n | 0));
    const floors = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const ch = tileAt(c, r);
      if ((ch === '.' || ch === 'c') && !isSolid(c, r)) floors.push([c, r]);
    }
    const list = [];
    for (let i = 0; i < n && floors.length; i++) {
      const [c, r] = floors[(i * 53 + 7) % floors.length];
      const seed = 1 + ((i * 131 + 17) % 2222);
      const traits = rollCultTraits(seed);
      const sex = (h2(seed, 3) % 2 === 0) ? 'male' : 'female';
      list.push({
        seed, traits, sex,
        sheet: getCultistSpriteVariant(seed, sex, traits.robe),
        x: px(c), y: px(r), dir: 'down', moving: false, bob: 0,
        tc: c, tr: r, wait: Math.random() * 2,
      });
    }
    for (const n of list) this._bakeCultist(n);
    return list;
  }

  // Pre-bake each NPC's character + regalia into 2x offscreen sprites (per
  // direction and walk frame) ONCE at spawn. The crowd then costs a single
  // drawImage per NPC per frame — no per-frame bezier/gradient work, which is
  // what tanked the frame rate (and made input feel dead) at ?crowd=30.
  _bakeCultist(n) {
    const dirs = ['down', 'up', 'left', 'right'];
    const targetH = 21;
    const dims = {};
    let maxW = 0, maxH = 0;
    for (const dir of dirs) {
      const frames = n.sheet[dir] || n.sheet.down;
      dims[dir] = frames.map((fr) => {
        const s = targetH / fr.lh, w = fr.lw * s, h = fr.lh * s;
        maxW = Math.max(maxW, w); maxH = Math.max(maxH, h);
        return { fr, w, h };
      });
    }
    const padX = 22, padTop = 20, padBot = 8;
    const BW = Math.ceil(maxW) + padX * 2, BH = Math.ceil(maxH) + padTop + padBot;
    const ax = BW / 2, ay = BH - padBot;
    n.bake = { BW, BH, ax, ay };
    n.baked = {};
    for (const dir of dirs) {
      n.baked[dir] = dims[dir].map(({ fr, w, h }) => {
        const cvs = document.createElement('canvas');
        cvs.width = BW * RES; cvs.height = BH * RES;
        const g = cvs.getContext('2d');
        g.imageSmoothingEnabled = false; g.setTransform(RES, 0, 0, RES, 0, 0);
        const top = ay - h;
        drawRegaliaBack(g, ax, top, w, h, n.traits, dir);
        g.drawImage(fr, ax - w / 2, top, w, h);
        drawRegaliaFront(g, ax, top, w, h, n.traits, dir);
        return cvs;
      });
    }
  }

  _updateCrowd(dt) {
    for (const n of this.crowd) {
      n.wait -= dt;
      if (n.wait > 0) { n.moving = false; continue; }
      const tx = px(n.tc), ty = px(n.tr);
      const dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy);
      if (d < 1.5) {
        // reached the target tile — idle a beat, then pick a new adjacent walkable tile
        n.moving = false;
        n.wait = 0.4 + Math.random() * 2.2;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
        for (let a = 0; a < 6; a++) {
          const [ox, oy] = dirs[(Math.random() * dirs.length) | 0];
          const nc = n.tc + ox, nr = n.tr + oy, t = tileAt(nc, nr);
          if ((t === '.' || t === 'c') && !isSolid(nc, nr)) { n.tc = nc; n.tr = nr; break; }
        }
      } else {
        const sp = 22 * dt;
        n.x += (dx / d) * sp; n.y += (dy / d) * sp;
        n.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        n.moving = true; n.bob += dt * 9;
      }
    }
  }

  _drawCultist(ctx, n) {
    const x = Math.round(n.x), groundY = Math.round(n.y) + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, groundY - 1, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
    const frames = n.baked[n.dir] || n.baked.down;
    const idx = n.moving ? Math.floor(n.bob / 6) % 2 : Math.floor(this.t / 1.4) % 2;
    const cvs = frames[idx] || frames[0];
    const { BW, BH, ax, ay } = n.bake;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cvs, x - ax, groundY - ay, BW, BH);
  }

  // Stepping onto a staircase tile drops (or raises) the player to the tile
  // it connects to — this is how the church and the two basement crypts link.
  // A lock keeps you from bouncing straight back: it clears only once you walk
  // off the destination stair.
  _checkStairs() {
    const pcol = Math.floor(this.pc.x / TILE), prow = Math.floor(this.pc.y / TILE);
    const onStair = STAIRS.find((s) => s.col === pcol && s.row === prow);
    if (!onStair) { this._stairLock = false; return; }
    if (this._stairLock) return;
    this.pc.x = px(onStair.dest.col);
    this.pc.y = px(onStair.dest.row);
    this._stairLock = true; // don't re-trigger the stair we just landed on
    this._updateCamera();
    sfx.click();
  }

  _nearestStation() {
    // +6px of slack on every station radius: A used to feel dead because the
    // trigger zones were barely a tile wide, so a step too far registered the
    // press but had nothing bound. This widens the sweet spot (and, since the
    // on-screen "[A] …" prompt reads the same result, the prompt appears sooner
    // too, so the player can see exactly when A is armed).
    let best = null, bestD = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(this.pc.x - s.x, this.pc.y - s.y);
      if (d < s.r + 6 && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  _nearestGift() {
    let best = null, bestD = Infinity;
    for (const g of this.gifts) {
      const gx = px(g.loc_x), gy = px(g.loc_y);
      const d = Math.hypot(this.pc.x - gx, this.pc.y - gy);
      if (d < 20 && d < bestD) { best = g; bestD = d; } // was 12 (barely one tile)
    }
    return best;
  }

  // Feedback for a face-button press that had nothing bound where the player is
  // standing — so a stray A/B tap reads as "nothing here", not "button broken".
  _noActionHint() {
    const now = performance.now();
    if (this._lastNoHint && now - this._lastNoHint < 2500) return; // rate-limit
    this._lastNoHint = now;
    sfx.error();
    this.onToast('Nothing to do here — stand on a station.');
  }

  _nearestDoor() {
    let best = null, bestD = Infinity;
    for (const d of DOORS) {
      const dist = Math.hypot(this.pc.x - px(d.col), this.pc.y - px(d.row));
      if (dist < 15 && dist < bestD) { best = d; bestD = dist; }
    }
    return best;
  }

  _toggleDoor(d) {
    const key = `${d.col},${d.row}`;
    const open = !this.doors.get(key);
    this.doors.set(key, open);
    sfx.click();
    this.onToast(open ? 'The door creaks open.' : 'You pull the door shut.');
  }

  // Fire-shrine duty (replaces "light the candles"): lay wood, then take the
  // torch and set the brazier ablaze. Lighting the first brazier of the day
  // completes the required "candles" duty; later ones just burn for ambience.
  async _handleFire(station) {
    const br = ALCOVES[station.alcove].brazier;
    const key = `${br.col},${br.row}`;
    if (this.litBraziers.has(key)) { this.onToast('This brazier already burns.'); return; }
    if (this._fireArmed !== key) {
      this._fireArmed = key;
      sfx.click();
      this.onToast('You lay wood in the brazier. Press A with the torch to light it.');
      return;
    }
    this._fireArmed = null;
    this.litBraziers.add(key);
    if (this.player.candles_today) { sfx.dutyComplete(); this.onToast('The brazier roars to life.'); }
    else await this._handleDuty('candles');
  }

  // Daily chant before the wall of skulls: the cultist intones the litany five
  // times, then the rite completes (mapped to the "garden" duty slot).
  _handleChant() {
    if (this._chant) return;
    if (this.player.garden_today) { this.onToast('You have already chanted today.'); return; }
    this._chant = { n: 0, t: 0.9 }; // fire the first line immediately
  }

  _updateChant(dt) {
    const c = this._chant;
    c.t += dt;
    if (c.t < 0.9) return;
    c.t = 0;
    if (c.n >= 5) { // rite finished
      this._chant = null;
      this._handleDuty('garden');
      return;
    }
    c.n += 1;
    this.showChat('local', 'Sanguis Aeternus, Vita Aeterna');
    sfx.click();
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
    // optimistic: the gift leaves your hand instantly; reconcile the Devotion
    // (and revert) once the server responds, so it doesn't feel laggy.
    this.holdingGift = false;
    sfx.gift();
    try {
      const res = await api.giftGive({ toGuru: true });
      this.player.devotion += res.devotionGained;
      this.onPlayerUpdate(this.player);
      this.onToast(`The Abbot accepts your gift. +${res.devotionGained} Devotion`);
    } catch (e) {
      this.holdingGift = true;
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
    if (this.holdingGift) return;
    // optimistic: grab it instantly so there's no round-trip lag; revert if
    // the server rejects (e.g. someone else already took it).
    this.holdingGift = true;
    this.gifts = this.gifts.filter((g) => g.id !== gift.id);
    sfx.gift();
    this.onToast('You pick up the gift.');
    try {
      await api.giftPickup(gift.id);
      if (this.socket) this.socket.emit('pickup_gift', { giftId: gift.id });
    } catch (e) {
      this.holdingGift = false;
      this._refreshGifts();
      sfx.error();
      this.onToast(e.message);
    }
  }

  async _handleDrop() {
    if (!this.holdingGift) return;
    this.holdingGift = false; // optimistic
    this.onToast('You set the gift down.');
    try {
      await api.giftDrop(this.pc.x / TILE, this.pc.y / TILE);
      if (this.socket) this.socket.emit('drop_gift');
      this._refreshGifts();
    } catch (e) {
      this.holdingGift = true;
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
    this._checkStairs();
    if (this._chant) this._updateChant(dt);
    if (this.crowd.length) this._updateCrowd(dt);
    this._updateCamera(dt);

    for (let i = this.footDust.length - 1; i >= 0; i--) {
      this.footDust[i].t += dt;
      if (this.footDust[i].t > 0.5) this.footDust.splice(i, 1);
    }

    this._activeStation = this._nearestStation();
    this._activeGift = this._nearestGift();
    this._activeDoor = this._nearestDoor();

    if (input.consumeAPress()) {
      if (this._activeDoor) {
        this._toggleDoor(this._activeDoor);
      } else if (this._activeGift && !this.holdingGift) {
        this._handlePickup(this._activeGift);
      } else if (this._activeStation) {
        if (this._activeStation.kind === 'duty') this._handleDuty(this._activeStation.id);
        else if (this._activeStation.kind === 'fire') this._handleFire(this._activeStation);
        else if (this._activeStation.kind === 'chant') this._handleChant();
        else if (this._activeStation.kind === 'guru') this._handleGuru();
        else if (this._activeStation.kind === 'confession') this._handleConfession();
        else if (this._activeStation.kind === 'leaderboard') this._handleLeaderboard();
        else if (this._activeStation.kind === 'bulletin') this._handleBulletin();
        else if (this._activeStation.kind === 'cathedral') this._handleCathedral(this._activeStation.roomId);
        else if (this._activeStation.kind === 'soul-altar') this._handleSoulAltar();
        else if (this._activeStation.kind === 'nursery') this._handleNursery();
        else if (this._activeStation.kind === 'mancala') this._handleMancala();
        else if (this._activeStation.kind === 'gate') this._handleSaveExit();
      } else {
        // A pressed with nothing in range: it DID register — give feedback so it
        // never feels dead. Rate-limited so tapping while walking isn't spammy.
        this._noActionHint(dt);
      }
    }
    if (input.consumeBPress()) {
      if (this.holdingGift) this._handleDrop();
      else this._noActionHint(dt);
    }

    if (this.localEmoji) {
      this.localEmoji.t -= dt;
      if (this.localEmoji.t <= 0) this.localEmoji = null;
    }
    if (this.localChat) {
      this.localChat.t -= dt;
      if (this.localChat.t <= 0) this.localChat = null;
    }
    const nowMs = performance.now();
    const lerp = Math.min(1, dt / INTERP_TIME);
    for (const [net, rp] of this.remotePlayers) {
      // Evict peers we've stopped hearing about (left our interest radius or
      // disconnected). Keep those with identity but no position yet (rx null).
      if (rp.lastSnap != null && nowMs - rp.lastSnap > PEER_STALE_MS) {
        this.remotePlayers.delete(net);
        continue;
      }
      // Ease the render position toward the last server target.
      if (rp.tx != null) {
        rp.rx += (rp.tx - rp.rx) * lerp;
        rp.ry += (rp.ty - rp.ry) * lerp;
      }
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

  // The floor/walls never change, so draw the whole map into an offscreen
  // canvas ONCE (at 2x device resolution) and blit the visible window each
  // frame instead of redrawing hundreds of tiles live. This is purely a
  // client-side cache in the player's browser (a few MB of their device
  // memory, zero server/VPS cost) — the same approach Club Nile uses — and
  // it removes per-frame tile churn so the world stays rock-steady.
  _buildFloor() {
    const cv = document.createElement('canvas');
    cv.width = MAP_W * RES;
    cv.height = MAP_H * RES;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.setTransform(RES, 0, 0, RES, 0, 0);
    this._drawFloor(g, 0, 0, COLS - 1, ROWS - 1);
    this._floor = cv;
  }

  _drawFloor(ctx, c0, r0, c1, r1) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(c, r);
        const x = c * TILE, y = r * TILE;
        const bhash = h2(c, r);
        if (ch === '#') {
          // stone wall — mid grey masonry (lightened for visibility)
          const shade = bhash % 3;
          ctx.fillStyle = shade === 0 ? '#3c3a46' : shade === 1 ? '#343240' : '#38363f';
          ctx.fillRect(x, y, TILE, TILE);
          // cold top edge so blocks read as masonry
          ctx.fillStyle = 'rgba(120,122,140,0.30)';
          ctx.fillRect(x, y, TILE, 1.4);
          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.fillRect(x, y + TILE - 2, TILE, 2);
          ctx.fillRect(x + TILE - 1, y, 1, TILE);
        } else if (ch === '.') {
          // church flagstone — lit grey stone (lightened for visibility)
          const shade = bhash % 3;
          ctx.fillStyle = shade === 0 ? '#5e5c6a' : shade === 1 ? '#565462' : '#5a5866';
          ctx.fillRect(x, y, TILE, TILE);
          if (bhash % 7 === 0) { ctx.fillStyle = 'rgba(160,160,182,0.10)'; ctx.fillRect(x + 2, y + 2, 3, 3); }
          if (bhash % 11 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 4, y + 5, 3, 2); }
          ctx.fillStyle = 'rgba(0,0,0,0.22)'; // grout
          ctx.fillRect(x, y + TILE - 1, TILE, 1);
          ctx.fillRect(x + TILE - 1, y, 1, TILE);
        } else if (ch === 'c') {
          // basement crypt floor — earthen, lit enough to read
          const shade = bhash % 3;
          ctx.fillStyle = shade === 0 ? '#453f36' : shade === 1 ? '#3d382f' : '#413b33';
          ctx.fillRect(x, y, TILE, TILE);
          if (bhash % 6 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 3, y + 4, 3, 2); }
          if (bhash % 13 === 0) { ctx.fillStyle = 'rgba(120,96,66,0.14)'; ctx.fillRect(x + 5, y + 2, 2, 2); }
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(x, y + TILE - 1, TILE, 1);
        } else {
          // the void beyond the walls — pure black
          ctx.fillStyle = '#050506';
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }
    // blood-red aisle runner down the nave of the inverted cross
    ctx.fillStyle = 'rgba(96, 16, 20, 0.6)';
    ctx.fillRect(px(NAVE_CX) - 8, NAVE.y0 * TILE, 16, (NAVE.y1 - NAVE.y0) * TILE);
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
      case 'alcove-arch': {
        // a pointed arch recess cut into the back wall; tip points E or W
        const w = TILE * 3.2, h = TILE * 3.6, top = y - h / 2;
        ctx.fillStyle = 'rgba(8,6,10,0.72)';
        ctx.beginPath();
        if (p.side === 'W') { // niche opens east; arch tip to the west
          ctx.moveTo(x + w / 2, top); ctx.lineTo(x + w / 2, top + h);
          ctx.quadraticCurveTo(x - w / 2, top + h / 2, x + w / 2, top);
        } else {
          ctx.moveTo(x - w / 2, top); ctx.lineTo(x - w / 2, top + h);
          ctx.quadraticCurveTo(x + w / 2, top + h / 2, x - w / 2, top);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#4c4a56'; ctx.lineWidth = 1.4; ctx.stroke();
        break;
      }
      case 'brazier': {
        const key = `${p.col},${p.row}`;
        const lit = this.litBraziers.has(key);
        this._dropShadow(ctx, x, y + 5, 6, 2.2);
        ctx.fillStyle = '#26221c'; // tripod legs
        ctx.fillRect(x - 5, y - 1, 1.6, 7); ctx.fillRect(x + 3.4, y - 1, 1.6, 7); ctx.fillRect(x - 0.8, y - 1, 1.6, 7);
        ctx.fillStyle = '#3a362e'; // iron bowl
        ctx.beginPath(); ctx.moveTo(x - 6, y - 2); ctx.lineTo(x + 6, y - 2); ctx.lineTo(x + 4, y + 2); ctx.lineTo(x - 4, y + 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#514c42'; ctx.fillRect(x - 6, y - 3, 12, 1.4);
        if (lit) {
          const fl = 0.82 + Math.sin(this.t * 12 + p.col) * 0.18 + Math.sin(this.t * 27) * 0.05;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(x, y - 5, 1, x, y - 5, 22 * fl);
          g.addColorStop(0, 'rgba(255,170,70,0.5)'); g.addColorStop(1, 'rgba(255,150,60,0)');
          ctx.fillStyle = g; ctx.fillRect(x - 24, y - 26, 48, 34);
          ctx.fillStyle = 'rgba(255,140,40,0.9)'; ctx.beginPath(); ctx.ellipse(x, y - 6, 3.2 * fl, 6.4 * fl, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,226,150,0.95)'; ctx.beginPath(); ctx.ellipse(x, y - 5, 1.6 * fl, 3.4 * fl, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = '#3a2c1e'; ctx.fillRect(x - 3, y - 3, 6, 1.3); ctx.fillRect(x - 2, y - 4.2, 5, 1.1);
        }
        break;
      }
      case 'wall-torch': {
        ctx.fillStyle = '#3a2c1e'; ctx.fillRect(x - 1, y - 2, 2, 8);   // staff
        ctx.fillStyle = '#5a4a34'; ctx.fillRect(x - 2.2, y + 5, 4.4, 1.4); // bracket
        const fl = 0.8 + Math.sin(this.t * 14 + p.row) * 0.2;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x, y - 4, 0, x, y - 4, 12 * fl);
        g.addColorStop(0, 'rgba(255,170,80,0.4)'); g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 12, y - 16, 24, 24);
        ctx.fillStyle = 'rgba(255,150,60,0.85)'; ctx.beginPath(); ctx.ellipse(x, y - 4, 2 * fl, 3.6 * fl, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,230,160,0.9)'; ctx.beginPath(); ctx.ellipse(x, y - 4, 0.9 * fl, 1.8 * fl, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'wood-stack': {
        this._dropShadow(ctx, x, y + 4, 5, 2);
        const cols = ['#5a4228', '#6b4f30', '#4a3826'];
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = cols[i % 3]; ctx.fillRect(x - 5, y - 2 + i * 2.2, 10, 2);
          ctx.fillStyle = '#2a1f14'; ctx.fillRect(x - 5, y - 2 + i * 2.2, 1.4, 2); ctx.fillRect(x + 3.6, y - 2 + i * 2.2, 1.4, 2);
        }
        break;
      }
      case 'room-door': {
        const open = this.doors.get(`${p.col},${p.row}`);
        this._dropShadow(ctx, x, y + 3, 5, 1.6);
        if (open) {
          ctx.fillStyle = '#0a0808'; ctx.fillRect(x - 5, y - 7, 10, 12);   // dark opening
          ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x - 6, y - 7, 2, 12);    // door swung to the post
        } else {
          ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x - 5, y - 8, 10, 13);   // timber door
          ctx.fillStyle = '#4a3826'; for (let i = 0; i < 3; i++) ctx.fillRect(x - 5 + i * 3.4, y - 8, 2.6, 13);
          ctx.fillStyle = '#6b5636'; ctx.fillRect(x - 5, y - 8, 10, 1.2);
          ctx.fillStyle = '#141010'; ctx.fillRect(x + 2, y - 2, 1.4, 1.4); // iron handle
        }
        break;
      }
      case 'skull-wall': {
        const yb = p.row * TILE + TILE - 2;
        for (let c = p.x0; c <= p.x1; c++) {
          for (let k = 0; k < 2; k++) {
            const sx = c * TILE + TILE / 2, sy = yb - k * 5;
            ctx.fillStyle = '#d8d1bd'; ctx.beginPath(); ctx.arc(sx, sy - 2, 2.6, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(sx - 2, sy, 4, 2.6);
            ctx.fillStyle = '#241f18'; ctx.fillRect(sx - 1.5, sy - 3, 1.2, 1.2); ctx.fillRect(sx + 0.3, sy - 3, 1.2, 1.2);
            ctx.fillRect(sx - 0.4, sy - 1, 0.8, 1.1);
          }
        }
        break;
      }
      case 'bench': {
        // garden bench — a solid timber seat with a back rail and legs
        this._dropShadow(ctx, x, y + 5, 8, 2.4);
        ctx.fillStyle = '#5c4224';                 // back rail
        ctx.fillRect(x - 7, y - 5, 14, 2.4);
        ctx.fillStyle = '#6f512c';
        ctx.fillRect(x - 7, y - 5, 14, 1);
        ctx.fillStyle = '#6a4c28';                 // seat plank
        ctx.fillRect(x - 7, y - 1, 14, 4.4);
        ctx.fillStyle = '#7d5c34';
        ctx.fillRect(x - 7, y - 1, 14, 1.3);
        ctx.fillStyle = '#3f2c16';                 // front shadow + legs
        ctx.fillRect(x - 7, y + 3, 14, 1.2);
        ctx.fillRect(x - 6, y + 4, 2, 3);
        ctx.fillRect(x + 4, y + 4, 2, 3);
        break;
      }
      case 'altar': {
        // dark death-cult altar: black slab, blood-red glow, INVERTED cross
        this._dropShadow(ctx, x, y + 7, 12, 3.2);
        const glowA = 0.5 + Math.sin(this.t * 2) * 0.25;
        const pool = ctx.createRadialGradient(x, y - 8, 1, x, y - 8, 22);
        pool.addColorStop(0, `rgba(200,30,30,${0.16 + glowA * 0.10})`);
        pool.addColorStop(1, 'rgba(200,30,30,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 22, y - 28, 44, 36);
        ctx.fillStyle = '#26232a';                 // black stone body
        ctx.fillRect(x - 10, y - 2, 20, 10);
        ctx.fillStyle = '#332f38';
        ctx.fillRect(x - 10, y - 2, 20, 2);
        ctx.fillStyle = '#141217';
        ctx.fillRect(x - 10, y + 6, 20, 2);
        ctx.fillStyle = '#3a1116';                 // dark blood-red cloth
        ctx.fillRect(x - 11, y - 5, 22, 4);
        ctx.fillStyle = '#551820';
        ctx.fillRect(x - 11, y - 5, 22, 1.2);
        ctx.fillStyle = '#7a1f26';
        ctx.fillRect(x - 11, y - 0.4, 22, 1);
        // INVERTED cross (crossbar low on the stem), tarnished iron
        ctx.fillStyle = '#8f8a97';
        ctx.fillRect(x - 1, y - 20, 2, 15);
        ctx.fillRect(x - 4.5, y - 9, 9, 2);
        ctx.fillStyle = 'rgba(210,40,40,0.5)';     // faint red edge-light
        ctx.fillRect(x - 1, y - 20, 1, 15);
        ctx.fillStyle = `rgba(210,40,40,${glowA})`; // ember at its foot
        ctx.beginPath(); ctx.arc(x, y - 4, 2.2, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 2; i++) {
          const phase = (this.t * 0.2 + i * 0.5) % 1;
          const sx = x + Math.sin(this.t * 0.6 + i * 2) * (2 + phase * 3);
          const sy = y - 6 - phase * 18;
          const sa = Math.sin(phase * Math.PI) * 0.22;
          ctx.fillStyle = `rgba(200,60,50,${sa})`;
          ctx.beginPath(); ctx.arc(sx, sy, 1 + phase * 1.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pew': {
        // a long church pew: seat plank, back rail, end posts, grain
        this._dropShadow(ctx, x, y + 4, 8, 2.4);
        ctx.fillStyle = '#5a3f22';                 // back rail
        ctx.fillRect(x - 7, y - 6, 14, 2.6);
        ctx.fillStyle = '#6f4f2b';
        ctx.fillRect(x - 7, y - 6, 14, 1);
        ctx.fillStyle = '#6a4a28';                 // seat
        ctx.fillRect(x - 7, y - 2, 14, 5);
        ctx.fillStyle = '#7d5a32';
        ctx.fillRect(x - 7, y - 2, 14, 1.4);
        ctx.fillStyle = 'rgba(58,40,20,0.5)';      // grain + front edge
        ctx.fillRect(x - 5, y + 0.6, 10, 0.6);
        ctx.fillStyle = '#3d2a14';
        ctx.fillRect(x - 7, y + 3, 14, 1.3);
        ctx.fillRect(x - 7, y - 6, 1.6, 10);       // end posts
        ctx.fillRect(x + 5.4, y - 6, 1.6, 10);
        break;
      }
      case 'stove': {
        // big stone kitchen hearth with a glowing firebox
        this._dropShadow(ctx, x, y + 7, 11, 3.2);
        const flick = 0.5 + Math.sin(this.t * 6) * 0.2;
        const pool = ctx.createRadialGradient(x, y, 1, x, y, 18);
        pool.addColorStop(0, `rgba(255,130,60,${0.14 + flick * 0.07})`);
        pool.addColorStop(1, 'rgba(255,130,60,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 18, y - 18, 36, 36);
        ctx.fillStyle = '#4a4640';                 // stone body
        ctx.fillRect(x - 9, y - 7, 18, 14);
        ctx.fillStyle = '#5c574f';                 // lit top / mantel
        ctx.fillRect(x - 10, y - 8, 20, 2.4);
        ctx.fillStyle = '#33302b';
        ctx.fillRect(x - 9, y + 5, 18, 2);
        ctx.fillStyle = '#160f0a';                 // firebox
        ctx.fillRect(x - 5, y - 2, 10, 7);
        ctx.fillStyle = `rgba(255,140,50,${flick})`; // flames
        ctx.beginPath(); ctx.ellipse(x - 2, y + 2, 2, 3.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,214,120,${flick})`;
        ctx.beginPath(); ctx.ellipse(x, y + 2.6, 1.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'bed': {
        // monk's cot: timber frame, wool blanket, cream pillow
        this._dropShadow(ctx, x, y + 7, 7, 2.6);
        ctx.fillStyle = '#573d21';                 // frame
        ctx.fillRect(x - 6, y - 8, 12, 16);
        ctx.fillStyle = '#6b4d2b';
        ctx.fillRect(x - 6, y - 8, 12, 1.4);
        ctx.fillStyle = '#6b5140';                 // wool blanket (muted)
        ctx.fillRect(x - 5, y - 2, 10, 9);
        ctx.fillStyle = '#7d6350';
        ctx.fillRect(x - 5, y - 2, 10, 1.4);
        ctx.fillStyle = 'rgba(50,36,26,0.4)';      // fold seams
        ctx.fillRect(x - 5, y + 2, 10, 0.7);
        ctx.fillRect(x - 5, y + 4.5, 10, 0.7);
        ctx.fillStyle = '#e4dcc4';                 // pillow
        ctx.fillRect(x - 4, y - 6, 8, 4);
        ctx.fillStyle = '#cfc4a4';
        ctx.fillRect(x - 4, y - 2.8, 8, 0.8);
        break;
      }
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
      case 'candle': {
        // a black votive candle with a small warm flame + floor light pool
        const flick = 0.7 + Math.sin(this.t * 11 + p.col * 2.3 + p.row) * 0.2;
        const pool = ctx.createRadialGradient(x, y + 2, 0.5, x, y + 2, 12);
        pool.addColorStop(0, `rgba(255,170,80,${0.12 + flick * 0.08})`);
        pool.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 12, y - 10, 24, 24);
        ctx.fillStyle = '#161318';                 // wax stick
        ctx.fillRect(x - 1.2, y - 4, 2.4, 7);
        ctx.fillStyle = '#0d0b10';                 // base
        ctx.fillRect(x - 2.4, y + 3, 4.8, 1.6);
        ctx.fillStyle = `rgba(255,190,110,${flick})`; // flame
        ctx.beginPath(); ctx.ellipse(x, y - 6, 1.1 * flick, 2.3 * flick, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,240,200,${flick})`;
        ctx.beginPath(); ctx.arc(x, y - 5.5, 0.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'stair-down': {
        // dark stone steps descending into the crypt
        this._dropShadow(ctx, x, y + 5, 7, 2.2);
        ctx.fillStyle = '#0a090c';                 // mouth of the stairwell
        ctx.fillRect(x - 6, y - 5, 12, 12);
        for (let i = 0; i < 4; i++) {              // receding lit step edges
          const a = 0.5 - i * 0.11;
          ctx.fillStyle = `rgba(120,120,140,${a})`;
          ctx.fillRect(x - 6 + i, y - 5 + i * 2.4, 12 - i * 2, 1.2);
        }
        ctx.fillStyle = 'rgba(200,40,40,0.10)';    // faint red glow from below
        ctx.fillRect(x - 5, y + 3, 10, 3);
        break;
      }
      case 'stair-up': {
        // stone steps rising back toward the church
        this._dropShadow(ctx, x, y + 5, 7, 2.2);
        ctx.fillStyle = '#14121a';
        ctx.fillRect(x - 6, y - 5, 12, 12);
        for (let i = 0; i < 4; i++) {
          const a = 0.25 + i * 0.10;
          ctx.fillStyle = `rgba(150,150,170,${a})`;
          ctx.fillRect(x - 6 + i, y + 4 - i * 2.4, 12 - i * 2, 1.2);
        }
        break;
      }
      case 'door': {
        // the way out — a black gap cut into the wall at the foot of the cross
        const gw = 22;
        const topY = y - 22, botY = y + 14;
        // black opening with an arched top
        ctx.fillStyle = '#040406';
        ctx.fillRect(x - gw / 2, topY, gw, botY - topY);
        ctx.beginPath(); ctx.arc(x, topY, gw / 2, Math.PI, 0); ctx.fill();
        // a touch of depth toward the far dark
        const g = ctx.createLinearGradient(0, topY - gw / 2, 0, botY);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = g; ctx.fillRect(x - gw / 2, topY - gw / 2, gw, botY - topY + gw / 2);
        // dressed-stone arch framing the gap
        ctx.strokeStyle = '#3a3d44'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - gw / 2, botY);
        ctx.lineTo(x - gw / 2, topY);
        ctx.arc(x, topY, gw / 2, Math.PI, 0);
        ctx.lineTo(x + gw / 2, botY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120,122,140,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        break;
      }
      case 'ossuary': {
        // a pile of skulls & bones
        this._dropShadow(ctx, x, y + 3, 7, 2.2);
        ctx.fillStyle = '#c9c2ad';
        for (const [sx, sy, rr] of [[-4, 1, 2.3], [3, 1, 2.3], [-1, -2, 2.6], [0, 3, 2.1]]) {
          ctx.beginPath(); ctx.arc(x + sx, y + sy, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#2a251c';                 // eye sockets
        for (const [sx, sy] of [[-4.7, 1], [-3.2, 1], [2.3, 1], [3.8, 1], [-1.7, -2], [-0.3, -2]]) {
          ctx.fillRect(x + sx, y + sy - 0.4, 1, 1.2);
        }
        ctx.fillStyle = '#a89f88';                 // a couple of long bones
        ctx.fillRect(x - 6, y + 4, 12, 1.4);
        break;
      }
      case 'ritual-circle': {
        // a glowing red sigil inscribed on the crypt floor
        const puls = 0.4 + Math.sin(this.t * 1.6) * 0.25;
        ctx.strokeStyle = `rgba(200,40,40,${0.5 + puls * 0.4})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
        // inverted five-point star
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + Math.PI + (i * 4 * Math.PI) / 5; // point-down
          const px2 = x + Math.cos(a) * 8, py2 = y + Math.sin(a) * 8;
          if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath(); ctx.stroke();
        const pool = ctx.createRadialGradient(x, y, 1, x, y, 12);
        pool.addColorStop(0, `rgba(200,30,30,${0.10 + puls * 0.08})`);
        pool.addColorStop(1, 'rgba(200,30,30,0)');
        ctx.fillStyle = pool; ctx.fillRect(x - 12, y - 12, 24, 24);
        break;
      }
    }
  }

  _drawStation(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.id === 'garden') {
      // the ossuary reliquary you tend: a stone trough of skulls, lit red
      // when tended today
      this._dropShadow(ctx, 0, 5, 9, 2.4);
      ctx.fillStyle = '#201d18';
      ctx.fillRect(-8, -3, 16, 8);
      ctx.fillStyle = '#141210';
      ctx.fillRect(-8, -3, 16, 1.4);
      const tended = this.player.garden_today;
      ctx.fillStyle = tended ? '#e6ddc6' : '#8f8874';
      for (let i = -5; i <= 5; i += 3.4) {
        ctx.beginPath(); ctx.arc(i, -2, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      if (tended) {
        const g = 0.4 + Math.sin(this.t * 3) * 0.25;
        ctx.fillStyle = `rgba(200,40,40,${g})`;
        ctx.fillRect(-8, 3, 16, 1.4);
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
      ctx.fillStyle = this.player.pray_today ? '#d24b4b' : '#7a1f26';
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

  _drawRemotePlayer(ctx, net, rp) {
    const seed = rp.id != null ? rp.id : 'n' + net;
    const rpSheet = getCultistSprite(seed, rp.prefix === 'Sister' ? 'female' : 'male');
    this._drawRobedFigure(ctx, rp.rx, rp.ry, rp.dir || 'down', false, this.t, rpSheet, false, rp.name, rp.emoji, rp.chat);
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
    // Only draw peers whose interpolated position is on-screen (Tier 2 cull):
    // even if the server streams a few dozen, we skip anyone off-camera.
    const camX = this.cam.x, camY = this.cam.y, M = TILE * 2;
    for (const [net, rp] of this.remotePlayers) {
      if (rp.rx == null) continue;
      if (rp.rx < camX - M || rp.rx > camX + W + M || rp.ry < camY - M || rp.ry > camY + H + M) continue;
      items.push({ y: rp.ry, draw: () => this._drawRemotePlayer(ctx, net, rp) });
    }
    for (const n of this.crowd) items.push({ y: n.y, draw: () => this._drawCultist(ctx, n) });
    items.push({ y: this.pc.y, draw: () => this._drawLocalPlayer(ctx) });
    items.sort((a, b) => a.y - b.y);
    return items;
  }

  // Ambient fireflies wandering slowly over the open exterior grounds.
  _drawFireflies(ctx) {
    // one baked ember glow, reused for every mote (was a fresh radial gradient
    // per mote per frame — needless allocation/GC churn every frame)
    if (!this._ember) {
      const s = 8, cv = document.createElement('canvas'); cv.width = cv.height = s;
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(210,70,40,1)');
      gr.addColorStop(0.5, 'rgba(150,40,30,0.5)');
      gr.addColorStop(1, 'rgba(150,40,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      this._ember = cv;
    }
    for (const f of this.fireflies) {
      const x = f.baseX + Math.sin(this.t * 0.4 + f.seed) * 6;
      const y = f.baseY - ((this.t * 3 + f.seed * 7) % 22); // embers drift upward
      const a = Math.max(0, 0.28 + Math.sin(this.t * 2 + f.seed * 2) * 0.28);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(this._ember, x - 3, y - 3, 6, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(255,150,90,${Math.min(1, a * 1.3)})`;
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }

  // A faint per-room color wash, keyed off the tile the player is standing
  // on, so each room reads with its own atmosphere (warm stone in the nave,
  // cool green in the garden, hearth-orange in the kitchen, blue at the
  // river) instead of one flat vignette everywhere.
  _roomTint() {
    const ch = tileAt(Math.floor(this.pc.x / TILE), Math.floor(this.pc.y / TILE));
    switch (ch) {
      case '.': return 'rgba(70, 12, 16, 0.06)';   // church: faint blood-red wash
      case 'c': return 'rgba(48, 8, 34, 0.09)';    // crypt: faint violet
      default: return 'rgba(6, 4, 8, 0.10)';       // walls/void
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

    // blit the pre-rendered floor (built once); MAP_W/MAP_H logical maps 1:1
    // to the cache's device pixels under the frame's 2x transform
    if (!this._floor) this._buildFloor();
    ctx.drawImage(this._floor, 0, 0, MAP_W, MAP_H);
    for (const item of this._collectDrawables(ctx)) item.draw();
    this._drawFireflies(ctx);

    ctx.restore();

    // light vignette — just enough to frame the view, not to hide the room
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = this._roomTint();
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    const promptBounce = Math.sin(this.t * 6) * 1.2;
    if (this._activeDoor) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      const open = this.doors.get(`${this._activeDoor.col},${this._activeDoor.row}`);
      ctx.fillText(open ? '[A] Close door' : '[A] Open door', W / 2, H - 16 + promptBounce);
    } else if (this._activeGift && !this.holdingGift) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText('[A] Pick up gift', W / 2, H - 16 + promptBounce);
    } else if (this._activeStation) {
      ctx.font = '6px "Courier New", monospace';
      ctx.fillStyle = '#f4e5bd';
      ctx.fillText(`[A] ${this._activeStation.label}`, W / 2, H - 16 + promptBounce);
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
