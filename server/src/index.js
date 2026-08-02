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
  DUTY_DEVOTION, DUTIES, DUTY_NAMES, X_DEVOTION, X_KINDS, REFERRAL_DEVOTION,
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

// ========== BLOODLINE METADATA ==========
// What the contract's tokenURI points at, and the whole of "the NFT is
// upgradable": the card a marketplace shows is built here, now, from live
// Devotion. Nothing is minted, migrated or signed to make a Bloodline improve —
// its holder plays, this number goes up, and the metadata says so next time
// anyone looks.
//
// Cultists come from the chain and never change; Devotion comes from play and
// only ever rises. The two are separate on purpose: Cultists multiply the
// end-of-season payout and have no effect on what an act of Devotion is worth.
fastify.get('/nft/:tokenId', async (req, reply) => {
  const tokenId = Number(req.params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1) return reply.code(400).send({ error: 'bad token' });

  const row = db.prepare('SELECT * FROM players WHERE token_id = ?').get(tokenId);
  const cultists = row ? row.cultists || 0 : 0;
  const devotion = row ? row.devotion || 0 : 0;
  const streak = row ? row.streak || 0 : 0;

  // The holder's own name for the line leads, with the token number kept
  // alongside it so a card is still identifiable when two lines share a name.
  const given = row && row.bloodline_name ? row.bloodline_name : null;

  reply.header('Cache-Control', 'public, max-age=60');
  return {
    name: given ? `${given} — Bloodline #${tokenId}` : `Aeterna Bloodline #${tokenId}`,
    description: 'A bloodline of the abbey of Vita Aeterna. It holds a fixed '
      + 'number of Cultists, set the day it was raised and never added to. Its '
      + 'Devotion is earned, and rises for as long as the line is kept.',
    external_url: `https://membersonly.cc/?bloodline=${tokenId}`,
    image: `https://membersonly.cc/nft/${tokenId}/image.svg`,
    attributes: [
      { trait_type: 'Cultists', value: cultists },
      { trait_type: 'Devotion', value: devotion },
      { trait_type: 'Streak', value: streak },
      { trait_type: 'Payout Multiplier', value: `${cultists}x` },
      { trait_type: 'Awakened', value: row ? 'Yes' : 'Not yet' },
      // Only present once its holder has bound one — an absent trait reads
      // better on a marketplace than an empty one.
      ...(given ? [{ trait_type: 'Name', value: given }] : []),
      ...(row && row.x_handle ? [{ trait_type: 'X', value: `@${row.x_handle}` }] : []),
    ],
  };
});

// The card itself. Drawn as SVG rather than a stored PNG so it costs nothing to
// keep current — there is no pipeline to re-render and re-pin every time
// somebody finishes a day's duties.
fastify.get('/nft/:tokenId/image.svg', async (req, reply) => {
  const tokenId = Number(req.params.tokenId);
  const row = Number.isInteger(tokenId)
    ? db.prepare('SELECT * FROM players WHERE token_id = ?').get(tokenId) : null;
  const cultists = row ? row.cultists || 0 : 0;
  const devotion = row ? row.devotion || 0 : 0;
  const esc = (v) => String(v).replace(/[<>&"']/g, '');
  // Validated on the way in, escaped again on the way out: this string is
  // served to marketplaces, and a stored handle predates the current rule.
  const handle = row && row.x_handle ? `@${esc(row.x_handle)}` : '';
  const given = row && row.bloodline_name ? esc(row.bloodline_name) : '';

  reply.header('Content-Type', 'image/svg+xml');
  reply.header('Cache-Control', 'public, max-age=60');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4a1119"/><stop offset="1" stop-color="#160610"/>
  </linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <rect x="18" y="18" width="564" height="564" fill="none" stroke="#9a7018" stroke-width="3"/>
  <rect x="28" y="28" width="544" height="544" fill="none" stroke="#4a0d16" stroke-width="1"/>
  <text x="300" y="96" font-family="Courier New,monospace" font-size="30" font-weight="bold"
        fill="#e85a4a" text-anchor="middle">VITA AETERNA</text>
  <text x="300" y="132" font-family="Courier New,monospace" font-size="17"
        fill="#c9a35f" text-anchor="middle">${given || `BLOODLINE #${esc(tokenId)}`}</text>
  ${given ? `<text x="300" y="152" font-family="Courier New,monospace" font-size="12"
        fill="#6b5227" text-anchor="middle">BLOODLINE #${esc(tokenId)}</text>` : ''}
  <text x="300" y="${given ? 174 : 160}" font-family="Courier New,monospace" font-size="15"
        fill="#8a8069" text-anchor="middle">${handle}</text>
  <text x="300" y="300" font-family="Courier New,monospace" font-size="128" font-weight="bold"
        fill="#f2d264" text-anchor="middle">${esc(cultists)}</text>
  <text x="300" y="340" font-family="Courier New,monospace" font-size="19"
        fill="#c9a35f" text-anchor="middle">CULTISTS</text>
  <text x="300" y="452" font-family="Courier New,monospace" font-size="62" font-weight="bold"
        fill="#e8e2c8" text-anchor="middle">${esc(devotion)}</text>
  <text x="300" y="486" font-family="Courier New,monospace" font-size="19"
        fill="#8a8069" text-anchor="middle">DEVOTION</text>
  <text x="300" y="548" font-family="Courier New,monospace" font-size="15"
        fill="#6b5227" text-anchor="middle">${esc(cultists)}x PAYOUT MULTIPLIER</text>
</svg>`;
});

// Which player row an action belongs to.
//
// Progress is keyed to the BLOODLINE, so every act has to say which one. A
// wallet with several rows would otherwise pour every duty, confession and
// claim into whichever row SQLite happened to hand back first — which is
// exactly what "play one at a time" is supposed to prevent. Without a tokenId
// it falls back to the oldest row, so a ghost who has never bound anything
// still works, and so does every caller written before this existed.
function playerFor(wallet, tokenId) {
  const w = String(wallet).toLowerCase();
  const tid = Number(tokenId);
  if (Number.isInteger(tid) && tid > 0) {
    return db.prepare('SELECT * FROM players WHERE wallet = ? AND token_id = ?').get(w, tid);
  }
  return db.prepare('SELECT * FROM players WHERE wallet = ? ORDER BY created_at LIMIT 1').get(w);
}

// A ghost earns nothing. Devotion belongs to a Bloodline, so a player with no
// token bound is a spectator: they may walk the abbey, but no duty, confession,
// claim or referral pays them. Without this the pseudo-id in localStorage is a
// free, resettable identity that can farm Devotion forever and then carry it
// onto a token at mint time.
function requireBloodline(player, reply) {
  if (player && player.token_id) return null;
  reply.code(403).send({
    error: 'A ghost earns nothing here. Bind a Bloodline first — connect your wallet and choose one.',
  });
  return reply;
}

// ========== BIND A BLOODLINE ==========
// Ties a player row to one Bloodline. The unit of progress is the TOKEN, not
// the wallet: a holder of several gets a row (and a pile of Devotion) each, and
// plays one at a time.
//
// Ownership is checked against the chain, not taken from the request. Without
// that check the cultists field is simply whatever the client claims, and since
// cultists is the end-of-season payout multiplier, anyone could name someone
// else's 20-Cultist Bloodline and be paid on it. The read FAILS CLOSED: if the
// RPC cannot be reached the bind is refused rather than trusted.
//
// NOTE this is ownership, not authentication. There is still no signature
// check anywhere in this API (see server/README.md), so a caller can claim to
// be any address — what this stops is claiming a token that address does not
// hold. Signature auth is the remaining hole and it is not closed here.
const AVAX_RPC = process.env.AVAX_RPC || 'https://api.avax.network/ext/bc/C/rpc';
// The deployed collection on Avalanche C-Chain. Defaulted rather than required
// because it is public — the same address is a meta tag in web/index.html — and
// the deploy rsync deliberately excludes .env, so a required secret here would
// mean /bind silently 503s on every server that was updated without someone
// remembering to hand-edit a file on the box.
const BLOODLINE_ADDRESS = process.env.BLOODLINE_ADDRESS
  || '0xC5D08383B1e56297Adbfa4f15E87588996f4C343';

// Two failures live here and they are NOT the same thing, so they are thrown
// apart. A dead RPC must fail closed (nobody gets bound on an unverified
// claim); a revert means the chain answered perfectly well and the token simply
// does not exist, which is the caller's mistake and not an outage.
class ChainDown extends Error {}
class NoSuchToken extends Error {}

async function chainCall(data) {
  let body;
  try {
    const res = await fetch(AVAX_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: BLOODLINE_ADDRESS, data }, 'latest'] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new ChainDown(`RPC HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new ChainDown(e.message);
  }
  // ownerOf() reverts on an unminted id, and a bare '0x' is the same answer
  // from a node that would rather not say so.
  if (body.error) throw new NoSuchToken(body.error.message || 'reverted');
  if (!body.result || body.result === '0x') throw new NoSuchToken('empty result');
  return body.result;
}

const padUint256 = (n) => BigInt(n).toString(16).padStart(64, '0');

// ownerOf(uint256) and cultistsOf(uint256)
async function readTokenFromChain(tokenId) {
  const owner = await chainCall('0x6352211e' + padUint256(tokenId));
  const cultists = await chainCall('0x5c9f881c' + padUint256(tokenId));
  return {
    owner: '0x' + String(owner).replace(/^0x/, '').slice(-40).toLowerCase(),
    cultists: Number(BigInt(cultists || '0x0')),
  };
}

// A Bloodline is named once, when it is raised. The name is what the abbey
// calls it afterwards — it is the line's name, not the monk's, which is why it
// does not overwrite `name`: the person keeping the line is not the line.
// 1-24 characters of letters, digits, spaces and the punctuation a house name
// actually uses. Anything else is a typo or an attempt to put markup somewhere
// that ends up on a card served to marketplaces.
const BLOODLINE_NAME_RE = /^[A-Za-z0-9 '’\-.]{1,24}$/;
function cleanBloodlineName(v) {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ');
  return t && BLOODLINE_NAME_RE.test(t) ? t : null;
}

fastify.post('/bind', async (req, reply) => {
  const { wallet, tokenId, address, bloodlineName } = req.body || {};
  const tid = Number(tokenId);
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
  if (!Number.isInteger(tid) || tid < 1) return reply.code(400).send({ error: 'bad token' });
  if (!BLOODLINE_ADDRESS) return reply.code(503).send({ error: 'Collection not configured on the server' });
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) return reply.code(400).send({ error: 'bad address' });
  // Only refuse a name that was actually offered; binding without one is fine
  // and falls back to the token number below.
  const wantsName = bloodlineName != null && String(bloodlineName).trim() !== '';
  const cleanName = wantsName ? cleanBloodlineName(bloodlineName) : null;
  if (wantsName && !cleanName) {
    return reply.code(400).send({ error: 'A Bloodline name is 1-24 letters, digits, spaces, apostrophes or hyphens' });
  }

  let onChain;
  try {
    onChain = await readTokenFromChain(tid);
  } catch (e) {
    if (e instanceof NoSuchToken) {
      return reply.code(404).send({ error: 'No such Bloodline has been raised' });
    }
    req.log.error({ err: e }, 'bind: chain read failed');
    return reply.code(503).send({ error: 'Could not reach the chain to verify that Bloodline' });
  }
  if (onChain.owner !== String(address).toLowerCase()) {
    return reply.code(403).send({ error: 'That Bloodline is not held by this wallet' });
  }

  const w = String(wallet).toLowerCase();

  // Already bound? Refresh the cached Cultist count and hand the row back.
  const bound = db.prepare('SELECT * FROM players WHERE wallet = ? AND token_id = ?').get(w, tid);
  if (bound) {
    if (bound.cultists !== onChain.cultists) {
      db.prepare('UPDATE players SET cultists = ? WHERE id = ?').run(onChain.cultists, bound.id);
    }
    // Named once, at creation. A Bloodline bound before this existed has no
    // name yet, so it may still take one; one that already has a name keeps it.
    if (cleanName && !bound.bloodline_name) {
      db.prepare('UPDATE players SET bloodline_name = ? WHERE id = ?').run(cleanName, bound.id);
    }
    return ensureFreshDay(db, db.prepare('SELECT * FROM players WHERE id = ?').get(bound.id));
  }

  // The token can only belong to one row, ever.
  const taken = db.prepare('SELECT * FROM players WHERE token_id = ?').get(tid);
  if (taken) return reply.code(409).send({ error: 'That Bloodline is already bound to another player' });

  // A wallet's first-ever row may exist with no token (it registered as a
  // ghost). The row is adopted so the player keeps their name and face — but
  // A BLOODLINE STARTS AT ZERO. Whatever a ghost accumulated before the rule
  // that ghosts earn nothing does not travel onto a token: a localStorage
  // pseudo-id is free and resettable, so carrying its Devotion across would
  // make every mint a way to cash in a farmed identity.
  const ghost = db.prepare('SELECT * FROM players WHERE wallet = ? AND token_id IS NULL').get(w);
  if (ghost) {
    db.prepare(`UPDATE players SET
        token_id = ?, cultists = ?, bloodline_name = ?,
        devotion = 0, streak = 0, level = 1, last_duty_date = NULL, confession_count = 0,
        flags_date = ?, pray_today = 0, garden_today = 0, candles_today = 0,
        scourge_today = 0, gifts_given_today = 0, gifts_received_today = 0
      WHERE id = ?`).run(tid, onChain.cultists, cleanName || `Bloodline #${tid}`, todayStr(), ghost.id);
    return ensureFreshDay(db, db.prepare('SELECT * FROM players WHERE id = ?').get(ghost.id));
  }

  // Otherwise this is a second (or third) Bloodline for a wallet that already
  // plays one: a new row, its own Devotion, carrying the name across.
  const sibling = db.prepare('SELECT * FROM players WHERE wallet = ? ORDER BY created_at LIMIT 1').get(w);
  const player = {
    id: randomUUID(),
    wallet: w,
    token_id: tid,
    cultists: onChain.cultists,
    bloodline_name: cleanName || `Bloodline #${tid}`,
    name: sibling ? sibling.name : `Bloodline ${tid}`,
    prefix: sibling ? sibling.prefix : 'Brother',
    sex: sibling ? sibling.sex : 'male',
    x_handle: sibling ? sibling.x_handle : null,
    created_at: new Date().toISOString(),
    flags_date: todayStr(),
  };
  db.prepare(`
    INSERT INTO players (id, wallet, token_id, cultists, bloodline_name, name, prefix, sex, x_handle, created_at, flags_date)
    VALUES (@id, @wallet, @token_id, @cultists, @bloodline_name, @name, @prefix, @sex, @x_handle, @created_at, @flags_date)
  `).run(player);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
});

// ========== REGISTER (dev/testnet stand-in for wallet-signature auth) ==========
// No real wallet is connected yet (see server/README.md "still needed"). The
// client generates a local pseudo-id and this upserts a Cultist row for it so
// the rest of the API has a real player to work against.
fastify.post('/register', async (req, reply) => {
  const { wallet, name, sex, xHandle } = req.body || {};
  if (!wallet || !name) return reply.code(400).send({ error: 'Missing wallet or name' });

  const w = String(wallet).toLowerCase();
  const existing = db.prepare('SELECT * FROM players WHERE wallet = ? ORDER BY created_at LIMIT 1').get(w);
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

  // Which Bloodline is being played. A wallet may have a row per token now, so
  // asking for "the" player by wallet alone is only meaningful for a ghost —
  // without the header the oldest row is returned, which keeps every existing
  // single-Bloodline and unbound caller behaving exactly as before.
  const tid = Number(req.headers['x-token']);
  const player = Number.isInteger(tid) && tid > 0
    ? db.prepare('SELECT * FROM players WHERE wallet = ? AND token_id = ?').get(wallet.toLowerCase(), tid)
    : db.prepare('SELECT * FROM players WHERE wallet = ? ORDER BY created_at LIMIT 1').get(wallet.toLowerCase());
  if (!player) return reply.code(404).send({ error: 'Player not found' });

  const fresh = ensureFreshDay(db, player);
  const pending = pendingConfession(db, fresh.id);
  // Whether this wallet has already been brought in by someone. The client
  // uses it to know not to ask again; it is keyed to the wallet because that
  // is what the referrals table is unique on.
  const referral = db.prepare('SELECT referrer_handle FROM referrals WHERE referee_wallet = ?')
    .get(String(wallet).toLowerCase());
  return {
    ...fresh,
    multiplier: streakMultiplier(fresh.streak, fresh.level),
    needsConfession: !!pending,
    confessionCost: pending ? confessionCost(fresh.confession_count) : null,
    referred: referral ? referral.referrer_handle : null,
  };
});

// Manual Save → later calls Cloudflare Worker for signature
fastify.post('/save', async (req, reply) => {
  const { wallet, tokenId } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

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
  const { wallet, tokenId, txHash } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

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

// ========== THE THREE DAILY DUTIES ==========
// Light Fire, Whipping, Skull Chant. One endpoint for all three: they are the
// same transaction with a different column, and the scourge used to have its
// own route purely because it arrived later — which meant its award and its
// streak accounting could drift away from the other two. They cannot now.
//
// Devotion is paid PER TASK at the streak multiplier, so a player on a long
// streak sees the bonus land with each act rather than once at the end of the
// set. The streak itself still advances once, on the task that completes all
// three, and the day rolls at 00:00 UTC (todayStr is an ISO date).
fastify.post('/duty/:type', async (req, reply) => {
  const { type } = req.params;
  const { wallet, tokenId } = req.body || {};
  if (!DUTIES.includes(type)) return reply.code(400).send({ error: 'Invalid duty' });
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

  const fresh = ensureFreshDay(db, player);
  const col = `${type}_today`;
  if (fresh[col]) {
    return { success: true, duty: type, name: DUTY_NAMES[type], alreadyDone: true, devotionGained: 0 };
  }

  db.prepare(`UPDATE players SET ${col} = 1 WHERE id = ?`).run(fresh.id);

  const multiplier = streakMultiplier(fresh.streak, fresh.level);
  const streakBonus = Math.round(DUTY_DEVOTION * (multiplier - 1));
  const devotionGained = DUTY_DEVOTION + streakBonus;

  const allDone = DUTIES.every((d) => d === type || fresh[`${d}_today`]);
  let streakAdvanced = false;
  let newStreak = fresh.streak;
  const today = todayStr();

  if (allDone && fresh.last_duty_date !== today) {
    newStreak = fresh.streak + 1;
    streakAdvanced = true;
    db.prepare('UPDATE players SET streak = ?, last_duty_date = ? WHERE id = ?').run(newStreak, today, fresh.id);
  }

  db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(devotionGained, fresh.id);

  return {
    success: true,
    duty: type,
    name: DUTY_NAMES[type],
    devotionGained,
    base: DUTY_DEVOTION,
    streakBonus,
    streakAdvanced,
    streak: newStreak,
    multiplier: streakMultiplier(newStreak, fresh.level),
    remaining: DUTIES.filter((d) => d !== type && !fresh[`${d}_today`]).length,
  };
});

// ========== ENGAGEMENT ON X ==========
// Like 2, comment 3, repost 5, credited once per interaction per post.
//
// This route will not pay out until X verification is configured, and that is
// deliberate. An endpoint that awards Devotion because the CLIENT says a like
// happened is a faucet anyone can turn on with curl — the same mistake the old
// admin-award route made. verifyXInteraction() is the seam: give it real X API
// credentials and it starts returning true for interactions that actually
// exist; without them it refuses, and the endpoint refuses with it.
//
// To switch it on: set X_BEARER_TOKEN in the server environment and implement
// the lookup below against the X API v2 (liking_users / retweeted_by for a
// post, or a search for replies by the author). The ledger, the amounts and
// the double-claim guard are already done.
async function verifyXInteraction(handle, kind, postId) {
  if (!process.env.X_BEARER_TOKEN) return { ok: false, reason: 'not_configured' };
  // TODO: call the X API here and confirm `handle` performed `kind` on `postId`.
  return { ok: false, reason: 'not_implemented' };
}

// ========== X HANDLE ==========
// Binds an X handle to a Bloodline. It shows on the token's card, and it is
// the name other players type to credit a referral, so it has to be unique
// across the abbey — see the guarded index in database.js.
fastify.post('/x/handle', async (req, reply) => {
  const { wallet, tokenId, xHandle } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

  const handle = String(xHandle || '').trim().replace(/^@/, '');
  if (!handle) {
    db.prepare('UPDATE players SET x_handle = NULL WHERE id = ?').run(player.id);
    return { success: true, xHandle: null };
  }
  // X's own rule: 1-15 of [A-Za-z0-9_]. Anything else is a typo or an attempt
  // to smuggle markup onto a card that is served to marketplaces.
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return reply.code(400).send({ error: 'An X handle is 1-15 letters, numbers or underscores' });
  }

  const taken = db.prepare('SELECT id FROM players WHERE x_handle = ? COLLATE NOCASE AND id != ?').get(handle, player.id);
  if (taken) return reply.code(409).send({ error: 'That X handle is already bound to another Bloodline' });

  try {
    db.prepare('UPDATE players SET x_handle = ? WHERE id = ?').run(handle, player.id);
  } catch {
    return reply.code(409).send({ error: 'That X handle is already bound to another Bloodline' });
  }
  return { success: true, xHandle: handle, tokenId: player.token_id };
});

// ========== REFERRALS ==========
// A player names the X handle of whoever brought them in. Both sides are paid
// REFERRAL_DEVOTION, once.
//
// Three things are refused, and each of them is a way to print Devotion rather
// than earn it. Naming yourself is obvious. Naming another Bloodline of your
// OWN wallet is the one that matters here: a wallet may mint any number of
// Bloodlines, so without this check a single person could raise two and refer
// one to the other all day. And a mutual pair — you refer me, I refer you — is
// refused too, because it pays both sides twice for one introduction.
//
// The remaining hole is two genuinely separate wallets cross-referring, which
// costs a mint each and is not solvable here; it needs the signature auth the
// API still lacks.
fastify.post('/referral', async (req, reply) => {
  const { wallet, tokenId, xHandle } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const referee = playerFor(wallet, tokenId);
  if (!referee) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(referee, reply)) return reply;

  const handle = String(xHandle || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return reply.code(400).send({ error: 'An X handle is 1-15 letters, numbers or underscores' });
  }

  const w = String(wallet).toLowerCase();
  const already = db.prepare('SELECT * FROM referrals WHERE referee_wallet = ?').get(w);
  if (already) {
    return reply.code(409).send({ error: `You were already brought in by @${already.referrer_handle}` });
  }

  // The referrer must hold a Bloodline too, or the 10 Devotion would be paid
  // onto a ghost row that is not allowed to earn any.
  const referrer = db.prepare('SELECT * FROM players WHERE x_handle = ? COLLATE NOCASE AND token_id IS NOT NULL').get(handle);
  if (!referrer) return reply.code(404).send({ error: 'No Cultist here goes by that handle' });
  if (referrer.wallet === w) {
    return reply.code(400).send({ error: 'You cannot bring yourself into the abbey' });
  }
  const mutual = db.prepare('SELECT 1 FROM referrals WHERE referee_wallet = ? AND referrer_wallet = ?').get(referrer.wallet, w);
  if (mutual) return reply.code(409).send({ error: 'You already brought them in' });

  const amount = REFERRAL_DEVOTION;
  const now = new Date().toISOString();
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO referrals
        (referee_wallet, referee_player_id, referrer_wallet, referrer_player_id, referrer_handle, devotion_each, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(w, referee.id, referrer.wallet, referrer.id, referrer.x_handle, amount, now);
      db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, referee.id);
      db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, referrer.id);
    })();
  } catch (e) {
    // The UNIQUE on referee_wallet is the real guard against two requests
    // racing; losing that race is "already referred", not a server fault.
    return reply.code(409).send({ error: 'You have already been brought in' });
  }

  const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(referee.id);
  return {
    success: true,
    referrer: referrer.x_handle,
    devotionGained: amount,
    devotion: fresh.devotion,
  };
});

fastify.post('/x/claim', async (req, reply) => {
  const { wallet, tokenId, kind, postId } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
  if (!X_KINDS.includes(kind)) return reply.code(400).send({ error: 'Invalid interaction' });
  if (!postId) return reply.code(400).send({ error: 'Missing postId' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;
  if (!player.x_handle) return reply.code(400).send({ error: 'No X handle bound to this Cultist' });

  const already = db.prepare(
    'SELECT 1 FROM x_interactions WHERE player_id = ? AND kind = ? AND post_id = ?'
  ).get(player.id, kind, String(postId));
  if (already) return { success: true, alreadyClaimed: true, devotionGained: 0 };

  const check = await verifyXInteraction(player.x_handle, kind, String(postId));
  if (!check.ok) {
    return reply.code(503).send({ error: 'X verification unavailable', reason: check.reason });
  }

  const amount = X_DEVOTION[kind];
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO x_interactions (player_id, kind, post_id, devotion, awarded_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(player.id, kind, String(postId), amount, now);
    db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, player.id);
  });
  tx();

  return { success: true, kind, devotionGained: amount };
});

// The /leaderboard endpoint is gone. Nothing in the game drew one -- there was
// no overlay in index.html and no caller for api.leaderboard() -- but the route
// still served a public ranking of every player by Devotion to anyone who asked
// for the URL, which is a leaderboard whether or not the game renders it. Kept
// out entirely rather than left dark; it is a dozen lines to restore from git
// when it is wanted.

// The names of specific Bloodlines, so the picker can offer them by name
// instead of by token number. The caller must already know the ids it is
// asking about — they come from bloodlinesOf() on the chain — so this returns
// what it is given and nothing else. That is deliberately NOT a ranking: no
// ordering, no top-N, no way to enumerate. Every field here is already public
// per-token at /nft/:id.
fastify.get('/bloodlines', async (req, reply) => {
  const raw = String((req.query && req.query.tokens) || '').trim();
  if (!raw) return [];
  const ids = raw.split(',')
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);                      // a wallet with more than 50 can page
  if (!ids.length) return [];
  const holes = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT token_id, bloodline_name, cultists, devotion, streak FROM players WHERE token_id IN (${holes})`
  ).all(...ids);
  reply.header('Cache-Control', 'no-store');
  return rows;
});

// ========== SEASON (GDD section 2: 56 active days / 14 day break) ==========
fastify.get('/season', async () => getSeasonInfo());

// ========== CATHEDRAL ROOMS (ownable alcoves, GDD section 11) ==========
fastify.get('/cathedral', async () => {
  return db.prepare('SELECT id, owner_id, owner_name, claimed_at FROM cathedral_rooms ORDER BY id').all();
});

fastify.post('/cathedral/:id/claim', async (req, reply) => {
  const { id } = req.params;
  const { wallet, tokenId } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

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

// The admin award endpoint has been removed. It added arbitrary Devotion to
// any wallet with no authentication of any kind — it carried a "TODO: protect
// with admin wallet check" that was never done — so anyone who could reach the
// server could mint themselves to the top of the leaderboard. Devotion now has
// exactly the sources listed in gameLogic.js and no back door. If an admin
// grant is wanted again it needs to sit behind a shared secret before it goes
// anywhere near a running server.

// ========== SOCKET.IO ==========
const io = new Server(fastify.server, {
  cors: { origin: '*' }
});

const online = new Map(); // socketId → player data

// ---- Realtime scaling (Tier 1): authoritative tick + interest management ----
// Instead of relaying every move to everyone (O(N^2)), the server holds
// authoritative positions and, on a fixed tick, sends each client only the
// nearest players around them as a compact BINARY snapshot. Clients interpolate
// between snapshots. This keeps cost bounded no matter how many are online.
const TILE = 10;                 // must match web/js/abbeyMap.js
const CELL = 8 * TILE;           // interest grid cell (world px)
const INTEREST_K = 40;           // max peers streamed to a client (fits the screen)
const TICK_MS = 100;             // 10 Hz snapshot rate
const DIR_CODE = { down: 0, up: 1, left: 2, right: 3 };
let _netSeq = 1;
const _freeNet = [];
function assignNet() { if (_freeNet.length) return _freeNet.pop(); const id = _netSeq++; if (_netSeq > 65535) _netSeq = 1; return id; }
function releaseNet(id) { if (id) _freeNet.push(id); }

// ---- Tier 3 (optional): multi-process fan-out via the Socket.IO Redis adapter.
// Set REDIS_URL and run several workers behind Caddy (sticky sessions) to use
// all CPU cores. Inert (single process) when REDIS_URL is unset, so nothing to
// install until you actually need it.
if (process.env.REDIS_URL) {
  try {
    const [{ createAdapter }, { createClient }] = await Promise.all([
      import('@socket.io/redis-adapter'),
      import('redis'),
    ]);
    const pub = createClient({ url: process.env.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('Socket.IO Redis adapter enabled (multi-process mode).');
  } catch (e) {
    console.warn('REDIS_URL set but Redis adapter failed to load:', e.message);
  }
}

// ========== MANCALA (2-player wager game, GDD section 10) ==========
// One physical table. Classic Kalah rules: indices 0-5 are seat 0's pits,
// 6 is seat 0's store; 7-12 are seat 1's pits, 13 is seat 1's store.
// NOTE: same dev-mode stand-in as confession/save elsewhere in this file —
// the "wager" moves real Devotion between players, not real ETH (no
// on-chain payment verification exists yet anywhere in this server).
// Mancala is wagered in crypto, not in Devotion. The table used to stake and
// pay out Devotion, which made the game a fourth way to gain (and lose) it;
// nothing here touches Devotion any more.
//
// The escrow itself is NOT implemented. There is no on-chain hold, no
// settlement and no transfer — the server runs the game and reports who won
// and what the pot would have been. MANCALA_WAGER is denominated in ETH and
// the 5% rake is applied to the pot, so the numbers the client shows are the
// real ones; what is missing is the part that moves money. Until that exists,
// the table is a friendly game with a scoreboard.
const MANCALA_WAGER = 0.01;      // ETH staked by each seat
const MANCALA_RAKE = 0.05;       // the house takes 5% of the pot
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
  // A draw returns both stakes; a win pays the pot less the house's 5%. No
  // Devotion changes hands either way — see MANCALA_WAGER. When escrow exists,
  // this is the one place that has to settle it.
  let payout = 0;
  if (winnerSeat !== null) {
    const pot = MANCALA_WAGER * 2;
    payout = Number((pot * (1 - MANCALA_RAKE)).toFixed(6));
  }
  mancalaTable.seats.forEach((sid, seat) => {
    if (!sid) return;
    io.to(sid).emit('mancala_end', { board: mancalaTable.board, winnerSeat, seat, payout, draw: winnerSeat === null });
  });
  mancalaResetTable();
}

// ---- Single-player: play the Abbot (a greedy Kalah AI) ----
// Solo games are per-socket and independent of the shared 2-player table, so
// practising against the Abbot never occupies the wager table for others.
const soloGames = new Map(); // socketId -> { board, turn (0=you,1=Abbot), active }
const SOLO_NAMES = ['You', 'The Abbot'];

function soloEmit(socket, g, extra = {}) {
  socket.emit('mancala_state', {
    solo: true, board: g.board, turn: g.turn, active: g.active,
    seat: 0, names: SOLO_NAMES, wager: 0, ...extra,
  });
}

// Greedy heuristic for seat 1: prefer an extra turn, then seeds banked, then a
// capture; light random tie-break so the Abbot isn't perfectly predictable.
function mancalaAiPick(board) {
  const pits = [7, 8, 9, 10, 11, 12].filter((p) => board[p] > 0);
  if (!pits.length) return null;
  let best = pits[0], bestScore = -Infinity;
  for (const p of pits) {
    const b = board.slice();
    const before = b[13];
    const { extraTurn } = mancalaApplyMove(b, 1, p);
    let score = (b[13] - before) * 2 + (extraTurn ? 6 : 0) + Math.random();
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function soloSettle(socket, g) {
  g.active = false;
  const [s0, s1] = [g.board[6], g.board[13]];
  const winnerSeat = s0 === s1 ? null : s0 > s1 ? 0 : 1;
  socket.emit('mancala_end', { solo: true, board: g.board, winnerSeat, seat: 0, payout: 0, draw: winnerSeat === null });
  soloGames.delete(socket.id);
}

// The Abbot takes one move; if it earns an extra turn, it keeps going (with a
// short delay so the player can watch each move land).
// Three times slower than it was. The client sows each stone over 570ms now,
// so at 650ms the Abbot's reply landed while his previous move was still
// visibly in the air: the board jumped and you never saw what he had done.
const ABBOT_THINK = 1950;

function soloAiStep(socket) {
  const g = soloGames.get(socket.id);
  if (!g || !g.active || g.turn !== 1) return;
  const pit = mancalaAiPick(g.board);
  if (pit == null) return soloSettle(socket, g);
  const { extraTurn, gameOver } = mancalaApplyMove(g.board, 1, pit);
  if (gameOver) return soloSettle(socket, g);
  g.turn = extraTurn ? 1 : 0;
  soloEmit(socket, g);
  if (g.turn === 1) setTimeout(() => soloAiStep(socket), ABBOT_THINK);
}

function mancalaLeave(socket) {
  soloGames.delete(socket.id);
  const seat = mancalaTable.seats.indexOf(socket.id);
  if (seat === -1) return;
  if (mancalaTable.active) {
    // Forfeit mid-match: both stakes are returned rather than adjudicating a
    // winner. (Nothing to undo while escrow is unimplemented.)
    const otherSeat = 1 - seat;
    if (mancalaTable.seats[otherSeat]) io.to(mancalaTable.seats[otherSeat]).emit('mancala_end', { forfeited: true, seat: otherSeat });
  } else if (mancalaTable.seats[1 - seat]) {
    io.to(mancalaTable.seats[1 - seat]).emit('mancala_state', { waiting: true, seat: 1 - seat });
  }
  mancalaResetTable();
}

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const netId = assignNet();
    online.set(socket.id, {
      ...data,
      netId,
      dir: 'down',
      socket,          // local ref for the tick loop
      known: new Set(), // netIds we've already sent meta for (this frame's interest set)
    });
    // Tell the client its own network id so it can ignore itself in snapshots.
    socket.emit('welcome', { netId });
    // Everyone else discovers this player lazily via the interest tick — no
    // O(N) fan-out on join, no catch-up loop.
  });

  socket.on('move', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    // Authoritative state only. No broadcast here — the tick loop streams
    // positions to just the nearby players as a compact binary snapshot.
    p.x = data.x;
    p.y = data.y;
    p.dir = data.dir;
  });

  socket.on('emoji', (data) => {
    const p = online.get(socket.id);
    if (!p) return;
    socket.broadcast.emit('emoji_show', {
      net: p.netId,
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
      net: p.netId,
      name: p.name,
      text: String(data.text || '').slice(0, 120)
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
      // No Devotion check and no Devotion stake: the wager is in crypto, and
      // there is nothing to escrow against yet.
      mancalaTable.board = mancalaNewBoard();
      mancalaTable.turn = 0;
      mancalaTable.active = true;
    }
    mancalaBroadcast();
  });

  socket.on('mancala_solo_start', () => {
    const p = online.get(socket.id);
    if (!p) return;
    // step off the shared wager table if seated there (but not mid-match)
    const seat = mancalaTable.seats.indexOf(socket.id);
    if (seat !== -1) { if (mancalaTable.active) return; mancalaLeave(socket); }
    soloGames.set(socket.id, { board: mancalaNewBoard(), turn: 0, active: true });
    soloEmit(socket, soloGames.get(socket.id));
  });

  socket.on('mancala_move', (data) => {
    const pit = Number(data && data.pit);

    // solo game (vs the Abbot) takes priority if this socket has one
    const g = soloGames.get(socket.id);
    if (g) {
      if (!g.active || g.turn !== 0) return;
      if (!mancalaOwnPits(0).includes(pit) || !g.board[pit]) return;
      const { extraTurn, gameOver } = mancalaApplyMove(g.board, 0, pit);
      if (gameOver) return soloSettle(socket, g);
      g.turn = extraTurn ? 0 : 1;
      soloEmit(socket, g);
      if (g.turn === 1) setTimeout(() => soloAiStep(socket), ABBOT_THINK);
      return;
    }

    const seat = mancalaTable.seats.indexOf(socket.id);
    if (seat === -1 || !mancalaTable.active || mancalaTable.turn !== seat) return;
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
      releaseNet(p.netId);
      socket.broadcast.emit('peer_left', { net: p.netId });
      online.delete(socket.id);
    }
    mancalaLeave(socket);
  });
});

// ---- Interest tick: stream each client only the nearest INTEREST_K players ----
// Cost is O(N * avgNeighbours), not O(N^2): we bucket players into a coarse
// spatial grid and only compare against the 3x3 block of cells around each one.
// Positions go out as a packed binary snapshot; names/prefixes go out once (as
// JSON) the first time a peer enters a client's interest set.
// NOTE: with the Redis adapter (Tier 3, multi-process) each worker only sees
// its own connected sockets in `online`, so cross-worker interest would need
// shared position state. For a single process (the default) this is exact.
const SNAP_STRIDE = 7; // bytes per peer: netId(u16) x(i16) y(i16) dir(u8)

setInterval(() => {
  if (online.size === 0) return;

  // 1) Bucket everyone into grid cells.
  const cells = new Map(); // "cx,cy" -> array of player entries
  for (const p of online.values()) {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
    let bucket = cells.get(key);
    if (!bucket) { bucket = []; cells.set(key, bucket); }
    bucket.push(p);
  }

  // 2) For each player, gather candidates from its 3x3 cell block, take the
  //    nearest K, and emit meta (new peers) + a binary position snapshot.
  for (const me of online.values()) {
    if (typeof me.x !== 'number') continue;
    const cx = Math.floor(me.x / CELL);
    const cy = Math.floor(me.y / CELL);
    const candidates = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = cells.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === me) continue;
          const dx = other.x - me.x;
          const dy = other.y - me.y;
          candidates.push([dx * dx + dy * dy, other]);
        }
      }
    }
    if (candidates.length > INTEREST_K) {
      candidates.sort((a, b) => a[0] - b[0]);
      candidates.length = INTEREST_K;
    }

    // Meta for peers newly entering this client's interest set.
    const nextKnown = new Set();
    const newPeers = [];
    for (const [, other] of candidates) {
      nextKnown.add(other.netId);
      if (!me.known.has(other.netId)) {
        newPeers.push({
          net: other.netId,
          id: other.tokenId || null,
          name: other.name,
          prefix: other.prefix,
        });
      }
    }
    me.known = nextKnown;
    if (newPeers.length) me.socket.emit('peers', newPeers);

    // Nothing nearby: skip the packet entirely. Peers that just left this
    // client's radius will lapse via the client's staleness timeout.
    if (candidates.length === 0) continue;

    // Packed positions.
    const buf = new ArrayBuffer(2 + candidates.length * SNAP_STRIDE);
    const view = new DataView(buf);
    view.setUint16(0, candidates.length);
    let off = 2;
    for (const [, other] of candidates) {
      view.setUint16(off, other.netId); off += 2;
      view.setInt16(off, Math.round(other.x)); off += 2;
      view.setInt16(off, Math.round(other.y)); off += 2;
      view.setUint8(off, DIR_CODE[other.dir] || 0); off += 1;
    }
    me.socket.emit('snap', buf);
  }
}, TICK_MS);

// ========== START ==========
const port = Number(process.env.PORT) || 3000;
fastify.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Aeterna server running on port ${port}`);
});
