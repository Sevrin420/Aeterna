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
  REFERRAL_CAP, X_COMMENT_DEVOTION, X_DAILY_CLAIMS, X_PHRASE, matchesPhrase,
  todayStr, streakMultiplier, taskAward, taskDevotionForWeek, ensureFreshDay, pendingConfession,
  abbeyWeek, abbeyClock, confessionPct, confessionCostWei, weiToAvax,
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
// final payout and have no effect on what an act of Devotion is worth.
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
    // The abbey's name as a marketplace shows it. This used to disagree with
    // the on-chain collection name, which the first contract baked into its
    // constructor as "Aeterna Bloodline" and could not change; the redeploy
    // put both on "Throbbin Abbey Bloodline", so a card and the collection it
    // belongs to finally say the same thing.
    name: given ? `${given} — Bloodline #${tokenId}` : `Throbbin Abbey Bloodline #${tokenId}`,
    description: 'A bloodline of Throbbin Abbey. It is soulbound — it cannot '
      + 'be sold, sent or given away, and belongs to the wallet that raised it. '
      + 'It holds a fixed number of Cultists, set that day and never added to. '
      + 'Its Devotion is earned, and rises for as long as the line is kept.',
    external_url: `https://membersonly.cc/?bloodline=${tokenId}`,
    image: `https://membersonly.cc/nft/${tokenId}/image.svg`,
    attributes: [
      { trait_type: 'Cultists', value: cultists },
      { trait_type: 'Devotion', value: devotion },
      { trait_type: 'Streak', value: streak },
      { trait_type: 'Payout Multiplier', value: `${cultists}x` },
      { trait_type: 'Soulbound', value: 'Yes' },
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
        fill="#e85a4a" text-anchor="middle">THROBBIN ABBEY</text>
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
// cultists is the final payout multiplier, anyone could name someone
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
  || '0x78b796dcCadD44825A6A75AfC8BeB13d6a9Cb878';

// Two failures live here and they are NOT the same thing, so they are thrown
// apart. A dead RPC must fail closed (nobody gets bound on an unverified
// claim); a revert means the chain answered perfectly well and the token simply
// does not exist, which is the caller's mistake and not an outage.
class ChainDown extends Error {}
class NoSuchToken extends Error {}

// Any JSON-RPC method. Verifying a payment needs eth_getTransactionByHash and
// eth_getTransactionReceipt, which are not eth_call — chainCall below stays as
// the contract-read shorthand it always was and now sits on top of this.
async function rpc(method, params) {
  let body;
  try {
    const res = await fetch(AVAX_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new ChainDown(`RPC HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new ChainDown(e.message);
  }
  if (body.error) throw new NoSuchToken(body.error.message || 'reverted');
  return body.result;
}

async function chainCall(data) {
  const result = await rpc('eth_call', [{ to: BLOODLINE_ADDRESS, data }, 'latest']);
  // ownerOf() reverts on an unminted id, and a bare '0x' is the same answer
  // from a node that would rather not say so.
  if (!result || result === '0x') throw new NoSuchToken('empty result');
  return result;
}

const padUint256 = (n) => BigInt(n).toString(16).padStart(64, '0');

// pricePerCultist(), cached for the life of the process.
//
// Safe to cache because it CANNOT change: the deploy workflow's own note says
// price, supply and both payout addresses are immutable once the contract is
// out, and there is no setter. So this is one RPC call per boot rather than one
// per confession, and a confession is not held up by a slow node.
//
// Null when the chain cannot be reached. Callers must treat that as "the price
// is unknown", never as "free" — see the refusal in /confession.
let _pricePerCultistWei = null;
async function pricePerCultistWei() {
  if (_pricePerCultistWei !== null) return _pricePerCultistWei;
  try {
    const hex = await chainCall('0x9cb324c4');            // pricePerCultist()
    const wei = BigInt(hex || '0x0');
    if (wei <= 0n) return null;                            // nonsense, do not cache
    _pricePerCultistWei = wei;
    return wei;
  } catch {
    return null;                                           // not cached: retry next time
  }
}

// What mending this player's streak costs, right now. Both inputs are the
// abbey's own: the week from the abbey's clock, the Cultists from the row that
// /bind verified against the chain.
async function confessionPriceFor(player, now = new Date()) {
  const price = await pricePerCultistWei();
  if (price === null) return null;
  const week = abbeyWeek(now);
  const wei = confessionCostWei(price, player.cultists || 0, week);
  return {
    week,
    pct: confessionPct(week),
    cultists: player.cultists || 0,
    wei: wei.toString(),
    avax: weiToAvax(wei),
  };
}

// ── WHERE THE MONEY GOES ────────────────────────────────────────────────────
//
// The treasury address is READ FROM THE CONTRACT, not configured. `treasury` is
// an immutable public on the deployed contract, so the chain is the authority
// on where its money goes and there is no way for a wrong value in a file, or a
// wrong value pasted into a chat, to send a player's AVAX somewhere else.
//
// CONFESSION_TREASURY is a cross-check, not the source: if the chain disagrees
// with it the server refuses to take money at all and says so in the log. A
// mismatch means one of the two is wrong and neither is safe to act on.
const CONFESSION_TREASURY = String(
  process.env.CONFESSION_TREASURY || '0xda74c09ec68a291287e92e7e0e68a17b824d6b0e',
).toLowerCase();

let _treasury = null;
async function treasuryFromChain() {
  if (_treasury !== null) return _treasury;
  try {
    const hex = await chainCall('0x61d027b3');                 // treasury()
    const addr = '0x' + String(hex).replace(/^0x/, '').slice(-40).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr) || addr === `0x${'0'.repeat(40)}`) return null;
    _treasury = addr;
    return addr;
  } catch {
    return null;                                               // not cached: retry
  }
}

// The treasury to send to, or null if it cannot be established with confidence.
async function payableTreasury(log) {
  const onChain = await treasuryFromChain();
  if (!onChain) return null;
  if (onChain !== CONFESSION_TREASURY) {
    if (log) {
      log.error({ onChain, configured: CONFESSION_TREASURY },
        'treasury MISMATCH — the chain and the configured address disagree, refusing to collect');
    }
    return null;
  }
  return onChain;
}

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

// A Bloodline that was never named. Older rows stored the fallback STRING
// rather than NULL, which made them look named to every check that asked — so
// they could never be named afterwards, and the NFT metadata rendered them as
// "Bloodline #7 — Bloodline #7". Both spellings of "no name" are accepted here.
function isUnnamed(name, tokenId) {
  return !name || String(name).trim() === '' || String(name).trim() === `Bloodline #${tokenId}`;
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
  const addr = String(address).toLowerCase();

  // Already bound? Refresh the cached Cultist count and hand the row back.
  const bound = db.prepare('SELECT * FROM players WHERE wallet = ? AND token_id = ?').get(w, tid);
  if (bound) {
    if (bound.cultists !== onChain.cultists) {
      db.prepare('UPDATE players SET cultists = ? WHERE id = ?').run(onChain.cultists, bound.id);
    }
    // Kept current: the token can change hands, and this row follows the
    // holder. It is also how rows bound before the column existed acquire one.
    if (bound.address !== addr) {
      db.prepare('UPDATE players SET address = ? WHERE id = ?').run(addr, bound.id);
    }
    // Named ONCE, but not necessarily at creation. A line that is still
    // unnamed may take a name at any time — the entrance offers it at the mint
    // and LINES offers it afterwards — and one that has a name keeps it.
    if (cleanName && isUnnamed(bound.bloodline_name, tid)) {
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
        token_id = ?, cultists = ?, bloodline_name = ?, address = ?,
        devotion = 0, streak = 0, level = 1, last_duty_date = NULL, confession_count = 0,
        flags_date = ?, pray_today = 0, garden_today = 0, candles_today = 0,
        scourge_today = 0, gifts_given_today = 0, gifts_received_today = 0
      WHERE id = ?`).run(tid, onChain.cultists, cleanName || null, addr, todayStr(), ghost.id);
    return ensureFreshDay(db, db.prepare('SELECT * FROM players WHERE id = ?').get(ghost.id));
  }

  // Otherwise this is a second (or third) Bloodline for a wallet that already
  // plays one: a new row, its own Devotion, carrying the name across.
  const sibling = db.prepare('SELECT * FROM players WHERE wallet = ? ORDER BY created_at LIMIT 1').get(w);
  const player = {
    id: randomUUID(),
    wallet: w,
    address: addr,
    token_id: tid,
    cultists: onChain.cultists,
    bloodline_name: cleanName || null,
    name: sibling ? sibling.name : `Bloodline ${tid}`,
    prefix: sibling ? sibling.prefix : 'Brother',
    sex: sibling ? sibling.sex : 'male',
    // NOT carried across from the sibling, however tempting the symmetry with
    // name/prefix/sex looks. An X handle is unique across the whole abbey
    // (idx_players_x_handle), because it is how one PERSON is told from
    // another when a referral is credited. Copying it onto the second row
    // violated that index, so the INSERT threw and every attempt to bind a
    // second Bloodline died as a 500 — the holder could mint it and never
    // play it. The handle stays on the row that already carries it; referral
    // lookups find that row and pay it, which is the behaviour either way.
    x_handle: null,
    created_at: new Date().toISOString(),
    flags_date: todayStr(),
  };
  // A constraint failure here used to surface as a bare 500, which told the
  // player nothing and told the log only a column name. Binding is the one
  // call standing between a paid-for Bloodline and being able to play it, so
  // it says which Bloodline and what went wrong.
  try {
    db.prepare(`
      INSERT INTO players (id, wallet, address, token_id, cultists, bloodline_name, name, prefix, sex, x_handle, created_at, flags_date)
      VALUES (@id, @wallet, @address, @token_id, @cultists, @bloodline_name, @name, @prefix, @sex, @x_handle, @created_at, @flags_date)
    `).run(player);
  } catch (e) {
    req.log.error({ err: e, tokenId: tid, wallet: w }, 'bind: could not create the Bloodline row');
    return reply.code(500).send({ error: `Bloodline #${tid} could not be taken up: ${e.message}` });
  }
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
  // Whether this holder has already been brought in by someone. Asked of BOTH
  // identities, for the same reason /referral writes by address: new rows are
  // keyed to the on-chain address and older ones to the browser's pseudo-id,
  // and looking under only one of them would tell a referred player they had
  // never been referred — and then ask them again.
  const wid = String(wallet).toLowerCase();
  const referral = db.prepare('SELECT referrer_handle FROM referrals WHERE referee_wallet IN (?, ?)')
    .get(wid, fresh.address || wid);
  // Asked and declined counts as answered. Without this the client only knew
  // about referrals that SUCCEEDED, so anyone who said "not now" was asked
  // again on every connect, for good.
  //
  // Still keyed to the browser: a decline is "do not nag me here", which is a
  // property of the session rather than of the wallet, and it does not pay
  // anything so there is nothing to double-claim.
  const declined = db.prepare('SELECT 1 FROM referral_declines WHERE wallet = ?').get(wid);
  // The price of mending, so the Confessor can name it before the player
  // kneels rather than after. Null when nothing is owed, and also null when the
  // chain could not be reached — the client must say "unknown", not "free".
  const price = pending ? await confessionPriceFor(fresh) : null;
  // What the board behind the west stair reads out. All of it is derived, none
  // of it is stored: the numbers cannot drift from the rules that produce them.
  const clock = abbeyClock();
  const mult = streakMultiplier(fresh.streak);
  const perTask = taskDevotionForWeek(clock.week);
  // Referral earnings, both directions. `devotion_each` is what was paid to
  // each side at the time, so this stays true even if the rate ever changes.
  const key = fresh.address || String(wallet).toLowerCase();
  const broughtMe = db.prepare('SELECT devotion_each FROM referrals WHERE referee_wallet IN (?, ?)')
    .get(String(wallet).toLowerCase(), key);
  const broughtOthers = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(devotion_each), 0) d FROM referrals WHERE referrer_wallet IN (?, ?)')
    .get(String(wallet).toLowerCase(), key);
  return {
    ...fresh,
    multiplier: mult,
    taskDevotion: { base: perTask, award: taskAward(clock.week, fresh.streak), week: clock.week },
    clock,
    referralDevotion: {
      asReferee: broughtMe ? broughtMe.devotion_each : 0,
      broughtIn: broughtOthers.n,
      fromBringing: broughtOthers.d,
      total: (broughtMe ? broughtMe.devotion_each : 0) + broughtOthers.d,
    },
    needsConfession: !!pending,
    confessionCost: price ? price.avax : null,
    confessionPrice: price,
    referred: referral ? referral.referrer_handle : null,
    referralAsked: !!(referral || declined),
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

// ========== CONFESSION ==========
// The price is a percentage of what the Bloodline cost to raise — 25% in week
// one, 50% weeks 2-4, 100% weeks 5-7, 200% in week 8 — times its Cultists. See
// confessionCostWei in gameLogic.js.
//
// IT COLLECTS. Nothing is forgiven until a real payment has been found on the
// chain and checked five ways. A `txHash` is not a receipt because the client
// says so — the client is the party with the motive — so every one of these is
// verified server-side against the node, and any one of them failing means the
// streak stays broken:
//
//   1. the transaction exists and its receipt says status 0x1 (it succeeded)
//   2. `to` is the treasury, read from the contract, not from a config file
//   3. `value` is at least the wei quoted for THIS player, this week
//   4. the sender still owns the Bloodline being mended
//   5. that hash has not already been spent on a confession
//
// (4) is what stops one payment mending a stranger's line, and (5) is what
// stops the same payment mending the same line twice. The UNIQUE index on
// streak_logs.tx_hash is the real guard for (5): the check below is the polite
// version, and the index is what holds when two requests race.
//
// Called with no txHash it answers 402 with the quote, so the client's first
// move is always "ask what it costs" and never a guess.
fastify.post('/confession', async (req, reply) => {
  const { wallet, tokenId, txHash } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });

  const player = playerFor(wallet, tokenId);
  if (!player) return reply.code(404).send({ error: 'Player not found' });
  if (requireBloodline(player, reply)) return reply;

  const fresh = ensureFreshDay(db, player);
  const pending = pendingConfession(db, fresh.id);
  if (!pending) return reply.code(400).send({ error: 'No broken streak to confess' });

  // A price that cannot be worked out is not a price of zero. If the chain is
  // unreachable the abbey does not know what to charge, and forgiving on the
  // house is the wrong side to fail on for something that is meant to cost.
  const price = await confessionPriceFor(fresh);
  if (!price) {
    return reply.code(503).send({ error: 'The abbey cannot read its own ledger. Try again in a moment.' });
  }

  const treasury = await payableTreasury(req.log);
  if (!treasury) {
    return reply.code(503).send({ error: 'The abbey cannot say where its own coffer is. Nothing was taken.' });
  }

  // No payment yet: quote, and say where to send it.
  if (!txHash) {
    return reply.code(402).send({
      error: `The mending costs ${price.avax} AVAX.`,
      price,
      payTo: treasury,
    });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(String(txHash))) {
    return reply.code(400).send({ error: 'That is not a transaction hash.' });
  }
  const hash = String(txHash).toLowerCase();

  // (5), the polite half. The index is the half that holds under a race.
  const spent = db.prepare('SELECT 1 FROM streak_logs WHERE tx_hash = ?').get(hash);
  if (spent) return reply.code(409).send({ error: 'That payment has already been spent on a confession.' });

  let tx;
  let receipt;
  try {
    tx = await rpc('eth_getTransactionByHash', [hash]);
    receipt = await rpc('eth_getTransactionReceipt', [hash]);
  } catch (e) {
    req.log.error({ err: e, hash }, 'confession: could not read the payment');
    return reply.code(503).send({ error: 'The chain could not be reached to check that payment. Nothing was taken.' });
  }

  if (!tx) return reply.code(404).send({ error: 'No such transaction. If it was just sent, wait a moment and try again.' });
  if (!receipt) return reply.code(425).send({ error: 'That payment has not been sealed yet. Try again in a moment.' });
  if (String(receipt.status) !== '0x1') {
    return reply.code(400).send({ error: 'That transaction failed on the chain.' });
  }

  const to = String(tx.to || '').toLowerCase();
  if (to !== treasury) {
    req.log.warn({ hash, to, treasury }, 'confession: payment sent somewhere other than the treasury');
    return reply.code(400).send({ error: 'That payment did not go to the abbey.' });
  }

  const paid = BigInt(tx.value || '0x0');
  const owed = BigInt(price.wei);
  if (paid < owed) {
    return reply.code(402).send({
      error: `That is not enough. The mending costs ${price.avax} AVAX.`,
      price,
      payTo: treasury,
    });
  }

  // (4). The payer must still hold the line being mended — otherwise a
  // stranger's payment, or an old one from a wallet that has since sold up,
  // would mend somebody else's streak.
  const from = String(tx.from || '').toLowerCase();
  try {
    const onChain = await readTokenFromChain(fresh.token_id);
    if (onChain.owner !== from) {
      return reply.code(403).send({ error: 'That payment did not come from the wallet holding this Bloodline.' });
    }
  } catch (e) {
    req.log.error({ err: e, tokenId: fresh.token_id }, 'confession: could not verify the holder');
    return reply.code(503).send({ error: 'The chain could not be reached to check that Bloodline. Nothing was taken.' });
  }

  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE streak_logs SET confessed = 1, confessed_at = ?, cost_eth = ?, tx_hash = ?
      WHERE id = ?
    `).run(now, price.avax, hash, pending.id);
  } catch (e) {
    // The UNIQUE index firing here means another request banked this same hash
    // between the check above and now. That is the race the index exists for.
    if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
      return reply.code(409).send({ error: 'That payment has already been spent on a confession.' });
    }
    throw e;
  }

  // Forgive the break: restore the streak the player had going into it, and
  // back-date last_duty_date to "yesterday" so today's duties continue it.
  db.prepare(`
    UPDATE players
    SET confession_count = confession_count + 1, streak = ?, last_duty_date = ?
    WHERE id = ?
  `).run(pending.streak_before, todayStr(new Date(Date.now() - 86400000)), fresh.id);

  return {
    success: true,
    costPaid: price.avax,
    price,
    txHash: hash,
    confessionCount: fresh.confession_count + 1,
    restoredStreak: pending.streak_before,
    collected: true,
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

  // The week's base times this player's own multiplier. Both halves matter:
  // the base is the calendar's and the same for everyone, the multiplier is
  // theirs and earned by not missing a day.
  const week = abbeyWeek();
  const multiplier = streakMultiplier(fresh.streak);
  const devotionGained = taskAward(week, fresh.streak);

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
    base: taskDevotionForWeek(week),
    week,
    streakBonus: devotionGained - taskDevotionForWeek(week),
    streakAdvanced,
    streak: newStreak,
    multiplier: streakMultiplier(newStreak),
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
// Only one interaction pays now: a comment carrying X_PHRASE. Verification has
// to read the reply's TEXT, not merely that a reply exists, or the phrase rule
// is decoration. Until that is wired, this refuses and the endpoint refuses
// with it -- scripts/x-scan.js is the working path, and it does the same
// checks against the same ledger.
async function verifyXInteraction(handle, kind, postId) {
  if (kind !== 'comment') return { ok: false, reason: 'only_comments_pay' };
  if (!process.env.X_BEARER_TOKEN) return { ok: false, reason: 'not_configured' };
  // TODO: fetch the reply by `handle` on `postId` and test matchesPhrase(text).
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
// The question was put and not answered with a handle. Recorded so it is never
// put again — a referral is asked ONCE. Deliberately forgiving: no Bloodline is
// required (a ghost may be asked too) and re-declining is not an error, because
// this is only ever called to close a prompt the player has already dismissed.
fastify.post('/referral/decline', async (req, reply) => {
  const { wallet } = req.body || {};
  if (!wallet) return reply.code(400).send({ error: 'Missing wallet' });
  const w = String(wallet).toLowerCase();
  db.prepare('INSERT OR IGNORE INTO referral_declines (wallet, created_at) VALUES (?, ?)')
    .run(w, new Date().toISOString());
  return { success: true, referralAsked: true };
});

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

  // WHO YOU ARE, for a referral, is the on-chain address — not `wallet`.
  //
  // `wallet` is a pseudo-id generated per BROWSER and kept in localStorage, so
  // two different wallets used in the same browser carry the same one. That is
  // the bug this replaced: connect wallet A, carve a handle on its Bloodline,
  // switch to wallet B in the same browser, name A as your referrer — and the
  // server compared browser ids, found them equal, and answered "you cannot
  // bring yourself into the abbey" to two genuinely different people.
  //
  // Rows bound before players.address existed have none, so both checks fall
  // back to the browser id for those. That is the old behaviour, kept only
  // where there is nothing better to go on.
  const w = String(wallet).toLowerCase();
  const refereeAddr = referee.address || null;

  // Already referred? Asked of BOTH identities on purpose. New rows are keyed
  // by address, older ones by browser id, and a player must not be able to
  // collect the referral twice by having been written under each.
  const already = db.prepare('SELECT * FROM referrals WHERE referee_wallet IN (?, ?)')
    .get(w, refereeAddr || w);
  if (already) {
    return reply.code(409).send({ error: `You were already brought in by @${already.referrer_handle}` });
  }

  // The referrer must hold a Bloodline too, or the 10 Devotion would be paid
  // onto a ghost row that is not allowed to earn any.
  const referrer = db.prepare('SELECT * FROM players WHERE x_handle = ? COLLATE NOCASE AND token_id IS NOT NULL').get(handle);
  if (!referrer) return reply.code(404).send({ error: 'No Cultist here goes by that handle' });

  // The referrer's cap. Counted under both identities for the same reason the
  // "already referred" check is: rows written before players.address existed
  // are keyed by browser id, and a cap that only sees half a player's rows is
  // no cap. Refused rather than paid one-sided, because a referral row carries
  // ONE devotion_each figure for both parties — there is nowhere in the shape
  // of the row to record "paid the referee, not the referrer".
  const broughtAlready = db.prepare('SELECT COUNT(*) n FROM referrals WHERE referrer_wallet IN (?, ?)')
    .get(referrer.address || referrer.wallet, referrer.wallet).n;
  if (broughtAlready >= REFERRAL_CAP) {
    return reply.code(409).send({
      error: `@${referrer.x_handle} has already brought in ${REFERRAL_CAP}, which is all anyone may. Name someone else.`,
    });
  }

  const sameWallet = refereeAddr && referrer.address && refereeAddr === referrer.address;
  const sameBrowserAndNoBetter = (!refereeAddr || !referrer.address) && referrer.wallet === w;
  if (sameWallet || sameBrowserAndNoBetter) {
    return reply.code(400).send({ error: 'You cannot bring yourself into the abbey' });
  }

  // Keyed by address where we have one, so the row means "this wallet was
  // brought in" rather than "this browser was".
  const refereeKey = refereeAddr || w;
  const referrerKey = referrer.address || referrer.wallet;
  const mutual = db.prepare('SELECT 1 FROM referrals WHERE referee_wallet = ? AND referrer_wallet = ?')
    .get(referrerKey, refereeKey);
  if (mutual) return reply.code(409).send({ error: 'You already brought them in' });

  const amount = REFERRAL_DEVOTION;
  const now = new Date().toISOString();
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO referrals
        (referee_wallet, referee_player_id, referrer_wallet, referrer_player_id, referrer_handle, devotion_each, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(refereeKey, referee.id, referrerKey, referrer.id, referrer.x_handle, amount, now);
      db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, referee.id);
      db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?').run(amount, referrer.id);
    })();
  } catch (e) {
    // The UNIQUE on referee_wallet is the real guard against two requests
    // racing; losing that race is "already referred", not a server fault.
    //
    // But it has to actually BE that. This used to answer every failure in the
    // transaction with "already brought in", so a constraint error of any other
    // kind — a malformed player row, a NOT NULL on referee_player_id — told the
    // player they were already referred while nothing had been written. Nothing
    // ever locked in, the message said it had, and the server log said nothing
    // at all. Anything that is not the duplicate is now reported as the fault
    // it is, and logged.
    if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
      return reply.code(409).send({ error: 'You have already been brought in' });
    }
    req.log.error({ err: e, wallet: w, handle }, 'referral: could not be recorded');
    return reply.code(500).send({ error: 'The abbey could not record that. Try again in a moment.' });
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

  // Two a day. Checked BEFORE the trip to X, so a player who has already had
  // their two is told so instead of waiting on a verification that cannot pay.
  const todayClaims = db.prepare(
    "SELECT COUNT(*) n FROM x_interactions WHERE player_id = ? AND substr(awarded_at, 1, 10) = ?"
  ).get(player.id, todayStr()).n;
  if (todayClaims >= X_DAILY_CLAIMS) {
    return reply.code(429).send({
      error: `The abbey hears you ${X_DAILY_CLAIMS} times a day, and has heard you twice. Come back tomorrow.`,
      dailyCap: X_DAILY_CLAIMS,
    });
  }

  const check = await verifyXInteraction(player.x_handle, kind, String(postId));
  if (!check.ok) {
    return reply.code(503).send({ error: 'X verification unavailable', reason: check.reason });
  }

  const amount = X_COMMENT_DEVOTION;
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
    `SELECT token_id, bloodline_name, cultists, devotion, streak, x_handle FROM players WHERE token_id IN (${holes})`
  ).all(...ids);
  reply.header('Cache-Control', 'no-store');
  return rows;
});

// ========== THE ABBEY'S CLOCK ==========
// One eight-week playthrough, day 0 being the day the contract was deployed.
// No seasons, no break, no Final Communion — just where the run stands and what
// that means for the price of mending a streak.
// WHICH COLLECTION THE ABBEY IS READING. The client holds the same address in
// a meta tag, and the two must agree — this endpoint is what lets it check.
//
// It exists because of a real failure. After the redeploy, a browser still
// running the cached page read the OLD collection, found the Bloodlines that
// wallet held there, and asked to bind a token the NEW collection has never
// minted. The server answered, correctly and uselessly, "No such Bloodline has
// been raised" — a true statement that told the player nothing about what was
// actually wrong or what to do about it.
//
// A stale page cannot know it is stale by looking at itself. It has to ask.
fastify.get('/collection', async (req, reply) => {
  reply.header('Cache-Control', 'no-store');
  return { address: BLOODLINE_ADDRESS, chainId: 43114 };
});

fastify.get('/day', async () => {
  const clock = abbeyClock();
  return { ...clock, confessionPct: confessionPct(clock.week) };
});

// ========== CATHEDRAL ROOMS (ownable alcoves, GDD section 9) ==========
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

// The mancala table is gone, and with it the wager game, its solo Abbot
// opponent and the shared two-seat table. The room it stood in remains: an
// alcove off the transept with benches and no rite in it.
//
// Removed rather than left dark. It was the only thing in the abbey that
// staked anything, and a half-wired wager table is worse than none.

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const netId = assignNet();
    // WHITELISTED, not spread. `...data` put whatever the client sent into a
    // record that is partly relayed to other players, and the client was
    // sending its wallet credential — which the tick then handed to everyone
    // nearby as peers[].id. Naming the fields here is what makes it impossible
    // for a new field to become a new leak by accident.
    //
    // `wallet` and `tokenId` are kept because a duty claim has to be matched to
    // a live session, and they are NEVER put on the wire again — see the
    // interest tick, which sends `seed` and nothing else that identifies.
    const d = data || {};
    online.set(socket.id, {
      seed: typeof d.seed === 'string' ? d.seed.slice(0, 32) : null,
      wallet: typeof d.wallet === 'string' ? d.wallet.slice(0, 64) : null,
      tokenId: Number.isInteger(d.tokenId) && d.tokenId > 0 ? d.tokenId : null,
      name: typeof d.name === 'string' ? d.name.slice(0, 32) : '',
      prefix: typeof d.prefix === 'string' ? d.prefix.slice(0, 12) : '',
      x: typeof d.x === 'number' ? d.x : undefined,
      y: typeof d.y === 'number' ? d.y : undefined,
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





  socket.on('disconnect', () => {
    const p = online.get(socket.id);
    if (p) {
      releaseNet(p.netId);
      socket.broadcast.emit('peer_left', { net: p.netId });
      online.delete(socket.id);
    }
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
          // The SEED, never the wallet id and never the token id. This line
          // used to send other.tokenId, which the client had filled with
          // getWalletId() — the credential — and it is used at the far end for
          // nothing but choosing a face.
          seed: other.seed || null,
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
