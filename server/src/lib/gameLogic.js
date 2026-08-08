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

// Ten a task, and the streak multiplier is applied to each task as it is
// completed rather than being paid once when the set is finished. A player on
// a 28-day streak therefore sees 30 land three separate times instead of 10,
// 10, 40 — the reward arrives with the act that earned it.
export const DUTY_DEVOTION = 10;

// Devotion for engagement on X. These are per interaction, and each one is
// credited exactly once — the ledger is keyed on (player, kind, post), so
// unliking and liking again does not pay twice.
// Engagement on X pays for ONE act: commenting the phrase. Likes and reposts
// no longer pay anything — they are free to manufacture and were worth 2 and 5
// against a comment's 3, which paid most for what costs least.
//
// A flat 10 puts a comment level with a day's duty. It is claimable once per
// post per player, so the ceiling is the number of posts the abbey makes.
export const X_COMMENT_DEVOTION = 10;
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
export const X_KINDS = Object.keys(X_DEVOTION);

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function yesterdayStr(d = new Date()) {
  const y = new Date(d);
  y.setUTCDate(y.getUTCDate() - 1);
  return todayStr(y);
}

// Level 10+ always gets the max multiplier; below that it scales with streak length.
export function streakMultiplier(streak, level) {
  if (level >= 10) return 3.0;
  if (streak >= 28) return 3.0;
  if (streak >= 21) return 2.5;
  if (streak >= 14) return 2.0;
  if (streak >= 7) return 1.5;
  return 1.0;
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
const DEPLOYED_AT = '2026-08-02T02:29:39Z';    // contracts/deployments/avalanche.json
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
  const elapsed = Math.floor((now.getTime() - ABBEY_START.getTime()) / 86400000);
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
  const day = abbeyDay(now);
  const week = abbeyWeek(now);
  const ended = day >= PLAYTHROUGH_DAYS;
  return {
    day,
    week,
    ended,
    lastDay: PLAYTHROUGH_DAYS - 1,                            // 55
    daysLeft: ended ? 0 : PLAYTHROUGH_DAYS - day,
    weeks: PLAYTHROUGH_WEEKS,
    since: ABBEY_START.toISOString(),
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
