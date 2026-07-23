// Core Devotion / streak rules from docs/Aeterna_GDD_v4.1.md section 5-6.
// Exact per-duty Devotion amounts aren't specified in the GDD (only gift and
// confession amounts are), so DUTY_DEVOTION / STREAK_BONUS_BASE below are this
// server's concrete choice for that gap, tuned to the documented multiplier curve.

export const DUTY_DEVOTION = 5;
export const STREAK_BONUS_BASE = 15;
export const GIFT_DEVOTION = { giverToCultist: 10, receiverFromCultist: 5, giverToGuru: 50 };
export const GIFT_DAILY_LIMITS = { giverPerDay: 1, receiverPerDay: 10 };

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

  db.prepare(`
    UPDATE players
    SET pray_today = 0, garden_today = 0, candles_today = 0,
        gifts_given_today = 0, gifts_received_today = 0,
        flags_date = ?
    WHERE id = ?
  `).run(today, player.id);

  return {
    ...player,
    pray_today: 0, garden_today: 0, candles_today: 0,
    gifts_given_today: 0, gifts_received_today: 0,
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
