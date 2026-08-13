// Core Devotion / streak rules — see docs/Throbbin_Abbey_GDD.md sections 5-6,
// which describes what this file implements rather than the other way round.

// The three daily duties. These ids are what the database columns and the API
// are keyed on; DUTY_NAMES carries what the abbey actually calls them, so the
// display name can change without a migration.
export const DUTIES = ['candles', 'scourge', 'garden'];
export const DUTY_NAMES = {
  candles: 'Light Fire',
  scourge: 'Whipping',
  garden: 'Skull Chant',
};

// ── WHAT A DUTY PAYS ────────────────────────────────────────────────────────
//
// The base rises with the CALENDAR week — the same for everybody, whenever they
// joined — so that a player arriving in week five is not hopelessly behind a
// player who arrived on day one. It is why a late joiner can still compete:
// their days are worth more than the early player's days were.
//
// Weeks 1-8. Past the end of the run it holds at the week-8 value rather than
// falling off a cliff or wrapping round.
export const WEEK_TASK_DEVOTION = [10, 12, 15, 20, 28, 38, 50, 60];

export function taskDevotionForWeek(week) {
  const i = Math.max(1, Math.floor(week || 1)) - 1;
  return WEEK_TASK_DEVOTION[Math.min(i, WEEK_TASK_DEVOTION.length - 1)];
}

// Kept as the week-1 value, because a few places still want "what a duty is
// worth" as a constant and week 1 is the honest answer to that.
export const DUTY_DEVOTION = WEEK_TASK_DEVOTION[0];

// Devotion for engagement on X. These are per interaction, and each one is
// credited exactly once — the ledger is keyed on (player, kind, post), so
// unliking and liking again does not pay twice.
// Engagement on X pays for ONE act: commenting the phrase. Likes and reposts
// no longer pay anything — they are free to manufacture and were worth 2 and 5
// against a comment's 3, which paid most for what costs least.
//
// Five apiece, two a day: ten a day, 560 across the run. That is deliberately
// a fraction of what the duties pay — X is meant to be worth doing, not worth
// doing INSTEAD, and a comment costs a player nothing but the typing.
//
// Two guards, and they do different jobs. The per-post ledger stops the same
// post being claimed twice; X_DAILY_CLAIMS stops a player clearing a backlog of
// twenty old posts in one sitting. Neither alone is enough.
export const X_COMMENT_DEVOTION = 5;
export const X_DAILY_CLAIMS = 2;
export const X_DEVOTION = { comment: X_COMMENT_DEVOTION };

// What has to be in the comment, word for word in meaning if not in spacing.
// This is what the abbey ASKS for now that it is Throbbin Abbey.
export const X_PHRASE = 'Eternal Throb, Eternal Life';

// The Latin motto the abbey asked for before the rename. Still accepted, and
// deliberately so: comments carrying it were posted in good faith against the
// instructions of the day, and a rename must not turn a paid comment into an
// unpaid one. Drop this from the array to stop honouring it.
const X_PHRASES = [X_PHRASE, 'Sanguis Aeternus, Vita Aeterna'];

// Matching is deliberately forgiving about the things a phone does to a person
// typing a motto -- case, curly apostrophes, doubled spaces, a trailing full
// stop, a comma they dropped -- and strict about the words themselves and
// their order. Someone who typed the motto should be paid; someone who typed
// half of it should not.
export function matchesPhrase(text) {
  const norm = (v) => String(v || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z ]+/g, ' ')      // drop punctuation, keep word boundaries
    .replace(/\s+/g, ' ')
    .trim();
  const t = norm(text);
  return X_PHRASES.some((p) => t.includes(norm(p)));
}
// Paid to BOTH sides of a referral, once. Deliberately the same as a duty:
// bringing someone into the abbey is worth a day's work, not a fortune.
export const REFERRAL_DEVOTION = 10;
// And no more than this many, ever, per Bloodline. Uncapped, referrals are the
// one earner with no daily ceiling and no work in them — a player with a
// following could out-earn eight weeks of duties in an afternoon. Ten is the
// top of the range the design document asks for; it is one number to change.
export const REFERRAL_CAP = 10;
export const X_KINDS = Object.keys(X_DEVOTION);

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function yesterdayStr(d = new Date()) {
  const y = new Date(d);
  y.setUTCDate(y.getUTCDate() - 1);
  return todayStr(y);
}

// ── THE STREAK MULTIPLIER ───────────────────────────────────────────────────
//
// Earned by keeping a streak, and it is the PLAYER'S OWN run of days that sets
// it — not the calendar. A player who starts in week three and never misses is
// on 1.0x in their first week exactly like everyone else was in theirs.
//
// The rule: a full week of all three duties unlocks 1.1x, and every further
// TWO weeks of unbroken streak adds another 0.1x.
//
//   days 0-6   1.0x      days 21-34  1.2x      days 49+   1.4x
//   days 7-20  1.1x      days 35-48  1.3x
//
// This is not the old curve (1.5x at a week, 3.0x at four, and a free 3.0x at
// level 10). It is much flatter, which is the point: it rewards turning up
// without letting an early player run away with the season on multiplier alone.
//
// TASKS ONLY. X interactions and referrals are paid flat — see the callers.
export function streakMultiplier(streak) {
  const days = Math.max(0, Math.floor(Number(streak) || 0));
  if (days < 7) return 1.0;
  return Math.round((1.1 + 0.1 * Math.floor((days - 7) / 14)) * 10) / 10;
}

// What one duty pays this player, right now: the week's base times their own
// multiplier. Rounded, because devotion is an integer column — the design
// document's totals assume exact arithmetic, so a run of these lands within a
// point or two of its figures rather than exactly on them.
export function taskAward(week, streak) {
  return Math.round(taskDevotionForWeek(week) * streakMultiplier(streak));
}

// ── WHAT A CONFESSION COSTS ─────────────────────────────────────────────────
//
// A fraction of what the Bloodline cost to raise, rising over the abbey's first
// eight weeks. Mending a streak should hurt more the longer the abbey has been
// standing — a break in week one is a stumble, a break in week eight is two
// months of keeping thrown away — and it should scale with what the line is
// worth, so a twenty-Cultist holder does not mend for the same price as a
// one-Cultist holder.
//
// The multiplier is a percentage OF THE MINT PRICE of the whole Bloodline, i.e.
// pricePerCultist x cultists. Week 1 costs a quarter of what the line cost to
// raise; week 8 costs double it.
//
// This replaces a flat 0.005 + 0.001 per previous confession. That escalated
// with the number of confessions rather than with the calendar or the holding,
// and is deliberately NOT kept as an extra factor here — the price is the
// week and the Cultists, and nothing else, so a player can work it out.
export const CONFESSION_WEEK_PCT = [
  { throughWeek: 1, pct: 25 },
  { throughWeek: 4, pct: 50 },
  { throughWeek: 7, pct: 100 },
  { throughWeek: 8, pct: 200 },
];

// The percentage for a week. Week 8 is the last band and the run ends with it,
// but it is written as a FLOOR rather than a ceiling: if the clock is ever read
// past the end, mending must not become cheap again just because time passed.
export function confessionPct(week) {
  const last = CONFESSION_WEEK_PCT[CONFESSION_WEEK_PCT.length - 1];
  if (!week || week < 1) return CONFESSION_WEEK_PCT[0].pct;
  for (const band of CONFESSION_WEEK_PCT) if (week <= band.throughWeek) return band.pct;
  return last.pct;
}

// In wei, and in BigInt throughout. The price of a Bloodline is a chain value
// and the percentages are exact hundredths, so there is no reason to let a
// float near this — a rounding error here is somebody's money.
export function confessionCostWei(pricePerCultistWei, cultists, week) {
  const price = BigInt(pricePerCultistWei || 0);
  const n = BigInt(Math.max(0, Math.floor(Number(cultists) || 0)));
  return (price * n * BigInt(confessionPct(week))) / 100n;
}

// The same number as AVAX, for display and for the cost_eth column. Lossy by
// nature — never charge from this, charge from the wei.
export function weiToAvax(wei, dp = 4) {
  return Number((Number(BigInt(wei || 0)) / 1e18).toFixed(dp));
}

// ── THE ABBEY'S CLOCK ───────────────────────────────────────────────────────
//
// One clock, running forward from the day the collection was deployed. There
// are no seasons: no 56-day cycle, no 14-day break, no season number, and no
// Final Communion at the end of one. It used to be all of those, anchored to a
// date somebody picked by hand — which had drifted so far that six days after
// the contract went live the abbey believed the season was over and sitting in
// its break, and quoted every confession at the week-8 rate because of it.
//
// The anchor is now the deployment itself, read from the deployments file the
// contract writes, so it cannot drift from the thing it is meant to track. The
// env var still wins, for a test server that wants to sit in a chosen week.
// A REDEPLOY MOVES DAY 0. This is the ThrobbinAbbeyBloodline deploy, which
// restarted the run from week 1 — the previous collection's 2026-08-02T02:29:39Z
// anchor went with it. Change this and contracts/deployments/avalanche.json
// together or the abbey's clock and the contract it is meant to track disagree.
const DEPLOYED_AT = '2026-08-09T02:53:08Z';    // contracts/deployments/avalanche.json

// ── HELD AT DAY 0 UNTIL SOMEBODY SAYS BEGIN ─────────────────────────────────
//
// Deploying and starting the run are two different events, and tying them
// together burns week 1 on an empty abbey. The mint has to open before anyone
// can hold a Bloodline, and the people who mint on the first afternoon should
// not be a week ahead of the people who mint on the second.
//
// So a launch can now open the doors and STOP. Nothing is counted, nothing is
// paid and no streak accrues until the run is begun — and the moment it is
// begun becomes day 0, for everybody at once.
//
// Precedence, in order:
//   1. ABBEY_START in the environment — an explicit override, unchanged. A test
//      server that wants to sit in week 6 still can.
//   2. the begin time recorded in the database, once somebody has said begin
//   3. ABBEY_AWAIT_BEGIN set — the run is PENDING and the clock is not running
//   4. DEPLOYED_AT — what it always did
//
// (3) is last-but-one on purpose: without it, deploying this to a server whose
// run is already underway would stop it dead. A launch sets ABBEY_AWAIT_BEGIN;
// an existing box carries on as before.
let _started = process.env.ABBEY_START ? new Date(process.env.ABBEY_START) : null;
let _awaitBegin = !!process.env.ABBEY_AWAIT_BEGIN && !process.env.ABBEY_START;

/// Hand the clock the begin time recorded in the database. Called once at boot
/// and again the moment the run is begun. The env override always wins, so a
/// test server pinned to a week cannot be moved by a stray row.
export function setAbbeyStart(when) {
  if (process.env.ABBEY_START) return;
  _started = when ? new Date(when) : null;
  if (_started) _awaitBegin = false;
}

/// Has the run begun? False only in the pending state.
export function abbeyStarted() {
  return !!_started || !_awaitBegin;
}

/// When day 0 is. Falls back to the deploy timestamp for a box that never had
/// a begin — which is every box that existed before this.
function startAt() {
  return _started || new Date(DEPLOYED_AT);
}

export const ABBEY_START = new Date(process.env.ABBEY_START || DEPLOYED_AT);

// ONE playthrough, eight weeks long. Not a season — nothing repeats after it
// and nothing resets. Day 0 is the day the contract was deployed, so the run is
// days 0 to 55 inclusive.
export const PLAYTHROUGH_WEEKS = 8;
export const PLAYTHROUGH_DAYS = PLAYTHROUGH_WEEKS * 7;      // 56, days 0..55

// Day 0 is deployment day. Zero-based deliberately: the contract going out is
// the starting gun, not the first day of play, and every other number here is
// derived from it.
export function abbeyDay(now = new Date()) {
  // A run that has not begun is at day 0 and stays there, however long it
  // waits. It is not day -3 and it is not day 12: it has not started.
  if (!abbeyStarted()) return 0;
  const elapsed = Math.floor((now.getTime() - startAt().getTime()) / 86400000);
  return Math.max(0, elapsed);
}

// Week 1 is days 0-6, week 8 is days 49-55. Past the end it keeps counting
// rather than clamping, so `ended` below is what says the run is over and the
// week number never quietly lies about which week it is.
export function abbeyWeek(now = new Date()) {
  return Math.floor(abbeyDay(now) / 7) + 1;
}

// Everything about where the run stands, in one place.
export function abbeyClock(now = new Date()) {
  const started = abbeyStarted();
  const day = abbeyDay(now);
  const week = abbeyWeek(now);
  // A pending run cannot be over. `ended` drives freezing the standings, and
  // freezing a run nobody has played would be the worst possible reading of
  // "the clock is not running".
  const ended = started && day >= PLAYTHROUGH_DAYS;
  return {
    started,
    day,
    week,
    ended,
    lastDay: PLAYTHROUGH_DAYS - 1,                            // 55
    daysLeft: !started ? PLAYTHROUGH_DAYS : (ended ? 0 : PLAYTHROUGH_DAYS - day),
    weeks: PLAYTHROUGH_WEEKS,
    since: started ? startAt().toISOString() : null,
  };
}

// Rolls a player's per-day duty flags/counters over to "today", logging a
// broken streak (if any) so /confession has something to forgive.
export function ensureFreshDay(db, player) {
  const today = todayStr();
  if (player.flags_date === today) return player;

  const yesterday = yesterdayStr();
  if (player.streak > 0 && player.last_duty_date && player.last_duty_date !== yesterday && player.last_duty_date !== today) {
    // cost_eth is left NULL here and filled in when the confession is actually
    // made. It used to be stamped at the moment of the break, which was a
    // guess: the price now depends on the week the player CONFESSES in, not
    // the week they stumbled, so a figure written here would be wrong for
    // anyone who came back later — and it is the figure they were charged.
    db.prepare(`
      INSERT INTO streak_logs (player_id, date, streak_before, broke, confessed, cost_eth)
      VALUES (?, ?, ?, 1, 0, NULL)
    `).run(player.id, today, player.streak);
    db.prepare('UPDATE players SET streak = 0 WHERE id = ?').run(player.id);
    player.streak = 0;
  }

  // The day rolls at 00:00 UTC: todayStr() is an ISO date, which is UTC by
  // construction, so there is no local-time drift to correct for here.
  db.prepare(`
    UPDATE players
    SET pray_today = 0, garden_today = 0, candles_today = 0,
        gifts_given_today = 0, gifts_received_today = 0, scourge_today = 0,
        flags_date = ?
    WHERE id = ?
  `).run(today, player.id);

  return {
    ...player,
    pray_today: 0, garden_today: 0, candles_today: 0,
    gifts_given_today: 0, gifts_received_today: 0, scourge_today: 0,
    flags_date: today,
  };
}

export function pendingConfession(db, playerId) {
  return db.prepare(`
    SELECT * FROM streak_logs
    WHERE player_id = ? AND broke = 1 AND confessed = 0
    ORDER BY id DESC LIMIT 1
  `).get(playerId);
}
