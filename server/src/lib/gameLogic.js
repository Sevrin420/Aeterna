// Core Devotion / streak rules from docs/Aeterna_GDD_v4.1.md section 5-6.
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
export const X_DEVOTION = { like: 2, comment: 3, repost: 5 };
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

export function confessionCost(confessionCount) {
  return Number((0.005 + confessionCount * 0.001).toFixed(3));
}

// Season structure from docs/Aeterna_GDD_v4.1.md section 2: 56 days active
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
    db.prepare(`
      INSERT INTO streak_logs (player_id, date, streak_before, broke, confessed, cost_eth)
      VALUES (?, ?, ?, 1, 0, ?)
    `).run(player.id, today, player.streak, confessionCost(player.confession_count));
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
