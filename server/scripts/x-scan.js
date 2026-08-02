#!/usr/bin/env node
/**
 * Scan X posts for the phrase and pay the Cultists who wrote it.
 *
 *   node scripts/x-scan.js <post-url-or-id> [more...]
 *   node scripts/x-scan.js --file posts.txt
 *   node scripts/x-scan.js --handles @a,@b --post <url>     (no API needed)
 *   node scripts/x-scan.js --dry-run <url>
 *
 * WHAT THIS CAN AND CANNOT DO — read this before wiring it into anything.
 *
 * X has no open way to read a post's replies. There is no scraping route that
 * survives: the public HTML is rendered behind a login wall, the endpoints the
 * web app itself calls are authenticated and rate-limited per session, and
 * anything that works today is a cat-and-mouse game that breaks silently and
 * pays the wrong people when it does. So this does not scrape. It asks the API.
 *
 * The API route it uses is `GET /2/tweets/search/recent?query=conversation_id:…`
 * and that carries two limits worth knowing BEFORE a season depends on it:
 *
 *   1. Recent search only reaches back SEVEN DAYS. A post older than that
 *      returns nothing, and nothing looks exactly like "no one commented".
 *      This script says which it is rather than paying zero people quietly.
 *   2. Recent search is not on the free tier. A free bearer token authenticates
 *      and then refuses this endpoint with a 403. The script reports that as a
 *      plan problem, not as an empty result.
 *
 * --handles exists because of the above. Paste the handles yourself — read off
 * the post, or exported from anywhere — and the awarding, the phrase rule, the
 * handle-to-Bloodline lookup and the once-only ledger all still apply. It is
 * the same payment path with a human doing the reading.
 *
 * Every award goes through the same UNIQUE (player_id, kind, post_id) the API
 * uses, so running this twice over the same post pays nobody twice.
 */
import 'dotenv/config';
import fs from 'node:fs';
import db from '../src/db/database.js';
import { X_COMMENT_DEVOTION, X_PHRASE, matchesPhrase } from '../src/lib/gameLogic.js';

const API = 'https://api.x.com/2';

// ---- arguments -------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const has = (name) => argv.includes(name);

const DRY = has('--dry-run');
const handlesArg = opt('--handles');
const fileArg = opt('--file');
const postArg = opt('--post');

// A post is given as a URL or a bare id; the id is the trailing number.
function postIdOf(s) {
  const m = String(s).trim().match(/(\d{5,25})(?:\?|$|\/)/);
  return m ? m[1] : null;
}

let posts = argv
  .filter((a) => !a.startsWith('--'))
  .filter((a) => a !== handlesArg && a !== fileArg && a !== postArg);
if (fileArg) {
  posts = posts.concat(
    fs.readFileSync(fileArg, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  );
}
if (postArg) posts.push(postArg);
posts = [...new Set(posts.map(postIdOf).filter(Boolean))];

if (!posts.length) {
  console.error('Give me at least one post URL or id.\n');
  console.error('  node scripts/x-scan.js https://x.com/vitaaeterna/status/1234567890');
  console.error('  node scripts/x-scan.js --file posts.txt');
  console.error('  node scripts/x-scan.js --post <url> --handles @one,@two');
  process.exit(1);
}

// ---- paying ----------------------------------------------------------------
const findPlayer = db.prepare(
  'SELECT * FROM players WHERE x_handle = ? COLLATE NOCASE AND token_id IS NOT NULL'
);
const alreadyPaid = db.prepare(
  "SELECT 1 FROM x_interactions WHERE player_id = ? AND kind = 'comment' AND post_id = ?"
);
const writeLedger = db.prepare(`
  INSERT INTO x_interactions (player_id, kind, post_id, devotion, awarded_at)
  VALUES (?, 'comment', ?, ?, ?)
`);
const addDevotion = db.prepare('UPDATE players SET devotion = devotion + ? WHERE id = ?');

const pay = db.transaction((player, postId) => {
  writeLedger.run(player.id, postId, X_COMMENT_DEVOTION, new Date().toISOString());
  addDevotion.run(X_COMMENT_DEVOTION, player.id);
});

/** @returns 'paid' | 'already' | 'no-bloodline' | 'unknown-handle' */
function award(handle, postId) {
  const player = findPlayer.get(handle);
  // A handle nobody has bound is not an error — most repliers will be strangers.
  // A handle bound to a row with no Bloodline cannot earn at all, by the same
  // rule the API enforces, so it is reported separately rather than lumped in.
  if (!player) {
    const ghost = db.prepare('SELECT 1 FROM players WHERE x_handle = ? COLLATE NOCASE').get(handle);
    return ghost ? 'no-bloodline' : 'unknown-handle';
  }
  if (alreadyPaid.get(player.id, postId)) return 'already';
  if (!DRY) pay(player, postId);
  return 'paid';
}

// ---- reading the replies ---------------------------------------------------
async function fetchReplies(postId) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    return { error: 'no-token' };
  }
  const url = `${API}/tweets/search/recent`
    + `?query=${encodeURIComponent(`conversation_id:${postId}`)}`
    + '&max_results=100&tweet.fields=author_id,text&expansions=author_id&user.fields=username';

  const out = [];
  let next = null;
  for (let page = 0; page < 10; page++) {
    const res = await fetch(next ? `${url}&next_token=${next}` : url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 403) return { error: 'plan', detail: await res.text() };
    if (res.status === 429) return { error: 'rate-limit' };
    if (!res.ok) return { error: 'http', detail: `${res.status} ${await res.text()}` };
    const body = await res.json();
    const users = new Map((body.includes?.users || []).map((u) => [u.id, u.username]));
    for (const t of body.data || []) out.push({ handle: users.get(t.author_id) || '', text: t.text });
    next = body.meta?.next_token;
    if (!next) break;
  }
  return { replies: out };
}

// ---- run -------------------------------------------------------------------
const tally = { paid: 0, already: 0, 'no-bloodline': 0, 'unknown-handle': 0, 'no-phrase': 0 };

console.log(`\nPhrase: "${X_PHRASE}"   ·   ${X_COMMENT_DEVOTION} Devotion per player per post`);
if (DRY) console.log('DRY RUN — nothing will be written.\n');

for (const postId of posts) {
  console.log(`\n── post ${postId} ─────────────────────────────`);

  // Manual mode: the handles were read off the post by a human.
  if (handlesArg) {
    const handles = handlesArg.split(',').map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
    console.log(`  ${handles.length} handle(s) given by hand — the phrase is assumed read.`);
    for (const h of handles) {
      const r = award(h, postId);
      tally[r]++;
      console.log(`  @${h.padEnd(16)} ${r}`);
    }
    continue;
  }

  const { replies, error, detail } = await fetchReplies(postId);
  if (error === 'no-token') {
    console.error('  X_BEARER_TOKEN is not set, so the replies cannot be read.');
    console.error('  Either set it, or pass the handles yourself:');
    console.error(`     node scripts/x-scan.js --post ${postId} --handles @one,@two`);
    continue;
  }
  if (error === 'plan') {
    console.error('  X refused the search endpoint (403). Recent search is not on the free');
    console.error('  tier — this is a plan problem, NOT "nobody replied".');
    if (detail) console.error(`  ${String(detail).slice(0, 200)}`);
    continue;
  }
  if (error === 'rate-limit') { console.error('  Rate limited (429). Wait and re-run; paying twice is impossible.'); continue; }
  if (error) { console.error(`  Could not read replies: ${detail || error}`); continue; }

  if (!replies.length) {
    console.log('  No replies came back. NOTE: recent search only reaches 7 days —');
    console.log('  an older post looks identical to one nobody answered.');
    continue;
  }
  console.log(`  ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} read.`);
  for (const r of replies) {
    if (!matchesPhrase(r.text)) { tally['no-phrase']++; continue; }
    if (!r.handle) { tally['unknown-handle']++; continue; }
    const res = award(r.handle, postId);
    tally[res]++;
    if (res !== 'unknown-handle') console.log(`  @${r.handle.padEnd(16)} ${res}`);
  }
}

console.log('\n──────────────────────────────────────────────');
console.log(`  paid            ${tally.paid}  (${tally.paid * X_COMMENT_DEVOTION} Devotion)`);
console.log(`  already paid    ${tally.already}`);
console.log(`  no Bloodline    ${tally['no-bloodline']}   (handle bound, but nothing minted — earns nothing)`);
console.log(`  handle unknown  ${tally['unknown-handle']}   (not a player)`);
console.log(`  phrase absent   ${tally['no-phrase']}`);
if (DRY) console.log('\n  DRY RUN — nothing was written.');
console.log('');
