// The abbey — first scene after boot + naming. A multi-room floor plan
// (church / garden / kitchen / dorms, see web/js/abbeyMap.js) rendered with
// plain canvas primitives and a camera that follows the player, wired to the
// real Fastify API (duties, rites, confession) and Socket.io presence.

import { api, getWalletId, getTokenId, getSpriteSeed } from '../api.js';
import { sfx } from '../sfx.js';
import { drawCharacter, getCultistSprite, getGuruSprite, getConfessorSprite, getNakedSprite, getCultistSpriteVariant, CHAR_SCALE } from '../spritesheet.js';
import { rollCultTraits, drawRegaliaBack, drawRegaliaFront } from '../cultLook.js';
import { DialogueBox, drawBang } from '../dialogue.js';
import { LORE } from '../lore.js';
import { FireRite } from '../firerite.js';
import { Scourge, StickPile } from '../scourge.js';
import { SkullShrine } from '../skullrite.js';
import { FireVigil } from '../vigil.js';
import { CHANT_PAIR } from '../config.js';
import {
  TILE, COLS, ROWS, GRID, PROPS, tileAt, isSolid, h2, CATHEDRAL_ALCOVES, STAIRS,
  ALCOVES, ROOMS, BEDS, SPAWN_BEDS, SKULL_ROOM, SKULL_ALTAR, NAVE, TRANSEPT, NAVE_CX,
  EXIT_ROW, STICKS, CONFESSIONAL_BOOTH_COL, CONFESSIONAL_BOOTH_ROW, SKULL_SHRINE, BOARD,
} from '../abbeyMap.js';
import {
  FLOOR, WALL, EARTH, VOID, BLOOD, GOLD, WOOD, IRON, BONE, CLOTH, SOUL, MOSS,
  SHADOW, SHADOW_SOFT, FIRE, ramp, shade, block, flame, candleFlame,
} from '../palette.js';

// Statues are cut from the same stone as the walls they stand against, so they
// use the WALL ramp shifted one whole step brighter. A figure that projects out
// of a wall catches the abbey's upper-left light where the flat wall behind it
// cannot; without the shift, eight WALL-coloured figures on a WALL-coloured
// surface are eight dark smudges nobody can read at ten pixels to the tile.
const STONE = ramp('#1b1330', '#37294f', '#503c6c', '#6b5488', '#8f76b0');

const W = 208, H = 208; // logical screen size (canvas backing store is RES x this)
const RES = 2;          // must match the 2x transform main.js sets each frame
const MAP_W = COLS * TILE, MAP_H = ROWS * TILE;
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
  { id: 'guru', kind: 'guru', label: 'Offer to the Abbot', x: px(NAVE_CX), y: px(11), r: 13 },
  // In the niche now, two tiles south of the grille — you have to leave the
  // transept and step into the booth's own little room to be heard.
  { id: 'confession', kind: 'confession', label: 'Confess',
    x: px(CONFESSIONAL_BOOTH_COL), y: px(CONFESSIONAL_BOOTH_ROW + 2), r: 13 },
  // The skull chamber's daily rite is worshipping the shrine, not chanting at
  // the wall. It is deliberately NOT a station: a station opens a box and runs
  // a rite, and the shrine takes over the whole scene instead. See _shrineAction().
  // The day ends where it began: at a bed, in the cell you woke in or any
  // other. There is no gate any more — walking out of the front door is not a
  // thing a cultist does, and "go and lie down" is a better last instruction
  // than "leave".
  ...BEDS.map((b, i) => ({
    id: `bed${i}`, kind: 'bed', label: 'Rest — Save & Exit',
    x: px(b.stand.col), y: px(b.stand.row), r: 12,
  })),
  // The Reckoning, on the transept's north wall beside the confessor's niche.
  // Read, not performed: it opens a box and does nothing else.
  //
  // Stood in front of, from the SOUTH. The board hangs on a wall now rather
  // than closing off a dead end, so the tile a player reads it from is the one
  // below it — the two rows it occupies are both solid.
  { id: 'board', kind: 'board', label: 'Read the Reckoning',
    x: px(BOARD.col), y: px(BOARD.row + 2), r: 14 },
  // The braziers are deliberately NOT stations. A station opens a box and runs
  // a rite; a brazier is a container you put things in, and it has to behave
  // differently depending on what you are carrying. See _fireAction().
];
const EMOJI_KEYS = { Digit1: '🙏', Digit2: '✨', Digit3: '🕯️' };

// The mantra every rite is performed to. All three daily duties speak it in
// bubbles over the worshipper's head, so the whole day has one voice — the
// shrine simply says it three times over. The words are CHANT_PAIR in
// config.js; this file, vigil.js and skullrite.js all read that one array.

// The altar's box used to hold for a mandatory ten seconds because reading it
// WAS the prayer duty. Praying pays nothing now, so holding the player there
// would be a toll with no rite behind it.
function boxOpts() { return {}; }

export class AbbeyScene {
  constructor({ player, onPlayerUpdate, onToast, socket, onSaveExit, onChatOpen, onConfessionPay, crowd }) {
    this.player = player;
    this.crowd = this._spawnCrowd(crowd || 0); // demo NPC cultists wandering the sanctuary
    this.onPlayerUpdate = onPlayerUpdate || (() => {});
    this.onToast = onToast || (() => {});
    this.onSaveExit = onSaveExit || (() => {});
    this.onChatOpen = onChatOpen || (() => {});
    // Signing lives in main.js, which is the only place that knows the connected
    // address. Returns the transaction hash, or null if the player refused.
    this.onConfessionPay = onConfessionPay || (async () => null);
    this.socket = socket || null;

    this.t = 0;
    this.localEmoji = null; // { emoji, t }
    this.localChat = null; // { text, t }
    this.cathedralRooms = new Map(); // roomId -> { owner_id, owner_name }

    // Keyed by network id (uint16 assigned by the server). Each entry carries
    // the peer's identity (id=tokenId, name, prefix), its latest server target
    // (tx,ty,dir), the interpolated render position (rx,ry), a lastSnap
    // timestamp for staleness eviction, plus transient emoji/chat bubbles.
    this.remotePlayers = new Map();
    this.myNet = 0;

    // fire-alcove braziers that have been lit (keyed "col,row"), the openable
    // room doors (keyed "col,row" -> open?), and the running skull chant.
    this.litBraziers = new Set();   // legacy: kept for the prop renderer's key lookup
    this.fire = new FireRite(ALCOVES, px);
    // The vigil: the fire duty is a rite now, not a toast. It borrows the
    // shrine's chant plumbing wholesale — same bubble, same beat length, same
    // mantra — because they are two altars of one liturgy.
    this.vigil = new FireVigil({
      onChant: (line, gap) => this.showChat('local', line, { hold: gap * 0.96, cps: 11 }),
      onLine: (i) => { i % 2 ? sfx.confession() : sfx.dutyComplete(); },
      onDone: () => this._endVigil(),
    });
    this.sticks = new StickPile(STICKS, px);
    this.scourge = new Scourge({
      // Said through the blows: the first line as the switch comes down the
      // first time, the second after the fourth.
      onLash: (i) => {
        sfx.lash(i);
        if (i === 0) this._speak([CHANT_PAIR[0]]);
        else if (i === 3) this._speak([CHANT_PAIR[1]]);
      },
      onDone: () => this._endScourge(),
    });
    // null | { kind: 'wood' | 'torch', alcove: i } | { kind: 'stick' }
    this.carrying = null;

    this.shrine = new SkullShrine({
      x: px(SKULL_SHRINE.col), y: px(SKULL_SHRINE.row),
      // The one tile the rite starts from, painted blood red on the floor.
      altar: { x: px(SKULL_ALTAR.col), y: px(SKULL_ALTAR.row) },
      // The rite passes its own beat length, so the line stays up for exactly
      // as long as the shrine means it to and the two can never drift apart.
      onChant: (line, gap) => {
        this.showChat('local', line, { hold: (gap || 3.2) * 0.96, cps: 11 });
        sfx.click();
      },
      onEvent: (kind) => {
        if (kind === 'blood') sfx.error();          // a short low sting
        else if (kind === 'kindle') sfx.confession();
        else if (kind === 'glow') sfx.streakBonus();
        else if (kind === 'land') sfx.dutyComplete();
      },
      onDone: () => this._endWorship(),
    });
    // Already done today: the skull is on the floor with its eyes lit when you
    // walk in, rather than aloft and waiting to be worshipped a second time.
    if (this.player.garden_today) this.shrine.settle();

    // You wake in a cell, and which one is decided when you enter. Six beds,
    // one spirit — arriving somewhere different each time makes the warren a
    // place you live in rather than a corridor you pass through, and it spreads
    // arrivals out instead of stacking everyone on one threshold.
    const spawn = SPAWN_BEDS[Math.floor(Math.random() * SPAWN_BEDS.length)];
    this.spawnBed = spawn;

    this.pc = {
      x: px(spawn.col), y: px(spawn.row),
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

    this.lastEmittedMove = 0;
  }

  get dialogue() {
    if (!this._dialogue) this._dialogue = new DialogueBox();
    return this._dialogue;
  }

  enter() {
    this.mySheet = getCultistSprite(getSpriteSeed(), this.player.sex);
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

  // Queues the day's mantra over the worshipper's head, one line a second.
  // Every duty uses it, so all three rites are performed to the same words.
  _speak(lines, delay = 0) {
    this._chantQ = (this._chantQ || []).concat(
      lines.map((text, i) => ({ text, at: this.t + delay + i * 1.0 }))
    );
  }

  _updateSpeech() {
    if (!this._chantQ || !this._chantQ.length) return;
    while (this._chantQ.length && this._chantQ[0].at <= this.t) {
      this.showChat('local', this._chantQ.shift().text);
      sfx.click();
    }
  }

  showChat(key, text, { hold = 3.2, cps = 0 } = {}) {
    if (key === 'local') {
      // `cps` makes the bubble type itself out instead of appearing whole.
      // The box is still sized to the FINISHED string — a bubble that grows a
      // character at a time jitters, and the tail slides out from under the
      // speaker's head while it does.
      this.localChat = { text, t: hold, age: 0, cps };
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
        rp.seed = m.seed; rp.name = m.name; rp.prefix = m.prefix;
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

    // REJOIN ON RECONNECT. join was emitted once, in enter(), so a socket that
    // dropped and came back left the server holding a connection it knew
    // nothing about — no name, no position, and now no session to check a duty
    // against. A player whose connection blipped could walk to the shrine,
    // perform the rite, and be told the abbey could not see them.
    this._onConnect = () => this._emitJoin();

    s.on('connect', this._onConnect);
    s.on('welcome', this._onWelcome);
    s.on('peers', this._onPeers);
    s.on('snap', this._onSnap);
    s.on('peer_left', this._onPeerLeft);
    s.on('emoji_show', this._onEmoji);
    s.on('chat_msg', this._onChatMsg);
  }

  _unbindSocket() {
    const s = this.socket;
    if (!s) return;
    s.off('connect', this._onConnect);
    s.off('welcome', this._onWelcome);
    s.off('peers', this._onPeers);
    s.off('snap', this._onSnap);
    s.off('peer_left', this._onPeerLeft);
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
      // `seed` is what other players are shown — a one-way hash, not the id.
      // `wallet` and `tokenId` go to the SERVER only, so it can tie this live
      // session to the row a duty would pay; it never echoes them to anyone.
      seed: getSpriteSeed(),
      wallet: getWalletId(),
      tokenId: getTokenId(),
      name: this.player.name,
      prefix: this.player.prefix,
      x: this.pc.x,
      y: this.pc.y,
    });
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

  // A tile blocks movement if it's a wall or void. It used to also check for a
  // shut cell door; the cells have no doors now, because they are where you
  // arrive and where you end the day and a door is a thing that can be closed
  // on the only way out.
  _blocked(col, row) {
    if (isSolid(col, row)) return true;
    return false;
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
  // Normally the camera is on the player. A cutscene can set `_focus` to frame
  // something else — the vigil puts it between the fire and the worshipper so
  // both stay in shot without the view ever cutting.
  _updateCamera() {
    const f = this._focus || this.pc;
    this.cam.x = Math.max(0, Math.min(MAP_W - W, f.x - W / 2));
    this.cam.y = Math.max(0, Math.min(MAP_H - H, f.y - H / 2));
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
    ctx.fillStyle = SHADOW;
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
  // Walking into the gap at the foot of the cross leaves the abbey. The gap is
  // drawn as a hole in the wall, so it has to behave like one rather than
  // needing an A press at a station a few tiles short of it.
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
    // gold "!" over the player reads the same result, the mark appears sooner
    // too, so the player can see exactly when A is armed).
    let best = null, bestD = Infinity;
    for (const s of STATIONS) {
      const d = Math.hypot(this.pc.x - s.x, this.pc.y - s.y);
      if (d < s.r + 6 && d < bestD) { best = s; bestD = d; }
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

  _fireAction() {
    const p = this.pc;

    // holding something -> the only question is where it goes
    if (this.carrying) {
      const b = this.fire.brazierAt(p.x, p.y);
      if (b >= 0) {
        if (this.carrying.kind === 'wood' && !this.fire.isLaid(b) && !this.fire.isLit(b)) {
          this.fire.lay(b);
          this.carrying = null;
          sfx.click();
          return true;
        }
        if (this.carrying.kind === 'torch' && this.fire.isLaid(b) && !this.fire.isLit(b)) {
          this.fire.light(b);
          this.fire.returnTorch(this.carrying.alcove);
          this.carrying = null;
          this.litBraziers.add(`${ALCOVES[b].brazier.col},${ALCOVES[b].brazier.row}`);
          if (this.player.candles_today) sfx.dutyComplete();
          else this._beginVigil(b);
          return true;
        }
      }
      return false;
    }

    // empty-handed -> pick up whichever is nearer
    const w = this.fire.woodAt(p.x, p.y);
    if (w >= 0) {
      this.fire.takeWood(w);
      this.carrying = { kind: 'wood', alcove: w };
      sfx.click();
      return true;
    }
    const tc = this.fire.torchAt(p.x, p.y);
    if (tc >= 0) {
      this.fire.takeTorch(tc);
      this.carrying = { kind: 'torch', alcove: tc };
      sfx.click();
      return true;
    }
    return false;
  }

  // B, or walking off with something you should not have. A torch always finds
  // its way back to its own bracket; wood dropped anywhere is simply gone, and
  // another stack appears at the source two minutes later.
  _dropCarried() {
    if (!this.carrying) return false;
    if (this.carrying.kind === 'torch') this.fire.returnTorch(this.carrying.alcove);
    this.carrying = null;
    sfx.click();
    return true;
  }

  // The day's three duties are performed in a fixed order: feed a brazier,
  // take the switch to the Abbot, then give the skull your blood. Each rite
  // simply refuses to start until the one before it is done, and the gold mark
  // stays away — the absence of the mark IS the instruction, the same way it is
  // everywhere else in the abbey.
  //
  // The order is not arbitrary. You cannot offer blood you have not yet been
  // made to bleed, and the Abbot will not raise a switch in a cold chapel.
  _dutyOpen(id) {
    if (id === 'scourge') return !!this.player.candles_today;
    if (id === 'shrine') return !!this.player.scourge_today;
    return true;
  }

  // Standing before the shrine and pressing A. There is no dialogue box and no
  // instruction: the robe comes off, the blood falls, and the skull answers.
  // Kneeling to the fire the moment it catches. The scene hands over movement,
  // both buttons and the camera; the Devotion is settled in _endVigil(), so
  // walking away mid-rite is not a way to be paid without performing it.
  _beginVigil(b) {
    const bz = ALCOVES[b].brazier;
    if (!this.vigil.begin(px(bz.col), px(bz.row) + 2, this.pc.x, this.pc.y)) return;
    document.body.classList.add('rite-open');
    this.pc.dir = this.pc.x > px(bz.col) ? 'left' : 'right';
    this.pc.moving = false;
    sfx.confession();
  }

  _endVigil() {
    document.body.classList.remove('rite-open');
    this._handleDuty('candles');
  }

  _updateVigil(dt, input) {
    this.vigil.update(dt);
    this.t += dt;
    // The rite walks them to the mark and holds them there.
    this.pc.x = this.vigil.px;
    this.pc.y = this.vigil.py;
    this.fire.update(dt);
    this.sticks.update(dt);
    this.shrine.update(dt);
    if (this.crowd.length) this._updateCrowd(dt);
    this.pc.moving = false;
    this._activeStation = null;
    this._updateSpeech();
    if (this.localChat) {
      this.localChat.t -= dt;
      this.localChat.age += dt;
      if (this.localChat.t <= 0) this.localChat = null;
    }
    // The camera holds the fire and the worshipper in one frame for the whole
    // rite rather than tracking the player, who is not going anywhere.
    this._focus = { x: this.vigil.focusX, y: this.vigil.focusY };
    this._updateCamera();
    this._focus = null;
    input.consumeAPress();
    input.consumeBPress();
  }

  _shrineAction() {
    if (this.shrine.active || this.shrine.done) return false;
    if (!this._dutyOpen('shrine')) return false;
    if (this.carrying || !this.shrine.inReach(this.pc.x, this.pc.y)) return false;
    if (!this.shrine.begin(this.pc.x, this.pc.y)) return false;
    document.body.classList.add('rite-open');
    this.pc.dir = 'up';          // you face it
    this.pc.moving = false;
    sfx.confession();
    return true;
  }

  _endWorship() {
    document.body.classList.remove('rite-open');
    sfx.streakBonus();
    this._handleDuty('garden');
  }

  _updateShrine(dt, input) {
    this.shrine.update(dt);
    this.t += dt;
    this.fire.update(dt);
    this.sticks.update(dt);
    if (this.crowd.length) this._updateCrowd(dt);
    // While the chant runs, the rite owns where the worshipper stands: it walks
    // them a full circuit of the skull, always turned inward to face it. Before
    // and after, they simply stand where they knelt.
    const d = this.shrine.dance;
    if (d) {
      this.pc.x = d.x; this.pc.y = d.y;
      this.pc.dir = d.dir;
      this.pc.moving = true;
      this.pc.bob += dt * 9;
      this._danceHop = d.hop;
    } else {
      this.pc.dir = 'up';
      this.pc.moving = false;
      this._danceHop = 0;
    }
    this._activeStation = null;
    this._updateSpeech();
    if (this.localChat) {
      this.localChat.t -= dt;
      this.localChat.age += dt;
      if (this.localChat.t <= 0) this.localChat = null;
    }
    this._updateCamera();
    input.consumeAPress();
    input.consumeBPress();
  }

  // One call for all three duties: Light Fire, Whipping, Skull Chant. The
  // server pays the base plus the streak bonus for THIS task, so the toast can
  // show both — the bonus arrives with the act rather than at the end of the
  // day, and the player should be able to see that happen.
  async _handleDuty(id) {
    try {
      const res = await api.duty(id);
      if (res.alreadyDone) {
        this.onToast(`${res.name} — already done today.`);
        return;
      }
      this.player[`${id}_today`] = 1;
      this.player.devotion += res.devotionGained;
      this.player.streak = res.streak;
      this.player.multiplier = res.multiplier;
      this.onPlayerUpdate(this.player);
      res.streakBonus > 0 ? sfx.streakBonus() : sfx.dutyComplete();
      const bonus = res.streakBonus > 0 ? ` (${res.base} +${res.streakBonus} streak)` : '';
      this.onToast(`${res.name}: +${res.devotionGained} Devotion${bonus}`);
      if (res.streakAdvanced) {
        // A box, not a toast. This is the one line a day that says the streak
        // moved, and a toast scrolls it away in three seconds whether or not
        // anyone was looking at the screen. It still never counts the duties
        // or names them — "all three" would be an instruction wearing a robe.
        this.dialogue.show([{
          speaker: 'The Abbey',
          // The warning LEADS now rather than trailing. It also used to be said
          // twice — this opened on "The day is kept" and closed on "Come back
          // tomorrow, or lose it" — and one box saying the same thing at both
          // ends reads as padding.
          text: 'Come back tomorrow or lose your streak.\n\n'
            + `Your streak stands at ${res.streak} day${res.streak === 1 ? '' : 's'}, `
            + `and every act is now worth ${res.multiplier}x.\n\n`
            // The streak is the thing they will be sorest to lose, and it is
            // only written down when they lie down. Saying it HERE, in the one
            // box a day that they are certain to read, is the whole point of
            // saying it at all.
            //
            // "Save", not "set it down": the abbey's own word for a bed is
            // Rest — Save & Exit, and a player who has just finished their
            // third duty needs the instruction, not the poetry.
            + 'Rest in a bed to save.',
        }]);
      }
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
    }
  }

  // The Abbot no longer takes parcels. He takes the switch out of your hands
  // and uses it, and that is the whole transaction — so this handler only ever
  // starts the cutscene; the Devotion is settled in _endScourge().
  _handleGuru() {
    if (this.scourge.active) return;
    if (!this.carrying || this.carrying.kind !== 'stick') return;
    if (this.player.scourge_today) return;   // the box already said so
    if (!this._dutyOpen('scourge')) return;  // ditto
    this.carrying = null;
    document.body.classList.add('rite-open');
    this.scourge.begin(this._guruStation().x, this._guruStation().y, this.pc.x, this.pc.y);
  }

  _guruStation() { return STATIONS.find((s) => s.id === 'guru'); }

  // The fifth blow has landed and the switch is in pieces. Award, then let the
  // Abbot have the last word.
  async _endScourge() {
    document.body.classList.remove('rite-open');
    this.pc.x = this.scourge.mx;
    this.pc.y = this.scourge.my;
    this.pc.dir = 'down';
    sfx.purify();
    this.dialogue.show([LORE.stations.scourged]);
    this._handleDuty('scourge');
  }

  // Taking a switch from the bundle by the skull-chamber wall.
  _stickAction() {
    if (this.carrying) return false;
    const i = this.sticks.at(this.pc.x, this.pc.y);
    if (i < 0) return false;
    this.sticks.take(i);
    this.carrying = { kind: 'stick' };
    sfx.click();
    return true;
  }

  // The Abbot has three lines and the one he uses is decided by what you are
  // holding and whether he has already had you today. Every other station just
  // reads its own entry.
  // THE RECKONING. Everything a player has to hold in their head otherwise:
  // what their streak is worth, what a duty pays THIS week, how long is left,
  // and what bringing people in has earned them.
  //
  // Laid out with DOT LEADERS rather than spaces, and that is not decoration.
  // The box wraps by measuring words and rejoining them with ONE space, so a
  // column aligned with a run of spaces arrives on screen collapsed to
  // "Devotion 1234" — the table falls apart the moment it is drawn. Dots
  // survive the trip, and a ledger of dotted rows is what a board of figures
  // ought to look like anyway. Every row is built to exactly ROW_W characters,
  // which is what fits a line at this font.
  async _readBoard() {
    let p = this.player;
    try {
      const fresh = await api.me();
      if (fresh && typeof fresh.devotion === 'number') {
        p = fresh;
        this.player = fresh;
        this.onPlayerUpdate(this.player);
      }
    } catch { /* show what we have rather than nothing */ }

    const ROW_W = 22;
    const row = (label, value) => {
      const v = String(value);
      // One dot is the floor, not two: "Devotion per task" leaves room for
      // exactly one, and a row a single character over the width does not
      // overflow quietly — it has spaces in it, so the box breaks it and the
      // figure lands on a line of its own.
      const dots = Math.max(1, ROW_W - label.length - v.length - 2);
      return `${label} ${'.'.repeat(dots)} ${v}`;
    };
    const streak = p.streak || 0;
    const mult = p.multiplier || 1;
    const task = p.taskDevotion || {};
    const clock = p.clock || {};
    const ref = p.referralDevotion || {};

    const pages = [
      {
        speaker: 'The Reckoning',
        text: row('Devotion', p.devotion || 0) + '\n'
          + row('Streak', `${streak}d`) + '\n'
          + row('Multiplier', `${mult}x`),
      },
      {
        speaker: 'The Season',
        text: row('Week', `${clock.week || 1} of ${clock.weeks || 8}`) + '\n'
          + row('Devotion per task', task.base != null ? task.base : 0) + '\n'
          + row('Days left', clock.daysLeft != null ? clock.daysLeft : '?') + '\n\n'
          + 'The base rises each\nweek, for everyone.',
      },
      {
        // "In all" is not the same figure as "Earned" and is not redundant
        // with it: Earned is what BRINGING people in has paid, and In all adds
        // the once-only Devotion for having been brought in yourself. For a
        // player nobody referred the two do read the same, which is correct.
        speaker: 'Referrals',
        text: row('You brought', ref.broughtIn || 0) + '\n'
          + row('Earned', `+${ref.fromBringing || 0}`) + '\n\n'
          + row('In all', `+${ref.total || 0}`),
      },
    ];
    this.dialogue.show(pages, boxOpts());
  }

  _introFor(s) {
    if (s.id === 'guru') {
      if (this.carrying && this.carrying.kind === 'stick') {
        if (this.player.scourge_today) return LORE.stations.scourgedAlready;
        if (!this._dutyOpen('scourge')) return LORE.stations.scourgeTooSoon;
        return LORE.stations.scourge;
      }
      return LORE.stations.guru;
    }
    // The Confessor names his price. He has always said the mending costs
    // something ("it keeps accounts") and never once said what — the server
    // has sent the figure all along and nothing rendered it. It is worked out
    // from the week and the line's Cultists, so it is different for every
    // holder and every week, and a player deciding whether to kneel needs it
    // in front of them.
    if (s.id === 'confession') {
      const p = this.player.confessionPrice;
      const base = LORE.stations.confession;
      if (!this.player.needsConfession || !p) return base;
      return {
        speaker: base.speaker,
        text: '"You have broken something."\n\n'
          + `"Week ${p.week}. ${p.pct}% of what the line cost to raise, `
          + `across ${p.cultists} Cultist${p.cultists === 1 ? '' : 's'}."\n\n`
          + `"${p.avax} AVAX. Kneel, or go."`,
      };
    }
    return LORE.stations[s.id] || LORE.stations[s.kind];
  }

  // Ask, pay, then confess. Three steps and the client decides none of them:
  // the server quotes the price and names the address, the wallet signs that
  // exact transfer, and the server checks the chain itself before it forgives
  // anything. The only thing carried back up is the hash.
  async _handleConfession() {
    if (!this.player.needsConfession) { this.onToast('No confession needed.'); return; }
    if (this._confessing) return;               // one rite at a time; this spends money
    this._confessing = true;
    try {
      // 1. What does it cost, and where does it go? A 402 IS the answer here,
      //    not a failure — anything else means something is wrong.
      let quote = null;
      try {
        const already = await api.confession();
        // The abbey mended it without asking for money. Only possible on a
        // build that is not collecting; take it and say so.
        this._afterConfession(already);
        return;
      } catch (e) {
        if (e.status !== 402 || !e.body || !e.body.payTo) throw e;
        quote = e.body;
      }

      // 2. Sign the transfer the server quoted.
      const hash = await this.onConfessionPay(quote.payTo, quote.price.wei, quote.price.avax);
      if (!hash) { this.onToast('Nothing was paid, so nothing was mended.'); return; }

      // 3. Hand up the hash. The server verifies it against the chain.
      this._afterConfession(await api.confession(hash));
    } catch (e) {
      sfx.error();
      this.onToast(e.message || 'The confession failed.');
    } finally {
      this._confessing = false;
    }
  }

  _afterConfession(res) {
    this.player.needsConfession = false;
    this.player.confessionCost = null;
    this.player.confessionPrice = null;
    this.player.streak = res.restoredStreak;
    this.onPlayerUpdate(this.player);
    sfx.confession();
    // Says what was actually charged. A message reading "Confession accepted"
    // over a quoted price on a build that took nothing would let a player
    // believe they had paid it.
    this.onToast(res.collected
      ? `Paid ${res.costPaid} AVAX. Streak restored to ${res.restoredStreak}.`
      : `Streak restored to ${res.restoredStreak}. Nothing was taken.`);
  }

  async _handleSaveExit() {
    try {
      const res = await api.save();
      // Explicitly the largest size: this is the last thing the game says
      // before the console goes off, and left to the by-length default it
      // CHANGED SIZE with the Devotion — 150 came up a tier bigger than 1500,
      // purely because the number was shorter. There is no dwell to set any
      // more: the box waits for A, which is what this one always wanted.
      this.onToast(`Saved. ${res.devotion} Devotion secured.`, { size: 't-huge' });
      this.onSaveExit();
    } catch (e) {
      sfx.error();
      this.onToast(e.message);
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

  // Performs a station's rite. Split out from the A handler so the dialogue
  // box can call it on close — read first, then act — without duplicating the
  // dispatch in two places.
  _runStation(s) {
    if (s.kind === 'guru') this._handleGuru();
    else if (s.kind === 'confession') this._handleConfession();
    else if (s.kind === 'cathedral') this._handleCathedral(s.roomId);
    else if (s.kind === 'bed') this._handleSaveExit();
  }

  _updateScourge(dt, input) {
    this.scourge.update(dt);
    const ws = this.scourge.worldScale;
    this.t += dt * ws;
    this.fire.update(dt * ws);
    this.sticks.update(dt * ws);
    if (this.crowd.length) this._updateCrowd(dt * ws);

    this._updateSpeech();
    if (this.localChat) {
      this.localChat.t -= dt;
      this.localChat.age += dt;
      if (this.localChat.t <= 0) this.localChat = null;
    }
    this.pc.x = this.scourge.penX;
    this.pc.y = this.scourge.penY;
    this.pc.dir = 'down';
    this.pc.moving = false;
    this._activeStation = null;
    this._updateCamera();

    // Nothing the player can press changes what happens to them now.
    input.consumeAPress();
    input.consumeBPress();
  }


  update(dt, input) {
    // The scourge is a cutscene: it takes movement, both buttons and the
    // camera, and it decides how fast the rest of the abbey is allowed to run
    // while it plays — flames slow with the fifth lash and stop dead on every
    // impact, because a hit-stop that only freezes the fighters looks broken.
    if (this.scourge.active) { this._updateScourge(dt, input); return; }
    if (this.shrine.active) { this._updateShrine(dt, input); return; }
    if (this.vigil.active) { this._updateVigil(dt, input); return; }

    this.t += dt;

    // While the box is up it owns the controls: the world keeps rendering
    // behind it but nothing walks, and A/B belong to the text.
    if (this.dialogue.active) { this.dialogue.update(dt, input); return; }

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

    }

    // POSITION IS REPORTED WHETHER OR NOT YOU ARE WALKING.
    //
    // This emit used to sit inside the `moving` branch, so a player standing
    // still told the server nothing — and standing still is exactly what
    // performing a rite looks like. The server's view of where you are then
    // dates from the last step you took, which mostly lands on arrival and is
    // wrong the moment anything moves you without input: the shrine's own
    // dance walks a circuit around the skull and never touches this branch.
    //
    // Since the server now decides whether you are standing where a rite is
    // performed, "mostly right" is not good enough. Fast while walking, slow
    // while still: 12.5 Hz costs what it always did, and a stationary player
    // is a heartbeat rather than silence.
    this.lastEmittedMove += dt;
    const gap = p.moving ? 0.08 : 1.0;
    if (this.socket && this.lastEmittedMove > gap) {
      this.lastEmittedMove = 0;
      this.socket.emit('move', { x: p.x, y: p.y, dir: p.dir });
    }
    this._checkStairs();
    this.fire.update(dt);
    this.sticks.update(dt);
    this.shrine.update(dt);
    this._updateSpeech();
    if (this.crowd.length) this._updateCrowd(dt);
    this._updateCamera(dt);

    for (let i = this.footDust.length - 1; i >= 0; i--) {
      this.footDust[i].t += dt;
      if (this.footDust[i].t > 0.5) this.footDust.splice(i, 1);
    }

    const prevStation = this._activeStation;
    this._activeStation = this._nearestStation();
    // stepping off a station re-arms its reading for the next approach
    if (prevStation && this._activeStation !== prevStation) this._lastIntro = null;

    if (input.consumeAPress()) {
      if (this._shrineAction()) {
        // knelt to the shrine
      } else if (this._stickAction()) {
        // took a switch from the bundle
      } else if (this._fireAction()) {
        // handled by the fire rite
      } else if (this._activeStation && this._activeStation.kind === 'board') {
        // The board is READ, not performed, and it is the one station whose
        // whole point is that its numbers are current. So it re-reads the row
        // rather than showing whatever was true when the player walked in —
        // the same staleness that once hid a referral's Devotion.
        this._readBoard();
      } else if (this._activeStation) {
        // Every station introduces itself before it acts. The box closes into
        // the rite, so reading is never a detour — it is the way in.
        const st = this._activeStation;
        const intro = this._introFor(st);
        const key = `${st.id}|${this.carrying ? this.carrying.kind : ''}`;
        // A station reads itself once per approach; pressing A again performs
        // the rite without making the player sit through the text a second
        // time. The BED is exempt, and must be: that shortcut turns the second
        // press into an unprompted save-and-exit, so answering "No" and then
        // pressing A again ended the day with no question asked at all — which
        // is precisely what the question exists to prevent. It always asks.
        const isBed = st.kind === 'bed';
        if (intro && (isBed || this._lastIntro !== key)) {
          this._lastIntro = key;
          // The bed is the one station that asks before it acts: lying down
          // ends the day and drops the player out of the abbey, which is not
          // something to do to somebody who pressed A walking past. Every
          // other station reads, closes, and runs.
          if (isBed) {
            this.dialogue.show([intro], {
              choices: ['Yes', 'No'],
              onChoice: (i) => { if (i === 0) this._runStation(st); },
              ...boxOpts(st),
            });
          } else {
            this.dialogue.show([intro], { onClose: () => this._runStation(st), ...boxOpts(st) });
          }
        } else {
          this._runStation(this._activeStation);
        }
      } else {
        // A pressed with nothing in range: it DID register — give feedback so it
        // never feels dead. Rate-limited so tapping while walking isn't spammy.
        this._noActionHint(dt);
      }
    }
    if (input.consumeBPress()) {
      if (this._dropCarried()) { /* put it down */ }
      else this._noActionHint(dt);
    }

    if (this.localEmoji) {
      this.localEmoji.t -= dt;
      if (this.localEmoji.t <= 0) this.localEmoji = null;
    }
    if (this.localChat) {
      this.localChat.t -= dt;
      this.localChat.age += dt;
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

  // The tile layer, built in five passes. Each pass is one of the rules that
  // gives A Link to the Past its depth (see web/js/palette.js for the ramps):
  //   1. flagstone slabs — grout every TWO tiles, so the floor reads as big
  //      20px slabs instead of a busy 10px checkerboard
  //   2. the crimson aisle runner, with gold trim and a woven motif
  //   3. wall mass — staggered masonry courses seen from above
  //   4. the lit south FACE of any wall that fronts open floor, which is what
  //      makes the 3/4 view feel like a built space rather than a floorplan
  //   5. contact shadow: the floor darkens hard where it meets a wall
  _drawFloor(ctx, c0, r0, c1, r1) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(c, r);
        const x = c * TILE, y = r * TILE;
        const n = h2(c, r);
        if (ch === '.' || ch === 'c') {
          const R = ch === '.' ? FLOOR : EARTH;
          const v = h2(c >> 1, r >> 1) % 3;
          ctx.fillStyle = v === 0 ? R.b : v === 1 ? shade(R.b, -9) : shade(R.b, 7);
          ctx.fillRect(x, y, TILE, TILE);
          // Slab seams every TWO tiles: a dark grout line on the near side of
          // each 20px slab and a much subtler lit lip on the far side. The lip
          // is deliberately only one step above base — at full R.l the floor
          // turns into a bright lattice and stops reading as stone.
          if (r % 2 === 1) { ctx.fillStyle = R.o; ctx.fillRect(x, y + TILE - 2, TILE, 2); }
          else { ctx.fillStyle = shade(R.b, 16); ctx.fillRect(x, y, TILE, 1); }
          if (c % 2 === 1) { ctx.fillStyle = R.d; ctx.fillRect(x + TILE - 1, y, 1, TILE); }
          else { ctx.fillStyle = shade(R.b, 10); ctx.fillRect(x, y, 1, TILE); }
          if (n % 17 === 0) { ctx.fillStyle = R.d; ctx.fillRect(x + 3, y + 4, 4, 1); }  // hairline crack
          if (n % 23 === 0) { ctx.fillStyle = R.h; ctx.fillRect(x + 5, y + 2, 2, 2); }  // mica fleck
        } else if (ch !== '#') {
          // void, and the exit threshold cut through the south wall — both black
          ctx.fillStyle = VOID;
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }

    this._drawRunner(ctx);

    // --- wall mass: staggered 20x10 courses, seen from above ---
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) !== '#') continue;
        const x = c * TILE, y = r * TILE;
        const v = h2(c >> 1, r) % 3;
        ctx.fillStyle = v === 0 ? WALL.d : v === 1 ? shade(WALL.d, -7) : shade(WALL.d, 6);
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = shade(WALL.d, 14); ctx.fillRect(x, y, TILE, 1.6);
        ctx.fillStyle = WALL.o;
        ctx.fillRect(x, y + TILE - 2, TILE, 2);          // course grout
        ctx.fillRect(x + (r % 2) * 5, y, 2, TILE);        // staggered joint
      }
    }

    // --- the lit face of a wall that fronts open floor ---
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) !== '#') continue;
        const below = tileAt(c, r + 1);
        if (below !== '.' && below !== 'c') continue;
        const x = c * TILE, y = r * TILE;
        ctx.fillStyle = WALL.o; ctx.fillRect(x, y - 1, TILE, TILE + 1);
        ctx.fillStyle = WALL.b; ctx.fillRect(x, y + 1, TILE, TILE - 3);
        ctx.fillStyle = WALL.l; ctx.fillRect(x, y + 1, TILE, 2.4);
        ctx.fillStyle = WALL.h; ctx.fillRect(x, y + 1, 3.5, 1.2);
        ctx.fillStyle = WALL.d; ctx.fillRect(x, y + TILE - 4, TILE, 2);
        ctx.fillStyle = WALL.o; ctx.fillRect(x + ((c % 2) ? 3 : 7), y + 3.4, 1.6, TILE - 7);
      }
    }

    // --- silhouette rim against the void, so the mass reads as solid ---
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, r) !== '#') continue;
        const x = c * TILE, y = r * TILE;
        if (tileAt(c, r - 1) === ' ') {
          ctx.fillStyle = WALL.o; ctx.fillRect(x, y, TILE, 2);
          ctx.fillStyle = shade(WALL.d, 10); ctx.fillRect(x, y + 2, TILE, 1);
        }
        if (tileAt(c - 1, r) === ' ') { ctx.fillStyle = WALL.o; ctx.fillRect(x, y, 2, TILE); }
        if (tileAt(c + 1, r) === ' ') { ctx.fillStyle = WALL.o; ctx.fillRect(x + TILE - 2, y, 2, TILE); }
      }
    }

    // --- contact shadow where the floor meets a wall ---
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = tileAt(c, r);
        if (ch !== '.' && ch !== 'c') continue;
        const x = c * TILE, y = r * TILE;
        if (tileAt(c, r - 1) === '#') { ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fillRect(x, y, TILE, 4); }
        if (tileAt(c - 1, r) === '#') { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, y, 3, TILE); }
        if (tileAt(c + 1, r) === '#') { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(x + TILE - 3, y, 3, TILE); }
      }
    }
  }

  // The crimson aisle runner down the nave: dark edge, base, one lit edge,
  // gold piping and a sparse woven diamond. Crimson + gold is the abbey's only
  // accent pair — nothing else in the palette is allowed to compete with it.
  _drawRunner(ctx) {
    const cx = px(NAVE_CX), w = 9;
    this._runnerBand(ctx, cx - w, NAVE.y0 * TILE, w * 2, NAVE.y1 * TILE - NAVE.y0 * TILE, false);

    // The arms of the cross. The runner now goes east and west along the
    // transept as well as down the nave, and each arm STOPS SHORT OF ITS
    // STAIRWELL — carpet laid over an opening in the floor is a trip, and the
    // stair heads are exactly where the arms would otherwise end.
    const armRow = STAIRS.length
      ? STAIRS.reduce((r, s) => (s.row < r ? s.row : r), STAIRS[0].row) : TRANSEPT.y0 + 6;
    const inTransept = STAIRS.filter((s) => s.col >= TRANSEPT.x0 && s.col <= TRANSEPT.x1);
    const westStair = inTransept.reduce((a, s) => (s.col < a ? s.col : a), TRANSEPT.x1);
    const eastStair = inTransept.reduce((a, s) => (s.col > a ? s.col : a), TRANSEPT.x0);
    // one clear tile between the pile of the carpet and the first step
    const ax0 = (westStair + 2) * TILE;
    const ax1 = (eastStair - 1) * TILE;
    const cy = px(armRow);
    if (ax1 > ax0) this._runnerBand(ctx, ax0, cy - w, ax1 - ax0, w * 2, true);
  }

  // One band of runner: dark edge, base, one lit edge, gold piping and a sparse
  // woven diamond. Drawn along its own axis so the nave and the transept arms
  // are the same carpet turned, not two different ones that happen to be red.
  _runnerBand(ctx, x, y, w, h, horizontal) {
    // The runner sits a step DOWN the blood ramp from its accent value —
    // at full BLOOD.b a stripe this long swamps every other thing in the room.
    ctx.fillStyle = 'rgba(0,0,0,0.30)';                                     // contact shadow
    if (horizontal) ctx.fillRect(x, y - 2, w, h + 4);
    else ctx.fillRect(x - 2, y, w + 4, h);
    ctx.fillStyle = BLOOD.o; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = BLOOD.d;
    ctx.fillRect(horizontal ? x : x + 1.5, horizontal ? y + 1.5 : y,
      horizontal ? w : w - 3, horizontal ? h - 3 : h);
    ctx.fillStyle = BLOOD.b;                                                // lit edge
    if (horizontal) ctx.fillRect(x, y + 1.5, w, 1.2);
    else ctx.fillRect(x + 1.5, y, 1.2, h);
    ctx.fillStyle = GOLD.o;                                                 // piping
    if (horizontal) {
      ctx.fillRect(x, y + 3.4, w, 0.8);
      ctx.fillRect(x, y + h - 4.2, w, 0.8);
    } else {
      ctx.fillRect(x + 3.4, y, 0.8, h);
      ctx.fillRect(x + w - 4.2, y, 0.8, h);
    }
    const mid = horizontal ? y + h / 2 : x + w / 2;
    const from = (horizontal ? x : y) + 8;
    const to = (horizontal ? x + w : y + h) - 8;
    for (let d = from; d < to; d += 28) {
      const dx = horizontal ? d : mid;
      const dy = horizontal ? mid : d;
      ctx.fillStyle = GOLD.o;
      ctx.beginPath();
      ctx.moveTo(dx, dy); ctx.lineTo(dx + 2.4, dy + 3.2);
      ctx.lineTo(dx, dy + 6.4); ctx.lineTo(dx - 2.4, dy + 3.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = GOLD.d; ctx.fillRect(dx - 0.8, dy + 2.6, 1.6, 1.2);
    }
  }

  // Violet ellipse shadow, offset down-right to imply one consistent light
  // angle (upper-left) across every solid prop in the abbey. LttP never drops
  // a neutral black shadow onto a coloured floor.
  _dropShadow(ctx, x, y, rx, ry, soft = false) {
    ctx.fillStyle = soft ? SHADOW_SOFT : SHADOW;
    ctx.beginPath();
    ctx.ellipse(x + 1.3, y + 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPillar(ctx, col, row) {
    const x = col * TILE, y = row * TILE, cx = x + TILE / 2;
    this._dropShadow(ctx, cx, y + TILE - 1, 6.5, 2.4);
    block(ctx, x, y - TILE * 0.6, TILE, TILE * 1.6, WALL);
    // gilded capital, then a lit flute down the shaft
    ctx.fillStyle = GOLD.d; ctx.fillRect(x - 1, y - TILE * 0.6, TILE + 2, 3);
    ctx.fillStyle = GOLD.b; ctx.fillRect(x - 1, y - TILE * 0.6, TILE + 2, 1.6);
    ctx.fillStyle = GOLD.h; ctx.fillRect(x - 1, y - TILE * 0.6, 3.5, 0.8);
    ctx.fillStyle = WALL.o; ctx.fillRect(x - 1, y - TILE * 0.6 + 3, TILE + 2, 1);
    ctx.fillStyle = WALL.h; ctx.fillRect(x + 2.5, y - TILE * 0.6 + 4.5, 1.6, TILE * 1.35);
    ctx.fillStyle = WALL.o; ctx.fillRect(x, y + TILE - 3, TILE, 3);
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
    ctx.fillStyle = IRON.o;                                  // hood
    ctx.fillRect(x - 3.5, topY - 0.5, 7, 2.5);
    ctx.fillStyle = IRON.b; ctx.fillRect(x - 3.5, topY - 0.5, 7, 1);
    ctx.fillStyle = `rgba(255, 200, 110, ${0.55 + flick * 0.25})`;
    ctx.fillRect(x - 2.3, topY + 2, 4.6, 5);                 // lit glass
    ctx.fillStyle = FIRE.core; ctx.fillRect(x - 1, topY + 3.4, 2, 2.4);
    ctx.fillStyle = IRON.o;                                  // cames + base
    ctx.fillRect(x - 2.8, topY + 1.6, 0.9, 5.4);
    ctx.fillRect(x + 1.9, topY + 1.6, 0.9, 5.4);
    ctx.fillRect(x - 3.2, topY + 7, 6.4, 1.8);
    ctx.fillStyle = GOLD.d; ctx.fillRect(x - 3.2, topY + 7, 6.4, 0.8);
    const glow = ctx.createRadialGradient(x, topY + 4, 1, x, topY + 4, 10);
    glow.addColorStop(0, `rgba(255, 190, 100, ${0.16 + flick * 0.08})`);
    glow.addColorStop(1, 'rgba(255, 190, 100, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 10, topY - 6, 20, 20);
    this._drawDustMotes(ctx, x, topY + 4, col * 3 + row);
  }

  _drawTorch(ctx, col, row) {
    const x = col * TILE + TILE / 2, y = row * TILE + 2;
    this._dropShadow(ctx, x, y + 6, 4, 1.8);
    ctx.fillStyle = WOOD.o; ctx.fillRect(x - 2.5, y - 3, 5, 10);   // haft
    ctx.fillStyle = WOOD.b; ctx.fillRect(x - 1.6, y - 3, 3.2, 9);
    ctx.fillStyle = WOOD.l; ctx.fillRect(x - 1.6, y - 3, 1, 9);
    ctx.fillStyle = IRON.o; ctx.fillRect(x - 2.6, y - 4, 5.2, 2);  // iron collar
    ctx.fillStyle = IRON.b; ctx.fillRect(x - 2.6, y - 4, 5.2, 0.9);
    flame(ctx, x, y - 7, 0.85, this.t, col * 2.3 + row * 1.7);
    this._drawDustMotes(ctx, x, y - 7, col * 3 + row);
  }

  _drawFountain(ctx, col, row) {
    const x = (col - 1) * TILE, y = (row - 1) * TILE, s = TILE * 3;
    const cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2;
    this._dropShadow(ctx, cx, y + s - 2, s / 2 - 1, 3);
    block(ctx, x, y, s, s, WALL);                       // dressed stone basin
    ctx.fillStyle = GOLD.d; ctx.fillRect(x, y, s, 2);   // gilded coping
    ctx.fillStyle = GOLD.b; ctx.fillRect(x, y, s, 0.9);
    ctx.fillStyle = SOUL.o; ctx.fillRect(x + 3, y + 3, s - 6, s - 6);
    ctx.fillStyle = SOUL.d; ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
    const shimmer = (Math.sin(this.t * 3) + 1) / 2;
    ctx.fillStyle = `rgba(154, 114, 220, ${0.35 + shimmer * 0.35})`;
    ctx.fillRect(x + 6, y + 6, s - 12, s - 12);
    // ripple rings expanding out from center and fading
    for (let i = 0; i < 3; i++) {
      const phase = (this.t * 0.6 + i / 3) % 1;
      const r = phase * (s / 2 - 4);
      ctx.strokeStyle = `rgba(200, 174, 242, ${(1 - phase) * 0.35})`;
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

  // --- STATUARY ------------------------------------------------------------
  // Eight figures set into the walls of the cross, cut from the STONE ramp
  // above because that is what they were cut from: BONE appears only where
  // centuries of hands have rubbed the stone pale, and BLOOD only in the eyes.
  // Nothing else is allowed in, or the abbey gains a third accent and loses the
  // crimson-and-gold pairing everywhere else depends on.
  //
  // Each figure is drawn facing east and mirrored by `face`, but the lit edge
  // is painted afterwards in world space, so the abbey's one light angle
  // survives the mirror instead of flipping with it.
  _drawStatue(ctx, x, y, kind, face, seed) {
    const pulse = 0.26 + Math.sin(this.t * 1.3 + seed * 2.7) * 0.13;
    // the wall's own shadow, cast down beneath whatever juts out of it
    ctx.fillStyle = 'rgba(14,10,26,0.34)';
    ctx.beginPath(); ctx.ellipse(x + 1, y + 6.5, 5.5, 1.8, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(face >= 0 ? 1 : -1, 1);
    let box;
    if (kind === 'saint') box = this._statueSaint(ctx, pulse, seed);
    else if (kind === 'grotesque') box = this._statueGrotesque(ctx, pulse, seed);
    else box = this._statueGargoyle(ctx, pulse, seed);
    ctx.restore();

    ctx.fillStyle = STONE.l;
    ctx.fillRect(x + box.left, y + box.top + 2, 1, (box.bot - box.top) - 4);
    ctx.fillStyle = STONE.h;
    ctx.fillRect(x + box.left, y + box.top + 2, 1, 3);
  }

  // A crouched winged beast on a corbel: haunches, folded spiked wings, a
  // snouted head thrust out over the floor, and claws hooked over the lip so
  // it reads as holding on rather than resting.
  _statueGargoyle(ctx, pulse) {
    const TAU = Math.PI * 2;
    block(ctx, -5, 2, 10, 4, STONE);                       // the corbel it squats on
    // Wings first, and swept BACK rather than up — a fan rising straight off
    // the shoulders reads as a crest, which is the one silhouette a gargoyle
    // must not have.
    ctx.fillStyle = STONE.o;
    ctx.beginPath();
    ctx.moveTo(-1.4, -1.5); ctx.lineTo(-5.2, -11.5); ctx.lineTo(-3.4, -9.2);
    ctx.lineTo(-3.0, -11.8); ctx.lineTo(-1.2, -8.4); ctx.lineTo(-0.8, -10.4);
    ctx.lineTo(0.8, -5.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.d;
    ctx.beginPath();
    ctx.moveTo(-1.6, -2.6); ctx.lineTo(-4.4, -10.2); ctx.lineTo(-3.2, -8.6);
    ctx.lineTo(-2.9, -10.4); ctx.lineTo(-1.5, -8); ctx.lineTo(-1.2, -9.4);
    ctx.lineTo(0.1, -5.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.o;                               // tail, curled down behind
    ctx.beginPath();
    ctx.moveTo(-3.6, -3.4); ctx.lineTo(-6.2, 0.4); ctx.lineTo(-4.6, 1.8);
    ctx.lineTo(-4.4, 0.2); ctx.lineTo(-2.4, -2.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.o;                               // haunches, wider than tall
    ctx.beginPath(); ctx.ellipse(-0.8, -2.4, 4.4, 3.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = STONE.b;
    ctx.beginPath(); ctx.ellipse(-0.8, -2.4, 3.5, 2.9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = STONE.d;                               // hunched shoulder over the neck
    ctx.beginPath(); ctx.ellipse(1.2, -4.2, 2.4, 1.9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = STONE.d;                               // a foreleg braced on the lip
    ctx.fillRect(1.8, -3.4, 1.8, 5);
    ctx.fillStyle = STONE.o; ctx.fillRect(1.6, -3.4, 0.6, 5);
    ctx.fillStyle = STONE.o;                               // head on a short neck, thrust out
    ctx.beginPath(); ctx.ellipse(3.2, -7, 2.9, 2.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath();                                      // muzzle, blunt not beaked
    ctx.moveTo(4.4, -8.4); ctx.lineTo(7.2, -7.4); ctx.lineTo(7.2, -4.8); ctx.lineTo(4.4, -4.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.b;
    ctx.beginPath(); ctx.ellipse(3.2, -7, 2.1, 1.8, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4.4, -8); ctx.lineTo(6.4, -7.1); ctx.lineTo(6.4, -5.4); ctx.lineTo(4.4, -5.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = VOID; ctx.fillRect(4.4, -6.5, 2.6, 0.9);    // mouth, open a crack
    ctx.fillStyle = BONE.d;                                     // and a tooth in it
    ctx.fillRect(5.4, -6.5, 0.6, 0.9); ctx.fillRect(6.4, -6.5, 0.5, 0.9);
    ctx.fillStyle = STONE.d;                               // two back-swept horns
    ctx.beginPath(); ctx.moveTo(2.4, -8.8); ctx.lineTo(0.4, -12); ctx.lineTo(3.2, -8.6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4.2, -8.6); ctx.lineTo(3.4, -11.4); ctx.lineTo(5.1, -8.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = BONE.d;                               // claws hooked over the corbel lip
    for (let i = 0; i < 3; i++) ctx.fillRect(1.4 + i * 1.6, 1.4, 1, 2.2);
    ctx.fillStyle = `rgba(232,90,74,${pulse})`;           // the eye that follows you
    ctx.beginPath(); ctx.arc(4.2, -7.4, 0.9, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(247,154,120,${pulse * 1.4})`;
    ctx.beginPath(); ctx.arc(4.2, -7.4, 0.4, 0, TAU); ctx.fill();
    return { top: -12, bot: 6, left: -5.2 };
  }

  // A robed column figure on a plinth. The hood is empty — a hollow of
  // outline-dark stone where a face should be — which does more work than any
  // carved expression would at ten pixels to the tile.
  _statueSaint(ctx) {
    const TAU = Math.PI * 2;
    block(ctx, -4.5, 3, 9, 3.4, STONE);                    // plinth
    ctx.fillStyle = STONE.o;                               // robe, a tapering column
    ctx.beginPath();
    ctx.moveTo(-4.2, 3); ctx.lineTo(-3.2, -8.6); ctx.lineTo(3.2, -8.6); ctx.lineTo(4.2, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.b;
    ctx.beginPath();
    ctx.moveTo(-3.2, 2.6); ctx.lineTo(-2.4, -8); ctx.lineTo(2.4, -8); ctx.lineTo(3.2, 2.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.d;                               // folds
    ctx.fillRect(-1.5, -7, 0.7, 9); ctx.fillRect(0.9, -7, 0.7, 9);
    ctx.fillStyle = STONE.o;                               // cowl draped over the shoulders
    ctx.beginPath();
    ctx.moveTo(-3.6, -7.6); ctx.lineTo(-2.2, -11.2); ctx.lineTo(2.2, -11.2); ctx.lineTo(3.6, -7.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.d;
    ctx.beginPath();
    ctx.moveTo(-2.9, -8.2); ctx.lineTo(-1.8, -10.8); ctx.lineTo(1.8, -10.8); ctx.lineTo(2.9, -8.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.o;                               // hood, peaked
    ctx.beginPath();
    ctx.moveTo(-2.4, -10.4); ctx.lineTo(-2.0, -13.6); ctx.lineTo(0, -15.2);
    ctx.lineTo(2.0, -13.6); ctx.lineTo(2.4, -10.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.b;
    ctx.beginPath();
    ctx.moveTo(-1.9, -10.6); ctx.lineTo(-1.5, -13.2); ctx.lineTo(0, -14.4);
    ctx.lineTo(1.5, -13.2); ctx.lineTo(1.9, -10.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.o;                               // the hollow where a face is not
    ctx.beginPath(); ctx.ellipse(0.3, -11.8, 1.2, 1.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = BONE.d;                               // hands clasped, rubbed pale
    ctx.beginPath(); ctx.ellipse(0.3, -5.2, 1.2, 0.95, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = STONE.o; ctx.fillRect(-0.9, -6.6, 2.6, 0.7);  // sleeve mouths
    ctx.fillStyle = 'rgba(138,128,105,0.24)';             // weathering streak
    ctx.fillRect(-2.5, -6, 0.8, 8);
    ctx.fillStyle = STONE.o;                               // a shoulder chipped away
    ctx.beginPath(); ctx.moveTo(2.4, -10.8); ctx.lineTo(3.9, -8.4); ctx.lineTo(2.5, -8.2); ctx.closePath(); ctx.fill();
    return { top: -15.2, bot: 6.4, left: -4.4 };
  }

  // A screaming face and nothing else — a mouth cut clean through to the void
  // behind the wall, with the rain-stain of a downspout that has not run in
  // three hundred years still under it.
  _statueGrotesque(ctx, pulse) {
    const TAU = Math.PI * 2;
    ctx.fillStyle = STONE.o;                               // the corbel it is carved on
    ctx.beginPath();
    ctx.moveTo(-4.6, -8.6); ctx.lineTo(5.2, -7); ctx.lineTo(4.4, 5); ctx.lineTo(-4.6, 5.6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.b;
    ctx.beginPath();
    ctx.moveTo(-3.9, -7.8); ctx.lineTo(4.5, -6.4); ctx.lineTo(3.8, 4.3); ctx.lineTo(-3.9, 4.9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.d; ctx.fillRect(-3.4, -6, 7.6, 1.8);     // brow ridge
    ctx.fillStyle = STONE.l; ctx.fillRect(-3.4, -6, 7.6, 0.6);
    ctx.fillStyle = STONE.o;                               // deep-set eyes
    ctx.beginPath(); ctx.ellipse(-1.5, -3.4, 1.4, 1.2, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2.2, -3.1, 1.4, 1.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(232,90,74,${pulse * 0.8})`;
    ctx.beginPath(); ctx.arc(-1.4, -3.4, 0.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(2.3, -3.1, 0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = STONE.d;                               // nose, broken off flat
    ctx.beginPath(); ctx.moveTo(0.4, -3); ctx.lineTo(1.5, -0.5); ctx.lineTo(-0.5, -0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = STONE.o;                               // cheeks pulled back off the jaw
    ctx.fillRect(-3.4, 0.4, 7.4, 0.7);
    ctx.fillStyle = VOID;                                 // the mouth, open and going nowhere
    ctx.beginPath(); ctx.ellipse(0.4, 2.1, 2.5, 1.9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = BONE.d;                               // teeth
    for (let i = 0; i < 4; i++) ctx.fillRect(-1.5 + i * 1.1, 0.6, 0.7, 1.1);
    ctx.fillStyle = 'rgba(58,50,38,0.30)';                // three centuries of rain
    ctx.fillRect(-2.6, -1.2, 0.8, 6); ctx.fillRect(3, -0.8, 0.7, 5.2);
    return { top: -8.6, bot: 5.6, left: -4.9 };
  }

  _drawProp(ctx, p) {
    const x = p.col * TILE + TILE / 2, y = p.row * TILE + TILE / 2;
    switch (p.type) {
      case 'statue': this._drawStatue(ctx, x, y, p.kind, p.face, h2(p.col, p.row)); break;
      case 'fountain': this._drawFountain(ctx, p.col, p.row); break;
      case 'fountain-block': break; // covered by the fountain draw above
      case 'booth-block': break;    // covered by the confessional draw below
      case 'shrine-block': break;   // the shrine is scene-owned, not a prop
      case 'confessional': this._drawConfessional(ctx, x, y); break;
      case 'pillar': this._drawPillar(ctx, p.col, p.row); this._drawLantern(ctx, p.col, p.row); break;
      case 'torch': this._drawTorch(ctx, p.col, p.row); break;
      case 'brazier': {
        const key = `${p.col},${p.row}`;
        const lit = this.litBraziers.has(key);
        this._dropShadow(ctx, x, y + 6, 7, 2.6);
        ctx.fillStyle = IRON.o;                    // tripod legs
        ctx.fillRect(x - 5.5, y - 1, 2, 8); ctx.fillRect(x + 3.5, y - 1, 2, 8); ctx.fillRect(x - 1, y - 1, 2, 8);
        ctx.fillStyle = IRON.d;
        ctx.fillRect(x - 5, y - 1, 1, 7); ctx.fillRect(x + 4, y - 1, 1, 7);
        ctx.fillStyle = IRON.o;                    // bowl, outlined then filled
        ctx.beginPath(); ctx.moveTo(x - 7, y - 3); ctx.lineTo(x + 7, y - 3);
        ctx.lineTo(x + 4.5, y + 2.5); ctx.lineTo(x - 4.5, y + 2.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = IRON.b;
        ctx.beginPath(); ctx.moveTo(x - 6, y - 2); ctx.lineTo(x + 6, y - 2);
        ctx.lineTo(x + 4, y + 1.5); ctx.lineTo(x - 4, y + 1.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = GOLD.d; ctx.fillRect(x - 7, y - 4, 14, 2);   // gilded rim
        ctx.fillStyle = GOLD.b; ctx.fillRect(x - 7, y - 4, 14, 1);
        ctx.fillStyle = GOLD.h; ctx.fillRect(x - 7, y - 4, 4, 0.8);
        // The bowl shows exactly its own state and nothing else: empty iron,
        // wood waiting, or fire. That is the only instruction the player gets.
        const ai = ALCOVES.findIndex((a) => a.brazier.col === p.col && a.brazier.row === p.row);
        if (ai >= 0 && this.fire.isLit(ai)) this.fire.drawFlame(ctx, x, y - 7, ai, this.t);
        else if (ai >= 0 && this.fire.isLaid(ai)) this.fire.drawLaid(ctx, x, y);
        break;
      }
      case 'wood-stack': {
        this._dropShadow(ctx, x, y + 4, 5.5, 2);
        for (let i = 0; i < 3; i++) {
          block(ctx, x - 5, y - 3 + i * 2.6, 10, 2.2, WOOD);
          ctx.fillStyle = WOOD.o;                  // sawn ends, darkest step
          ctx.fillRect(x - 5, y - 3 + i * 2.6, 1.4, 2.2);
          ctx.fillRect(x + 3.6, y - 3 + i * 2.6, 1.4, 2.2);
        }
        break;
      }
      // A cot: plank frame, a straw pallet, and a folded blanket at the foot.
      // Wood and cloth only — nothing in a cell is gilded.
      case 'bed': {
        this._dropShadow(ctx, x, y + 6, 9, 3);
        block(ctx, x - 8, y - 7, 16, 14, WOOD);          // the frame
        ctx.fillStyle = WOOD.o;                           // the four posts
        ctx.fillRect(x - 8, y - 8, 2, 3); ctx.fillRect(x + 6, y - 8, 2, 3);
        ctx.fillRect(x - 8, y + 5, 2, 3); ctx.fillRect(x + 6, y + 5, 2, 3);
        ctx.fillStyle = BONE.d;                           // straw pallet
        ctx.fillRect(x - 6, y - 5, 12, 10);
        ctx.fillStyle = BONE.b; ctx.fillRect(x - 6, y - 5, 12, 3);
        ctx.fillStyle = BONE.h; ctx.fillRect(x - 6, y - 5, 5, 1);
        ctx.fillStyle = CLOTH.b;                          // blanket, folded back
        ctx.fillRect(x - 6, y + 1, 12, 4);
        ctx.fillStyle = CLOTH.d; ctx.fillRect(x - 6, y + 4, 12, 1);
        ctx.fillStyle = CLOTH.l; ctx.fillRect(x - 6, y + 1, 12, 0.9);
        ctx.fillStyle = BONE.h;                           // a thin pillow
        ctx.fillRect(x - 5, y - 4.4, 4.5, 2.6);
        ctx.fillStyle = BONE.d; ctx.fillRect(x - 5, y - 2.2, 4.5, 0.8);
        break;
      }
      case 'bench': {
        this._dropShadow(ctx, x, y + 5, 8.5, 2.6);
        block(ctx, x - 7, y - 5, 14, 2.6, WOOD);   // back rail
        block(ctx, x - 7, y - 1, 14, 4.6, WOOD);   // seat plank
        ctx.fillStyle = WOOD.o;                    // legs
        ctx.fillRect(x - 6, y + 4, 2, 3); ctx.fillRect(x + 4, y + 4, 2, 3);
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
        block(ctx, x - 11, y - 2, 22, 11, WALL);   // dressed stone body
        block(ctx, x - 13, y - 6, 26, 5, BLOOD);   // blood-red cloth
        ctx.fillStyle = GOLD.b; ctx.fillRect(x - 13, y - 1.6, 26, 1.2);  // gold hem
        ctx.fillStyle = GOLD.l; ctx.fillRect(x - 13, y - 1.6, 26, 0.6);
        // INVERTED cross (crossbar low on the stem), tarnished iron
        ctx.fillStyle = IRON.o;
        ctx.fillRect(x - 2.2, y - 23, 4.4, 18); ctx.fillRect(x - 6, y - 11, 12, 4);
        ctx.fillStyle = IRON.b;
        ctx.fillRect(x - 1.4, y - 22, 2.8, 16); ctx.fillRect(x - 5, y - 10, 10, 2.4);
        ctx.fillStyle = IRON.h; ctx.fillRect(x - 1.4, y - 22, 1, 16);    // lit left edge
        ctx.fillStyle = BLOOD.l; ctx.fillRect(x + 0.6, y - 22, 0.8, 16); // red rim-light
        ctx.fillStyle = `rgba(232,90,74,${glowA})`; // ember at its foot
        ctx.beginPath(); ctx.arc(x, y - 4, 2.2, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 2; i++) {
          const phase = (this.t * 0.2 + i * 0.5) % 1;
          const sx = x + Math.sin(this.t * 0.6 + i * 2) * (2 + phase * 3);
          const sy = y - 6 - phase * 18;
          const sa = Math.sin(phase * Math.PI) * 0.22;
          ctx.fillStyle = `rgba(232,90,74,${sa})`;
          ctx.beginPath(); ctx.arc(sx, sy, 1 + phase * 1.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'pew': {
        // a long church pew: seat plank, back rail, end posts, grain
        this._dropShadow(ctx, x, y + 5, 9, 2.6);
        block(ctx, x - 8, y - 7, 16, 3, WOOD);     // back rail
        block(ctx, x - 8, y - 2, 16, 6, WOOD);     // seat plank
        ctx.fillStyle = WOOD.o;                    // end posts
        ctx.fillRect(x - 8, y - 7, 2, 11); ctx.fillRect(x + 6, y - 7, 2, 11);
        ctx.fillStyle = WOOD.d; ctx.fillRect(x - 5, y + 0.6, 10, 0.8); // grain
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
        block(ctx, x - 9, y - 7, 18, 14, WALL);    // stone body
        block(ctx, x - 10, y - 9, 20, 3, WALL);    // mantel
        ctx.fillStyle = WALL.o;                    // firebox mouth
        ctx.fillRect(x - 6, y - 3, 12, 9);
        ctx.fillStyle = VOID; ctx.fillRect(x - 5, y - 2, 10, 7);
        ctx.fillStyle = FIRE.mid;                  // flames
        ctx.globalAlpha = flick;
        ctx.beginPath(); ctx.ellipse(x - 2, y + 2, 2, 3.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = FIRE.hot;
        ctx.beginPath(); ctx.ellipse(x, y + 2.6, 1.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = FIRE.core;
        ctx.beginPath(); ctx.ellipse(x, y + 3.2, 0.8, 1.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'bed': {
        // monk's cot: timber frame, wool blanket, cream pillow
        this._dropShadow(ctx, x, y + 7, 7.5, 2.8);
        block(ctx, x - 6, y - 8, 12, 16, WOOD);    // timber frame
        block(ctx, x - 5, y - 2, 10, 9, CLOTH);    // undyed wool blanket
        ctx.fillStyle = CLOTH.o;                   // fold seams
        ctx.fillRect(x - 5, y + 2, 10, 0.7);
        ctx.fillRect(x - 5, y + 4.5, 10, 0.7);
        ctx.fillStyle = BONE.o; ctx.fillRect(x - 4.5, y - 6.5, 9, 5);   // pillow
        ctx.fillStyle = BONE.l; ctx.fillRect(x - 4, y - 6, 8, 4);
        ctx.fillStyle = BONE.h; ctx.fillRect(x - 4, y - 6, 8, 1.2);
        break;
      }
      case 'rock':
        this._dropShadow(ctx, x, y + 1, 4.4, 1.8);
        ctx.fillStyle = WALL.o;
        ctx.beginPath(); ctx.ellipse(x, y, 4.2, 3.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = WALL.b;
        ctx.beginPath(); ctx.ellipse(x, y, 3.4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = WALL.h;
        ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.4, 0.9, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'bush':
        this._dropShadow(ctx, x, y + 1.5, 4.2, 1.8);
        ctx.fillStyle = MOSS.o;
        ctx.beginPath(); ctx.ellipse(x, y, 4, 3.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = MOSS.b;
        ctx.beginPath(); ctx.ellipse(x, y, 3.2, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = MOSS.l;
        ctx.beginPath(); ctx.ellipse(x - 1, y - 1, 1.6, 1.2, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'cathedral-alcove': {
        const room = this.cathedralRooms.get(p.roomId);
        const owned = !!(room && room.owner_id);
        this._dropShadow(ctx, x, y + 4, 6.5, 2.2);
        block(ctx, x - 6, y - 10, 12, 15, owned ? SOUL : WALL);
        ctx.fillStyle = owned ? GOLD.b : WALL.d;   // claimed alcoves get gilded
        ctx.fillRect(x - 6, y - 10, 12, 1.8);
        if (owned) {
          ctx.fillStyle = GOLD.h; ctx.fillRect(x - 6, y - 10, 4, 0.9);
          ctx.font = '3.4px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = BONE.h;
          const shortName = room.owner_name.split(' ').slice(-1)[0];
          ctx.fillText(shortName.slice(0, 8), x, y - 2);
        }
        break;
      }
      case 'candle': {
        // a black votive candle with a small warm flame + floor light pool
        const flick = 0.7 + Math.sin(this.t * 11 + p.col * 2.3 + p.row) * 0.2;
        const pool = ctx.createRadialGradient(x, y + 2, 0.5, x, y + 2, 12);
        pool.addColorStop(0, `rgba(255,170,80,${0.12 + flick * 0.08})`);
        pool.addColorStop(1, 'rgba(255,170,80,0)');
        ctx.fillStyle = pool;
        ctx.fillRect(x - 12, y - 10, 24, 24);
        ctx.fillStyle = IRON.o; ctx.fillRect(x - 1.6, y - 4, 3.2, 7);  // wax stick
        ctx.fillStyle = IRON.d; ctx.fillRect(x - 1.2, y - 4, 2.4, 7);
        ctx.fillStyle = IRON.b; ctx.fillRect(x - 1.2, y - 4, 0.8, 7);
        ctx.fillStyle = GOLD.o; ctx.fillRect(x - 2.6, y + 3, 5.2, 1.8); // brass foot
        ctx.fillStyle = GOLD.d; ctx.fillRect(x - 2.4, y + 3, 4.8, 0.9);
        candleFlame(ctx, x, y - 6, this.t, p.col * 2.3 + p.row);
        break;
      }
      case 'board-block': break;   // covered by the board draw above it
      case 'board': {
        // A slate on the wall, tall enough to read across the corridor. Gold
        // frame because gold is what the abbey uses for anything it wants
        // looked at, and ruled lines so it reads as a board of figures rather
        // than a door.
        const bx = x - 6, by = y - 5, bw = 12, bh = 22;
        this._dropShadow(ctx, x + 1, y + 16, 7, 2.2);
        ctx.fillStyle = '#0f0b14'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);   // shadow gap
        ctx.fillStyle = '#9a7018'; ctx.fillRect(bx, by, bw, bh);                    // gold frame
        ctx.fillStyle = '#1b1622'; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);    // slate
        ctx.fillStyle = 'rgba(247,221,147,0.30)';                                   // ruled figures
        for (let i = 0; i < 7; i++) {
          const w = 4 + (h2(p.col + i, p.row) % 5);
          ctx.fillRect(bx + 2, by + 3 + i * 2.6, w, 1);
        }
        ctx.fillStyle = 'rgba(247,221,147,0.75)';                                   // a heading rule
        ctx.fillRect(bx + 2, by + 2, bw - 4, 1);
        break;
      }
      case 'stair-down': {
        // dark stone steps descending into the crypt
        this._dropShadow(ctx, x, y + 5, 7.5, 2.4);
        ctx.fillStyle = WALL.o; ctx.fillRect(x - 7, y - 6, 14, 14);  // stone surround
        ctx.fillStyle = VOID; ctx.fillRect(x - 6, y - 5, 12, 12);    // mouth of the stairwell
        for (let i = 0; i < 4; i++) {              // receding lit step edges
          const a = 0.55 - i * 0.12;
          ctx.fillStyle = `rgba(107,84,136,${a})`;
          ctx.fillRect(x - 6 + i, y - 5 + i * 2.4, 12 - i * 2, 1.4);
        }
        ctx.fillStyle = 'rgba(198,43,48,0.12)';    // faint red glow from below
        ctx.fillRect(x - 5, y + 3, 10, 3);
        break;
      }
      case 'stair-up': {
        // stone steps rising back toward the church
        this._dropShadow(ctx, x, y + 5, 7.5, 2.4);
        ctx.fillStyle = EARTH.o; ctx.fillRect(x - 7, y - 6, 14, 14);
        ctx.fillStyle = VOID; ctx.fillRect(x - 6, y - 5, 12, 12);
        for (let i = 0; i < 4; i++) {
          const a = 0.28 + i * 0.11;
          ctx.fillStyle = `rgba(107,84,136,${a})`;
          ctx.fillRect(x - 6 + i, y + 4 - i * 2.4, 12 - i * 2, 1.4);
        }
        break;
      }
      case 'ossuary': {
        // a pile of skulls & bones
        this._dropShadow(ctx, x, y + 3, 7.5, 2.4);
        const skulls = [[-4, 1, 2.3], [3, 1, 2.3], [-1, -2, 2.6], [0, 3, 2.1]];
        ctx.fillStyle = BONE.o;                    // one outline pass under all
        for (const [sx, sy, rr] of skulls) {
          ctx.beginPath(); ctx.arc(x + sx, y + sy, rr + 0.7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = BONE.b;
        for (const [sx, sy, rr] of skulls) {
          ctx.beginPath(); ctx.arc(x + sx, y + sy, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = BONE.h;                    // lit from the upper left
        for (const [sx, sy, rr] of skulls) {
          ctx.beginPath(); ctx.arc(x + sx - rr * 0.35, y + sy - rr * 0.4, rr * 0.42, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = BONE.o;                    // eye sockets
        for (const [sx, sy] of [[-4.7, 1], [-3.2, 1], [2.3, 1], [3.8, 1], [-1.7, -2], [-0.3, -2]]) {
          ctx.fillRect(x + sx, y + sy - 0.4, 1, 1.2);
        }
        ctx.fillStyle = BONE.o; ctx.fillRect(x - 6.5, y + 3.6, 13, 2.2);  // long bones
        ctx.fillStyle = BONE.d; ctx.fillRect(x - 6, y + 4, 12, 1.4);
        break;
      }
      case 'ritual-circle': {
        // a glowing red sigil inscribed on the crypt floor
        const puls = 0.4 + Math.sin(this.t * 1.6) * 0.25;
        ctx.strokeStyle = `rgba(232,90,74,${0.5 + puls * 0.4})`;
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
        pool.addColorStop(0, `rgba(198,43,48,${0.10 + puls * 0.08})`);
        pool.addColorStop(1, 'rgba(198,43,48,0)');
        ctx.fillStyle = pool; ctx.fillRect(x - 12, y - 12, 24, 24);
        break;
      }
    }
  }

  // The confessional booth, filling the back wall of the north niche. Two
  // bays: the confessor's on the left, open so you can see him standing in it,
  // and the penitent's on the right behind a lattice grille. Timber on the
  // WOOD ramp, outlined in its own dark brown and lit from the upper left like
  // everything else; the only saturated thing on it is the lamp above the
  // grille, which burns when the abbey is owed a confession.
  _drawConfessional(ctx, x, y) {
    const owed = this.player.needsConfession;
    const W_ = 46, H_ = 26;                 // spans the niche's five tiles
    const left = x - W_ / 2, top = y - H_ + 5;

    this._dropShadow(ctx, x, y + 5, W_ / 2 - 2, 3);
    block(ctx, left, top, W_, H_, WOOD);    // the carcase

    // A heavier cornice along the top, so it reads as joinery rather than a
    // crate: three courses stepping proud of the front.
    ctx.fillStyle = WOOD.o; ctx.fillRect(left - 1.5, top - 3.5, W_ + 3, 4);
    ctx.fillStyle = WOOD.b; ctx.fillRect(left - 1, top - 3, W_ + 2, 3);
    ctx.fillStyle = WOOD.l; ctx.fillRect(left - 1, top - 3, W_ + 2, 1);
    ctx.fillStyle = WOOD.h; ctx.fillRect(left - 1, top - 3, 10, 1);

    // turned posts between and beside the bays
    for (const px_ of [left + 1, x - 1, left + W_ - 3]) {
      ctx.fillStyle = WOOD.o; ctx.fillRect(px_ - 0.5, top, 3, H_);
      ctx.fillStyle = WOOD.d; ctx.fillRect(px_, top, 2, H_);
      ctx.fillStyle = WOOD.l; ctx.fillRect(px_, top, 0.7, H_);
    }

    // --- confessor's bay (left): open, and dark behind him ---
    const bx = left + 5, bw = 15;
    ctx.fillStyle = WOOD.o; ctx.fillRect(bx - 1, top + 3, bw + 2, H_ - 4);
    ctx.fillStyle = VOID; ctx.fillRect(bx, top + 4, bw, H_ - 5);
    // NOT scaled by CHAR_SCALE: the bay is bw (15) wide and at this height the
    // figure already draws exactly 15 wide, so any growth puts him through the
    // woodwork on both sides.
    drawCharacter(ctx, {
      sheet: getConfessorSprite(), dir: 'down', moving: false, animPhase: this.t,
      x: bx + bw / 2, groundY: y + 3, targetHeight: 21,
    });

    // --- penitent's bay (right): grille ---
    const gx = x + 4, gw = 15;
    ctx.fillStyle = WOOD.o; ctx.fillRect(gx - 1, top + 3, gw + 2, H_ - 4);
    ctx.fillStyle = VOID; ctx.fillRect(gx, top + 4, gw, H_ - 5);
    ctx.fillStyle = WOOD.d;
    for (let i = 0; i <= gw - 2; i += 2.6) ctx.fillRect(gx + i, top + 4, 0.9, H_ - 5);
    for (let j = 0; j <= H_ - 6; j += 2.6) ctx.fillRect(gx, top + 4 + j, gw, 0.9);
    ctx.fillStyle = WOOD.b;
    for (let i = 0; i <= gw - 2; i += 2.6) ctx.fillRect(gx + i, top + 4, 0.5, H_ - 5);

    // The lamp: the one saturated thing on the booth. It hangs off an iron
    // hook that has to be visibly bolted to the cornice — at one dark pixel
    // wide the bracket vanished and the lamp read as floating in mid-air.
    const lx = gx + gw / 2, ly = top - 6;
    ctx.fillStyle = IRON.o; ctx.fillRect(lx - 1.5, ly - 0.5, 3, 7);       // hook
    ctx.fillStyle = IRON.b; ctx.fillRect(lx - 1, ly, 2, 6);
    ctx.fillStyle = IRON.l; ctx.fillRect(lx - 1, ly, 0.7, 6);
    ctx.fillStyle = IRON.o; ctx.fillRect(lx - 3, top - 4.5, 6, 2);        // plate
    ctx.fillStyle = IRON.d; ctx.fillRect(lx - 2.5, top - 4, 5, 1)
    ctx.fillStyle = owed ? BLOOD.b : IRON.d;
    ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
    if (owed) {
      const g = 0.45 + Math.sin(this.t * 3) * 0.25;
      ctx.fillStyle = BLOOD.l;
      ctx.beginPath(); ctx.arc(lx - 0.7, ly - 0.7, 0.9, 0, Math.PI * 2); ctx.fill();
      const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, 13);
      halo.addColorStop(0, `rgba(198,43,48,${0.22 * g})`);
      halo.addColorStop(1, 'rgba(198,43,48,0)');
      ctx.fillStyle = halo; ctx.fillRect(lx - 13, ly - 13, 26, 26);
    }
  }

  _drawStation(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.id === 'guru') {
      if (this.scourge.active) {
        this.scourge.drawAbbot(ctx, getGuruSprite(), this.t, () => this._dropShadow(ctx, 0, 7, 6, 2.4));
      } else {
        // The Abbot stands free at the altar with nothing framing him, so he
        // takes the same growth the rest of the world cast does. (The
        // Confessor does not — see his bay below, which is exactly as wide as
        // he draws.)
        this._dropShadow(ctx, 0, 7, 6 * CHAR_SCALE, 2.4 * CHAR_SCALE);
        drawCharacter(ctx, {
          sheet: getGuruSprite(), dir: 'down', moving: false, animPhase: this.t,
          x: 0, groundY: 7, targetHeight: 22.4 * CHAR_SCALE,
        });
      }
    } else if (s.id === 'confession') {
      // Nothing is drawn here. There was a prie-dieu on this spot and at
      // sprite scale it read as a scroll on a lectern — a thing to consult
      // rather than a man to speak to. The niche is the booth and the monk
      // standing in it; the station is only the ground you stand on to talk.
    }
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

  // Is A bound to anything where the player is standing? The "!" and the A
  // handler read the same answer, so the mark can never promise an action that
  // the button will not perform.
  _hasAction() {
    const p = this.pc;
    if (this.carrying) {
      // A switch has exactly one destination, and it is a man.
      if (this.carrying.kind === 'stick') {
        return !!(this._activeStation && this._activeStation.id === 'guru');
      }
      // carrying something: the mark means "this bowl will take it"
      const b = this.fire.brazierAt(p.x, p.y);
      if (b >= 0 && !this.fire.isLit(b)) {
        if (this.carrying.kind === 'wood') return !this.fire.isLaid(b);
        if (this.carrying.kind === 'torch') return this.fire.isLaid(b);
      }
      return false;
    }
    if (this.shrine.inReach(p.x, p.y) && !this.shrine.done && this._dutyOpen('shrine')) return true;
    if (this.fire.woodAt(p.x, p.y) >= 0) return true;
    if (this.fire.torchAt(p.x, p.y) >= 0) return true;
    if (this.sticks.at(p.x, p.y) >= 0) return true;
    return !!this._activeStation;
  }

  _drawLocalPlayer(ctx) {
    if (this.scourge.active) { this.scourge.drawPenitent(ctx, this.mySheet, this.t); return; }
    for (const d of this.footDust) {
      const a = 1 - d.t / 0.5;
      const r = 1.5 + d.t * 3;
      ctx.fillStyle = `rgba(200,190,160,${a * 0.3})`;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // During the shrine rite the habit is off: the naked sheet is swapped in and
    // nothing is painted back over it.
    const bare = this.shrine.naked;
    const hop = this._danceHop || 0;
    this._drawRobedFigure(
      ctx, this.pc.x, this.pc.y, this.pc.dir, this.pc.moving,
      this.pc.moving ? this.pc.bob : this.t,
      bare ? this._nakedSheet() : this.mySheet,
      // The chat bubble is drawn after the depth sort instead of here — see
      // render(). A bubble that sorts with its speaker gets covered by
      // anything standing further down the screen, and the one thing the
      // player must be able to read during the shrine rite is a bubble in
      // front of a very large skull.
      null, this.localEmoji, null, undefined, this._streakAura(), hop
    );
    if (bare) this._drawBare(ctx, this.pc.x, this.pc.y - hop, this.pc.dir);

    if (this.carrying) {
      if (this.carrying.kind === 'stick') this.sticks.drawCarried(ctx, this.pc.x, this.pc.y - 6);
      else this.fire.drawCarried(ctx, this.pc.x, this.pc.y - 6, this.carrying.kind, this.t);
    }
  }

  // The one mark that makes bare read as bare, and only from behind.
  //
  // The naked sheet is a full re-generation with the habit's cells set to skin,
  // which at twenty-one pixels tall reads as a person wearing a very tight
  // beige robe: the silhouette is identical, so nothing tells you anything came
  // off. Three pixels of cleft do what a whole redesign of the sprite would.
  // Nothing else is drawn — this is the minimum that carries the information,
  // and the anatomy stops here.
  _drawBare(ctx, x, y, dir) {
    if (dir !== 'up') return;                  // only the back view has it to show
    const px_ = Math.round(x);
    const groundY = Math.round(y) + 6;
    const h = 21;                              // the figure's drawn height
    // Measured off the generator's own layout: legs start at logical y 21.6 of
    // 28, so the buttocks sit between 0.30 and 0.16 of the height above the
    // ground line.
    const top = groundY - h * 0.30, bot = groundY - h * 0.16;
    const cy = (top + bot) / 2, ry = (bot - top) * 0.62;
    ctx.save();
    ctx.fillStyle = 'rgba(92,48,38,0.28)';     // a curve either side, so it is not a scratch
    ctx.beginPath(); ctx.ellipse(px_ - 1.5, cy, 1.7, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px_ + 1.5, cy, 1.7, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(58,28,22,0.85)';
    ctx.fillRect(px_ - 0.4, top, 0.9, bot - top);
    ctx.restore();
  }

  _nakedSheet() {
    if (!this._naked) this._naked = getNakedSprite(getSpriteSeed(), this.player.sex);
    return this._naked;
  }

  _drawRemotePlayer(ctx, net, rp) {
    const seed = rp.seed != null ? rp.seed : 'n' + net;
    const rpSheet = getCultistSprite(seed, rp.prefix === 'Sister' ? 'female' : 'male');
    this._drawRobedFigure(ctx, rp.rx, rp.ry, rp.dir || 'down', false, this.t, rpSheet, rp.name, rp.emoji, rp.chat);
  }

  // Collects every prop, station and character into one list and
  // sorts by ground (y) position so a player standing "in front of" a
  // pillar/pew/bed draws over it, and one standing "behind" it is hidden —
  // a simple top-down painter's-algorithm depth sort.
  // Wood stacks and wall torches are drawn from live state rather than from
  // the prop list, because they come and go — a stack that has been carried
  // off must not still be standing there.
  _fireDrawables(items, ctx) {
    for (let i = 0; i < ALCOVES.length; i++) {
      const a = ALCOVES[i];
      if (this.fire.hasWood(i)) {
        const wx = px(a.wood.col), wy = px(a.wood.row);
        items.push({ y: wy, draw: () => this.fire.drawWood(ctx, wx, wy) });
      }
      if (this.fire.hasTorch(i)) {
        const tx = px(a.torch.col), ty = px(a.torch.row);
        items.push({ y: ty, draw: () => this.fire.drawWallTorch(ctx, tx, ty, this.t, i * 3) });
      }
    }
    // The kerb and its pool are floor, and sort as floor: everything in the
    // chamber stands in front of them. The worshipper's circuit runs INSIDE the
    // ring, so sorting these with the skull would put the near stones over the
    // dancer for half of every lap.
    items.push({ y: this.shrine.y - 60, draw: () => this.shrine.drawGround(ctx) });
    items.push({ y: this.shrine.y + 8, draw: () => this.shrine.draw(ctx) });
    if (this.shrine.robeAt) {
      items.push({ y: this.shrine.robeAt.y, draw: () => this.shrine.drawRobe(ctx) });
    }
    for (let i = 0; i < STICKS.length; i++) {
      if (!this.sticks.has(i)) continue;
      const sx = px(STICKS[i].col), sy = px(STICKS[i].row);
      items.push({ y: sy, draw: () => this.sticks.draw(ctx, sx, sy, i) });
    }
  }

  _collectDrawables(ctx) {
    const items = [];
    for (const p of PROPS) {
      if (p.type === 'fountain-block') continue;
      items.push({ y: p.row * TILE + TILE, draw: () => this._drawProp(ctx, p) });
    }
    for (const s of STATIONS) {
      items.push({ y: s.y + 6, draw: () => this._drawStation(ctx, s) });
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
    this._fireDrawables(items, ctx);
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
      // A cool violet wash indoors, warmer underground — the crimson accent is
      // carried by the runner and the altar, not by a full-screen tint.
      case '.': return 'rgba(20, 10, 40, 0.10)';   // church: cool indigo
      case 'c': return 'rgba(40, 20, 24, 0.10)';   // crypt: warmer earth
      default: return 'rgba(8, 6, 17, 0.12)';      // walls/void
    }
  }

  _drawRobedFigure(ctx, x, y, dir, moving, animPhase, sheet, label, emoji, chat, targetHeight = 21, aura = null, lift = 0) {
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

    // The contact shadow stays on the flagstones when the figure hops — it is
    // the only thing telling you they left the ground, and a shadow that jumps
    // with its owner says nothing at all. It tightens instead, the way a real
    // one does as the gap opens.
    const k = lift > 0 ? 1 - Math.min(0.45, lift / 9) : 1;
    ctx.fillStyle = lift > 0 ? SHADOW_SOFT : SHADOW;
    ctx.beginPath();
    // The contact shadow grows with the figure, or a bigger cast stands on the
    // same small smudge and reads as hovering over the flagstones.
    ctx.ellipse(px_, py_ + 5, 5 * k * CHAR_SCALE, 2 * k * CHAR_SCALE, 0, 0, Math.PI * 2);
    ctx.fill();

    const groundY = py_ + 6 - lift;
    const h = targetHeight * CHAR_SCALE;
    const drawn = drawCharacter(ctx, { sheet, dir, moving, animPhase, x: px_, groundY, targetHeight: h });
    // Labels, emoji and chat hang off drawY, so they follow the taller figure
    // on their own rather than needing their own copy of the scale.
    const drawY = drawn ? groundY - drawn.h : groundY - h;

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
  _drawSpeechBubble(ctx, tipX, tipY, text, alpha, typing = null) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '6px "Courier New", monospace';
    const padX = 4, padY = 3, tail = 3;
    // Measure the whole string even when only part of it is shown, so the box
    // is its final size from the first character on.
    const textW = ctx.measureText(text).width;
    const shown = typing && typing.cps
      ? text.slice(0, Math.floor(typing.age * typing.cps))
      : text;
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
    ctx.strokeStyle = GOLD.d;
    ctx.lineWidth = 0.7;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tipX - tail, by + h);
    ctx.lineTo(tipX + tail, by + h);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fill();
    ctx.strokeStyle = GOLD.d;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = 'rgba(16, 11, 26, 0.95)';
    ctx.fillRect(tipX - tail + 0.5, by + h - 1, tail * 2 - 1, 1.5);

    // Left-aligned inside a box sized for the full line, so the words stay put
    // as they arrive rather than sliding out from the centre.
    ctx.fillStyle = GOLD.l;
    ctx.textAlign = typing && typing.cps ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, typing && typing.cps ? bx + padX : tipX, by + h / 2 + 0.5);
    ctx.restore();
  }

  render(ctx) {
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, W, H);

    // The rite shakes the frame, not the figures: during a hit-stop the world
    // is frozen and only this offset moves, which is what makes the freeze
    // read as an impact rather than as a dropped frame.
    const sh = this.scourge.shakeOffset();

    ctx.save();
    ctx.translate(-Math.round(this.cam.x) + sh.x, -Math.round(this.cam.y) + sh.y);

    // blit the pre-rendered floor (built once); MAP_W/MAP_H logical maps 1:1
    // to the cache's device pixels under the frame's 2x transform
    if (!this._floor) this._buildFloor();
    ctx.drawImage(this._floor, 0, 0, MAP_W, MAP_H);
    this.scourge.drawGround(ctx);
    this.vigil.drawGlow(ctx);
    for (const item of this._collectDrawables(ctx)) item.draw();
    this.scourge.drawWorldFx(ctx);
    this.vigil.drawFire(ctx);
    // After the depth sort, so a pillar or a pew can never hide it. Still in
    // world space, so it tracks the player rather than floating in a corner.
    if (this._hasAction() && !this.dialogue.active && !this.scourge.active && !this.shrine.active
        && !this.vigil.active) {
      drawBang(ctx, Math.round(this.pc.x), Math.round(this.pc.y) - 24, this.t);
    }
    // Last thing in world space, so nothing can cover what the player is saying.
    if (this.localChat) {
      this._drawSpeechBubble(ctx, Math.round(this.pc.x), Math.round(this.pc.y) - 16,
        this.localChat.text, Math.min(1, this.localChat.t), this.localChat);
    }
    this._drawFireflies(ctx);

    ctx.restore();

    // light vignette — just enough to frame the view, not to hide the room
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(6,4,17,0.12)');
    grad.addColorStop(1, 'rgba(6,4,17,0.40)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = this._roomTint();
    ctx.fillRect(0, 0, W, H);

    this.scourge.drawScreenFx(ctx, W, H);
    this.vigil.drawFrame(ctx, W, H, Math.round(this.cam.x) - sh.x, Math.round(this.cam.y) - sh.y);
    this.dialogue.render(ctx);
  }

  exit() {
    document.body.classList.remove('rite-open');
    this._unbindSocket();
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
  }
}
