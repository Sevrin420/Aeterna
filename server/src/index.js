import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import db from './db/database.js';
import {
  DUTY_DEVOTION, STREAK_BONUS_BASE, GIFT_DEVOTION, GIFT_DAILY_LIMITS,
  todayStr, streakMultiplier, confessionCost, ensureFreshDay, pendingConfession, getSeasonInfo,
} from './lib/gameLogic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..', '..', 'web');

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });
// no-cache on the app shell + game code so a redeploy reaches returning
// players immediately (the browser still revalidates cheaply via ETag/304).
// Without this, phones keep running a stale cached courtyard.js after a deploy.
await fastify.register(fastifyStatic, {
  root: webRoot,
  index: 'index.html',
  cacheControl: false, // we set Cache-Control ourselves below
  setHeaders(res, filePath) {
    // no-cache on the app shell + game code so a redeploy reaches returning
    // players immediately (still revalidates cheaply via ETag/304). Other
    // assets (images/fonts) may cache normally.
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
});

// ========== HEALTH ==========
fastify.get('/health', async () => ({ status: 'ok', service: 'aeterna' }));

// ========== REGISTER (dev/testnet stand-in for wallet-signature auth) ==========
// No real wallet is connected yet (see server/README.md "still needed"). The
// client generates a local pseudo-id and this upserts a Cultist row for it so
// the rest of the API has a real player to work against.
fastify.post('/register', async (req, reply) => {
  const { wallet, name, sex, xHandle } = req.body || {};
  if (!wallet || !name) return reply.code(400).send({ error: 'Missing wallet or name' });

  const w = String(wallet).toLowerCase();
  const existing = db.prepare('SELECT * FROM players WHERE wallet = ?').get(w);
  if (existing) return ensureFreshDay(db, existing);

  const player = {
    id: randomUUID(),
    wallet: w,
    name: String(name).slice(0, 32),
    prefix: sex === 'female' ? 'Sister' : 'Brother',
    sex: sex === 'female' ? 'female' : 'male',
    x_handle: xHandle ? String(xHandle).replace(/^@/, '').slice(0, 15) : null,
    created_at: new Date().toISOString(),
    flags_date: todayStr(),
  };

  db.prepare(`
    INSERT INTO players (id, wallet, name, prefix, sex, x_handle, created_at, flags_date)
    VALUES (@id, @wallet, @name, @prefix, @sex, @x_handle, @created_at, @flags_date)
  `).run(player);

  return db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
});

// ========== PLAYER ==========
fastify.get('/me', async (req, reply) => {
  const wallet = req.headers['x-wallet'];
  if (!wallet) return reply.code(401).send({ error: 'No wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  const fresh = ensureFreshDay(db, player);
  const pending = pendingConfession(db, fresh.id);
  return {
    ...fresh,
    multiplier: streakMultiplier(fresh.streak, fresh.level),
    needsConfession: !!pending,
    confessionCost: pending ? confessionCost(fresh.confession_count) : null,
  };
});

// Manual Save → later calls Cloudflare Worker for signature
fastify.post('/save', async (req, reply) => {
  const { wallet } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  // TODO: Call Cloudflare Worker
  // const sigRes = await fetch(process.env.WORKER_URL, { method: 'POST', body: JSON.stringify({...}) })
  const signature = 'pending-worker-signature';

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO saves (player_id, devotion_at_save, streak_at_save, signature, signed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(player.id, player.devotion, player.streak, signature, now);

  db.prepare('UPDATE players SET last_save = ? WHERE id = ?').run(now, player.id);

  return {
    success: true,
    devotion: player.devotion,
    streak: player.streak,
    signature
  };
});

// ========== CONFESSION (escalating cost) ==========
// NOTE: this is the same dev/testnet stand-in the server already had a TODO
// for — it records the confession and forgives the break, but does not yet
// verify an on-chain ETH payment for `cost` using txHash.
fastify.post('/confession', async (req, reply) => {
  const { wallet, txHash } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  const fresh = ensureFreshDay(db, player);
  const pending = pendingConfession(db, fresh.id);
  if (!pending) return reply.code(400).send({ error: 'No broken streak to confess' });

  const cost = confessionCost(fresh.confession_count);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE streak_logs SET confessed = 1, confessed_at = ?, cost_eth = ?, tx_hash = ?
    WHERE id = ?
  `).run(now, cost, txHash || null, pending.id);

  // Forgive the break: restore the streak the player had going into it, and
  // back-date last_duty_date to "yesterday" so today's duties continue it.
  db.prepare(`
    UPDATE players
    SET confession_count = confession_count + 1, streak = ?, last_duty_date = ?
    WHERE id = ?
  `).run(pending.streak_before, todayStr(new Date(Date.now() - 86400000)), fresh.id);

  return {
    success: true,
    costPaid: cost,
    nextCost: confessionCost(fresh.confession_count + 1),
    confessionCount: fresh.confession_count + 1,
    restoredStreak: pending.streak_before,
  };
});

// ========== DUTIES ==========
fastify.post('/duty/:type', async (req, reply) => {
  const { type } = req.params;
  const { wallet } = req.body || {};
  if (!['pray', 'garden', 'candles'].includes(type)) {
    return reply.code(400).send({ error: 'Invalid duty' });
  }
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  const fresh = ensureFreshDay(db, player);
  const col = `${type}_today`;
  if (fresh[col]) return { success: true, duty: type, alreadyDone: true, devotionGained: 0 };

  db.prepare(`UPDATE players SET ${col} = 1 WHERE id = ?`).run(fresh.id);

  let devotionGained = DUTY_DEVOTION;
  const allDone =
    (col === 'pray_today' || fresh.pray_today) &&
    (col === 'garden_today' || fresh.garden_today) &&
    (col === 'candles_today' || fresh.candles_today);

  let streakAdvanced = false;
  let newStreak = fresh.streak;
  const today = todayStr();

  if (allDone && fresh.last_duty_date !== today) {
    const multiplier = streakMultiplier(fresh.streak, fresh.level);
    devotionGained += Math.round(STREAK_BONUS_BASE * (multiplier - 1));
    newStreak = fresh.streak + 1;
    streakAdvanced = true;
    db.prepare('UPDATE players SET streak = ?, last_duty_date = ? WHERE id = ?').run(newStreak, today, fresh.id);
  }

  db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(devotionGained, fresh.id);

  return {
    success: true,
    duty: type,
    devotionGained,
    streakAdvanced,
    streak: newStreak,
    multiplier: streakMultiplier(newStreak, fresh.level),
  };
});

// ========== GIFTS (physical: spawn -> pickup -> carry -> offer -> accept) ==========
// Fixed spawn points in courtyard tile-space (see web/js/abbeyMap.js) — scattered
// around the garden room's open ground, clear of the fountain/benches/pillars.
const GIFT_SPAWN_POINTS = [
  { x: 20, y: 14 }, { x: 26, y: 14 }, { x: 20, y: 18 }, { x: 26, y: 18 }, { x: 21, y: 10 }, { x: 25, y: 20 },
];
const MAX_GROUND_GIFTS = 3;

function maybeSpawnGifts() {
  const groundCount = db.prepare(`
    SELECT COUNT(*) AS n FROM gifts WHERE picked_up_by IS NULL AND given_to IS NULL
  `).get().n;
  if (groundCount >= MAX_GROUND_GIFTS) return;

  const taken = new Set(
    db.prepare(`SELECT loc_x, loc_y FROM gifts WHERE picked_up_by IS NULL AND given_to IS NULL`)
      .all().map((g) => `${g.loc_x},${g.loc_y}`)
  );
  const free = GIFT_SPAWN_POINTS.filter((p) => !taken.has(`${p.x},${p.y}`));
  if (!free.length) return;

  const spot = free[Math.floor(Math.random() * free.length)];
  db.prepare(`
    INSERT INTO gifts (id, spawned_at, loc_x, loc_y)
    VALUES (?, ?, ?, ?)
  `).run(randomUUID(), new Date().toISOString(), spot.x, spot.y);
}

fastify.get('/gifts/nearby', async () => {
  maybeSpawnGifts();
  return db.prepare(`
    SELECT id, loc_x, loc_y FROM gifts
    WHERE picked_up_by IS NULL AND given_to IS NULL
  `).all();
});

fastify.post('/gifts/pickup', async (req, reply) => {
  const { wallet, giftId } = req.body || {};
  if (!wallet || !giftId) return reply.code(400).send({ error: 'Missing wallet or giftId' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (player.held_gift_id) return reply.code(400).send({ error: 'Already holding a gift' });

  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(giftId);
  if (!gift || gift.picked_up_by || gift.given_to) return reply.code(400).send({ error: 'Gift not available' });

  db.prepare('UPDATE gifts SET picked_up_by = ? WHERE id = ?').run(player.id, giftId);
  db.prepare('UPDATE players SET held_gift_id = ? WHERE id = ?').run(giftId, player.id);
  return { success: true, giftId };
});

fastify.post('/gifts/give', async (req, reply) => {
  const { wallet, targetWallet, toGuru } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const giver = ensureFreshDay(db, db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase()));
  if (!giver) return reply.code(404).send({ error: 'Player not found' });
  if (!giver.held_gift_id) return reply.code(400).send({ error: 'Not holding a gift' });
  if (giver.gifts_given_today >= GIFT_DAILY_LIMITS.giverPerDay) {
    return reply.code(400).send({ error: 'Daily gift-giving limit reached' });
  }

  const giftId = giver.held_gift_id;
  const now = new Date().toISOString();

  if (toGuru) {
    db.prepare('UPDATE gifts SET given_to = ?, given_at = ? WHERE id = ?').run('guru', now, giftId);
    db.prepare(`
      UPDATE players SET held_gift_id = NULL, gifts_given_today = gifts_given_today + 1, devotion = devotion + ?
      WHERE id = ?
    `).run(GIFT_DEVOTION.giverToGuru, giver.id);
    return { success: true, devotionGained: GIFT_DEVOTION.giverToGuru, to: 'guru' };
  }

  if (!targetWallet) return reply.code(400).send({ error: 'Missing targetWallet' });
  const receiver = ensureFreshDay(db, db.prepare('SELECT * FROM players WHERE wallet = ?').get(targetWallet.toLowerCase()));
  if (!receiver) return reply.code(404).send({ error: 'Recipient not found' });
  if (receiver.id === giver.id) return reply.code(400).send({ error: 'Cannot gift yourself' });
  if (receiver.gifts_received_today >= GIFT_DAILY_LIMITS.receiverPerDay) {
    return reply.code(400).send({ error: 'Recipient has reached their daily gift limit' });
  }

  db.prepare('UPDATE gifts SET given_to = ?, given_at = ? WHERE id = ?').run(receiver.id, now, giftId);
  db.prepare(`
    UPDATE players SET held_gift_id = NULL, gifts_given_today = gifts_given_today + 1, devotion = devotion + ?
    WHERE id = ?
  `).run(GIFT_DEVOTION.giverToCultist, giver.id);
  db.prepare(`
    UPDATE players SET gifts_received_today = gifts_received_today + 1, devotion = devotion + ?
    WHERE id = ?
  `).run(GIFT_DEVOTION.receiverFromCultist, receiver.id);

  return {
    success: true,
    devotionGained: GIFT_DEVOTION.giverToCultist,
    to: receiver.name,
    receiverDevotionGained: GIFT_DEVOTION.receiverFromCultist,
  };
});

fastify.post('/gifts/drop', async (req, reply) => {
  const { wallet, x, y } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (!player.held_gift_id) return reply.code(400).send({ error: 'Not holding a gift' });

  db.prepare('UPDATE gifts SET picked_up_by = NULL, loc_x = ?, loc_y = ? WHERE id = ?')
    .run(Number.isFinite(x) ? x : null, Number.isFinite(y) ? y : null, player.held_gift_id);
  db.prepare('UPDATE players SET held_gift_id = NULL WHERE id = ?').run(player.id);

  return { success: true };
});

// ========== SOCIAL ==========
fastify.get('/leaderboard', async () => {
  return db.prepare(`
    SELECT name, prefix, level, devotion, streak
    FROM players
    ORDER BY devotion DESC
    LIMIT 10
  `).all();
});

// ========== SEASON (GDD section 2: 56 active days / 14 day break) ==========
fastify.get('/season', async () => getSeasonInfo());

// ========== CATHEDRAL ROOMS (ownable alcoves, GDD section 11) ==========
fastify.get('/cathedral', async () => {
  return db.prepare('SELECT id, owner_id, owner_name, claimed_at FROM cathedral_rooms ORDER BY id').all();
});

fastify.post('/cathedral/:id/claim', async (req, reply) => {
  const { id } = req.params;
  const { wallet } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  const room = db.prepare('SELECT * FROM cathedral_rooms WHERE id = ?').get(id);
  if (!room) return reply.code(404).send({ error: 'No such room' });
  if (room.owner_id) {
    if (room.owner_id === player.id) return { success: true, alreadyOwned: true, room };
    return reply.code(400).send({ error: `Already claimed by ${room.owner_name}` });
  }

  const claimed_at = new Date().toISOString();
  db.prepare('UPDATE cathedral_rooms SET owner_id = ?, owner_name = ?, claimed_at = ? WHERE id = ?')
    .run(player.id, `${player.prefix} ${player.name}`, claimed_at, id);

  return { success: true, room: { id, owner_id: player.id, owner_name: `${player.prefix} ${player.name}`, claimed_at } };
});

// ========== ADMIN AWARD ==========
fastify.post('/admin/award', async (req, reply) => {
  const { wallet, amount, reason } = req.body || {};
  // TODO: protect with admin wallet check
  const player = db.prepare('SELECT * FROM players WHERE wallet = ?').get(wallet?.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, player.id);
  db.prepare(`
    INSERT INTO admin_awards (player_id, amount, reason, awarded_at)
    VALUES (?, ?, ?, ?)
  `).run(player.id, amount, reason || null, new Date().toISOString());

  return { success: true, newDevotion: player.devotion + amount };
});

// ========== SOCKET.IO ==========
const io = new Server(fastify.server, {
  cors: { origin: '*' }
});

const online = new Map(); // socketId → player data

// ========== MANCALA (2-player wager game, GDD section 10) ==========
// One physical table. Classic Kalah rules: indices 0-5 are seat 0's pits,
// 6 is seat 0's store; 7-12 are seat 1's pits, 13 is seat 1's store.
// NOTE: same dev-mode stand-in as confession/save elsewhere in this file —
// the "wager" moves real Devotion between players, not real ETH (no
// on-chain payment verification exists yet anywhere in this server).
const MANCALA_WAGER = 20;
const mancalaTable = { seats: [null, null], wallets: [null, null], names: [null, null], board: null, turn: null, active: false };

function mancalaNewBoard() { return [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]; }
const mancalaOwnPits = (seat) => (seat === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);
const mancalaOwnStore = (seat) => (seat === 0 ? 6 : 13);
const mancalaOppStore = (seat) => (seat === 0 ? 13 : 6);

function mancalaCheckGameOver(board) {
  const side0Empty = [0, 1, 2, 3, 4, 5].every((i) => board[i] === 0);
  const side1Empty = [7, 8, 9, 10, 11, 12].every((i) => board[i] === 0);
  if (!side0Empty && !side1Empty) return false;
  const sweep = side0Empty ? [7, 8, 9, 10, 11, 12] : [0, 1, 2, 3, 4, 5];
  const store = side0Empty ? 13 : 6;
  for (const i of sweep) { board[store] += board[i]; board[i] = 0; }
  return true;
}

function mancalaApplyMove(board, seat, pit) {
  let seeds = board[pit];
  board[pit] = 0;
  const oppStore = mancalaOppStore(seat);
  let idx = pit;
  while (seeds > 0) {
    idx = (idx + 1) % 14;
    if (idx === oppStore) continue;
    board[idx] += 1;
    seeds -= 1;
  }
  const ownStore = mancalaOwnStore(seat);
  const landedInOwnStore = idx === ownStore;
  if (!landedInOwnStore && mancalaOwnPits(seat).includes(idx) && board[idx] === 1) {
    const oppIdx = 12 - idx;
    if (board[oppIdx] > 0) {
      board[ownStore] += board[oppIdx] + 1;
      board[idx] = 0;
      board[oppIdx] = 0;
    }
  }
  return { extraTurn: landedInOwnStore, gameOver: mancalaCheckGameOver(board) };
}

function mancalaResetTable() {
  mancalaTable.seats = [null, null];
  mancalaTable.wallets = [null, null];
  mancalaTable.names = [null, null];
  mancalaTable.board = null;
  mancalaTable.turn = null;
  mancalaTable.active = false;
}

function mancalaBroadcast() {
  mancalaTable.seats.forEach((sid, seat) => {
    if (!sid) return;
    io.to(sid).emit('mancala_state', {
      board: mancalaTable.board,
      turn: mancalaTable.turn,
      active: mancalaTable.active,
      seat,
      names: mancalaTable.names,
      wager: MANCALA_WAGER,
    });
  });
}

function mancalaSettle() {
  const [s0, s1] = [mancalaTable.board[6], mancalaTable.board[13]];
  const winnerSeat = s0 === s1 ? null : s0 > s1 ? 0 : 1;
  const p0 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[0]);
  const p1 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[1]);
  let payout = 0;
  if (winnerSeat === null) {
    if (p0) db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(MANCALA_WAGER, p0.id);
    if (p1) db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(MANCALA_WAGER, p1.id);
  } else {
    const pot = MANCALA_WAGER * 2;
    payout = pot - Math.floor(pot * 0.05); // 5% house rake, per GDD section 10
    const winner = winnerSeat === 0 ? p0 : p1;
    if (winner) db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(payout, winner.id);
  }
  mancalaTable.seats.forEach((sid, seat) => {
    if (!sid) return;
    io.to(sid).emit('mancala_end', { board: mancalaTable.board, winnerSeat, seat, payout, draw: winnerSeat === null });
  });
  mancalaResetTable();
}

function mancalaLeave(socket) {
  const seat = mancalaTable.seats.indexOf(socket.id);
  if (seat === -1) return;
  if (mancalaTable.active) {
    // Forfeit mid-match: refund both wagers rather than adjudicate a winner.
    const p0 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[0]);
    const p1 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[1]);
    if (p0) db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(MANCALA_WAGER, p0.id);
    if (p1) db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(MANCALA_WAGER, p1.id);
    const otherSeat = 1 - seat;
    if (mancalaTable.seats[otherSeat]) io.to(mancalaTable.seats[otherSeat]).emit('mancala_end', { forfeited: true, seat: otherSeat });
  } else if (mancalaTable.seats[1 - seat]) {
    io.to(mancalaTable.seats[1 - seat]).emit('mancala_state', { waiting: true, seat: 1 - seat });
  }
  mancalaResetTable();
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    online.set(socket.id, { ...data, heldGiftId: null });
    socket.broadcast.emit('player_joined', {
      id: data.tokenId || socket.id,
      name: data.name,
      prefix: data.prefix,
      x: data.x,
      y: data.y,
    });
    // Catch the new player up on everyone already in the abbey.
    for (const [otherId, p] of online) {
      if (otherId === socket.id) continue;
      socket.emit('player_joined', { id: p.tokenId || otherId, name: p.name, prefix: p.prefix, x: p.x, y: p.y });
    }
  });

  socket.on('move', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.dir = data.dir;
    socket.broadcast.emit('player_moved', {
      id: p.tokenId || socket.id,
      x: data.x,
      y: data.y,
      dir: data.dir
    });
  });

  socket.on('emoji', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    socket.broadcast.emit('emoji_show', {
      id: p.tokenId || socket.id,
      emoji: data.emoji
    });
  });

  socket.on('chat', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (p.lastChatAt && now - p.lastChatAt < 1500) return; // rate-limit: 1 msg / 1.5s
    p.lastChatAt = now;
    socket.broadcast.emit('chat_msg', {
      id: p.tokenId || socket.id,
      name: p.name,
      text: String(data.text || '').slice(0, 120)
    });
  });

  socket.on('pickup_gift', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    p.heldGiftId = data.giftId;
    socket.broadcast.emit('gift_picked', {
      playerId: p.tokenId || socket.id,
      giftId: data.giftId
    });
  });

  socket.on('offer_gift', (data) => {
    const p = online.get(socket.id);
    if (!p || !p.heldGiftId) return;
    socket.broadcast.emit('gift_offered', {
      fromPlayerId: p.tokenId || socket.id,
      giftId: p.heldGiftId
    });
  });

  socket.on('accept_gift', (data) => {
    // In production: validate, award Devotion, clear heldGiftId, emit gift_transferred
    socket.broadcast.emit('gift_transferred', {
      fromId: data.fromPlayerId,
      toId: online.get(socket.id)?.tokenId || socket.id,
      giftId: data.giftId || null
    });
  });

  socket.on('drop_gift', () => {
    const p = online.get(socket.id);
    if (!p || !p.heldGiftId) return;
    const giftId = p.heldGiftId;
    p.heldGiftId = null;
    socket.broadcast.emit('gift_dropped', {
      playerId: p.tokenId || socket.id,
      giftId,
      x: p.x,
      y: p.y
    });
  });

  socket.on('mancala_sit', () => {
    const p = online.get(socket.id);
    if (!p || mancalaTable.seats.includes(socket.id)) return;
    const seat = mancalaTable.seats.findIndex((s) => s === null);
    if (seat === -1) { socket.emit('mancala_full'); return; }

    mancalaTable.seats[seat] = socket.id;
    mancalaTable.wallets[seat] = String(p.tokenId || '').toLowerCase();
    mancalaTable.names[seat] = `${p.prefix} ${p.name}`;

    if (mancalaTable.seats[0] && mancalaTable.seats[1]) {
      const p0 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[0]);
      const p1 = db.prepare('SELECT * FROM players WHERE wallet = ?').get(mancalaTable.wallets[1]);
      if (!p0 || !p1 || p0.devotion < MANCALA_WAGER || p1.devotion < MANCALA_WAGER) {
        const lackingSeat = !p0 || p0.devotion < MANCALA_WAGER ? 0 : 1;
        mancalaTable.seats.forEach((sid, s) => {
          if (sid) io.to(sid).emit('mancala_error', {
            message: s === lackingSeat
              ? `You need ${MANCALA_WAGER} Devotion to sit at this table.`
              : 'Your opponent lacks enough Devotion to wager. Table reset.',
          });
        });
        mancalaResetTable();
        return;
      }
      db.prepare('UPDATE players SET devotion = devotion - ? WHERE id = ?').run(MANCALA_WAGER, p0.id);
      db.prepare('UPDATE players SET devotion = devotion - ? WHERE id = ?').run(MANCALA_WAGER, p1.id);
      mancalaTable.board = mancalaNewBoard();
      mancalaTable.turn = 0;
      mancalaTable.active = true;
    }
    mancalaBroadcast();
  });

  socket.on('mancala_move', (data) => {
    const seat = mancalaTable.seats.indexOf(socket.id);
    if (seat === -1 || !mancalaTable.active || mancalaTable.turn !== seat) return;
    const pit = Number(data && data.pit);
    if (!mancalaOwnPits(seat).includes(pit) || !mancalaTable.board[pit]) return;

    const { extraTurn, gameOver } = mancalaApplyMove(mancalaTable.board, seat, pit);
    if (gameOver) {
      mancalaSettle();
    } else {
      mancalaTable.turn = extraTurn ? seat : 1 - seat;
      mancalaBroadcast();
    }
  });

  socket.on('mancala_leave', () => mancalaLeave(socket));

  socket.on('disconnect', () => {
    const p = online.get(socket.id);
    if (p) {
      socket.broadcast.emit('player_left', { id: p.tokenId || socket.id });
      online.delete(socket.id);
    }
    mancalaLeave(socket);
  });
});

// ========== START ==========
const port = Number(process.env.PORT) || 3000;
fastify.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Aeterna server running on port ${port}`);
});
