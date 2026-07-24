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
  todayStr, streakMultiplier, confessionCost, ensureFreshDay, pendingConfession,
} from './lib/gameLogic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..', '..', 'web');

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });
await fastify.register(fastifyStatic, { root: webRoot, index: 'index.html' });

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

  socket.on('disconnect', () => {
    const p = online.get(socket.id);
    if (p) {
      socket.broadcast.emit('player_left', { id: p.tokenId || socket.id });
      online.delete(socket.id);
    }
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
