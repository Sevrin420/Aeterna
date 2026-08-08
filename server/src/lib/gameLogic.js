// Core Devotion / streak rules from docs/Throbbin_Abbey_GDD_v4.1.md section 5-6.
// Exact per-duty Devotion amounts aren't specified in the GDD (only gift and
// confession amounts are), so DUTY_DEVOTION below is this server's concrete
// choice for that gap, tuned to the documented multiplier curve.

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
// A fraction of what the Bloodline cost to raise, rising as the season runs on.
// The point is that mending a streak should hurt more the deeper into a season
// you are — a break in week one is a stumble, a break in week eight is most of
// the season thrown away — and that it should scale with what the line is
// worth, so a twenty-Cultist holder does not mend for the same price as a
// one-Cultist holder.
//
// The multiplier is a percentage OF THE MINT PRICE of the whole Bloodline, i.e.
// pricePerCultist x cultists. Week 1 costs a quarter of what the line cost to
// raise; week 8 costs double it.
//
// This replaces a flat 0.005 + 0.001 per previous confession. That escalated
// with the number of confessions rather than with the season or the holding,
// and is deliberately NOT kept as an extra factor here — the price is the
// week and the Cultists, and nothing else, so a player can work it out.
export const CONFESSION_WEEK_PCT = [
  { throughWeek: 1, pct: 25 },
  { throughWeek: 4, pct: 50 },
  { throughWeek: 7, pct: 100 },
  { throughWeek: 8, pct: 200 },
];

// Which week of the active season a given day falls in, 1-8. Days are 1-56, so
// week = ceil(day / 7). Null during the break, when there is no season week to
// be in — see confessionPct for what that means for the price.
export function seasonWeek(day) {
  if (!day || day < 1) return null;
  return Math.min(Math.ceil(day / 7), Math.ceil(SEASON_ACTIVE_DAYS / 7));
}

// The percentage for a week. During the break (week null) it holds at the
// week-8 rate rather than falling back to week 1: the break follows week 8, and
// a streak broken at the end of a season must not become cheap to mend simply
// because the season stopped.
export function confessionPct(week) {
  if (!week) return CONFESSION_WEEK_PCT[CONFESSION_WEEK_PCT.length - 1].pct;
  for (const band of CONFESSION_WEEK_PCT) if (week <= band.throughWeek) return band.pct;
  return CONFESSION_WEEK_PCT[CONFESSION_WEEK_PCT.length - 1].pct;
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

// Season structure from docs/Throbbin_Abbey_GDD_v4.1.md section 2: 56 days active
// play, then a 14-day break, repeating. SEASON_START is this server's
// concrete choice for a start date (the GDD doesn't pin one) — override with
// the SEASON_START env var to rebase it.
export const SEASON_ACTIVE_DAYS = 56;
export const SEASON_BREAK_DAYS = 14;
const SEASON_CYCLE_DAYS = SEASON_ACTIVE_DAYS + SEASON_BREAK_DAYS;
const SEASON_START = new Date(process.env.SEASON_START || '2026-06-01T00:00:00Z');

export function getSeasonInfo(now = new Date()) {
  const elapsedDays = Math.floor((now.getTime() - SEASON_START.getTime()) / 86400000);
  const cycle = Math.floor(elapsedDays / SEASON_CYCLE_DAYS);
  const season = cycle + 1;
  const dayInCycle = ((elapsedDays % SEASON_CYCLE_DAYS) + SEASON_CYCLE_DAYS) % SEASON_CYCLE_DAYS;
  const inBreak = dayInCycle >= SEASON_ACTIVE_DAYS;
  const day = inBreak ? null : dayInCycle + 1;
  return {
    season,
    day,
    inBreak,
    daysUntilCommunion: inBreak ? null : SEASON_ACTIVE_DAYS - day,
    isFinalCommunion: day === SEASON_ACTIVE_DAYS,
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
