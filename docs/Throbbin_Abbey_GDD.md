# Throbbin Abbey — Game Design Document

**Slogan:** Eternal Throb, Eternal Life
**Shape:** one playthrough, eight weeks, then it is over
**Chain:** Avalanche C-Chain (43114)
**Last updated:** August 8, 2026

> This document describes the game **as it is built**. Where something is
> designed but not yet implemented it says so in that section, in those words.
> The previous version (v4.1) described four repeating seasons, ETH pricing, an
> ERC-6551 tokenbound Cultist and a Final Communion; none of that is what runs,
> and all of it has been removed rather than left standing as an aspiration.

---

## 1. Vision & core fantasy

An invitation-only NFT cult RPG set in a living pixel abbey. You raise a
Bloodline, keep its daily duties, build a streak, and are counted for it.

The game is about faith, groupthink, and the cost of belief — expressed
mechanically as **Devotion**, which you can only earn by turning up.

**Core goals**
- Daily play that takes a few minutes and rewards not missing a day
- Reward early and consistent believers over large one-off buyers
- One clean run with an end, rather than an open-ended grind

---

## 2. The clock

**One playthrough. Eight weeks. No seasons, no break, no repeat.**

- **Day 0 is the day the contract was deployed**, read from
  `contracts/deployments/avalanche.json` and mirrored in `DEPLOYED_AT` in
  `server/src/lib/gameLogic.js`. **A redeploy resets it**: the new contract's
  deploy timestamp becomes the new day 0, and the run starts over from week 1
- The run is **days 0 to 55**, which is 56 days, which is 8 weeks
- **Week 1 is days 0–6**, week 2 is days 7–13, … week 8 is days 49–55
- The day rolls at **00:00 UTC**
- After day 55 the run has ended. Nothing resets and nothing starts again.

The clock is **global**: every player is on the same day and the same week at
the same moment. It is served by `GET /day` and implemented in
`server/src/lib/gameLogic.js` (`abbeyClock`). `ABBEY_START` overrides the
anchor for a test server.

Note the contrast with streaks, which are **per Bloodline** — see §5.

---

## 3. Mint & treasury

**The contract** — `ThrobbinAbbeyBloodline` on the Avalanche C-Chain. The
address and deploy date live in `contracts/deployments/avalanche.json`, which is
the one place they are recorded.

| | |
|---|---|
| Collection | **Throbbin Abbey Bloodline** (`THROB`) |
| Price | **0.01 AVAX per Cultist** |
| Cultists per Bloodline | 1 to 20, chosen at mint |
| Cost of a full Bloodline | 0.2 AVAX (20 Cultists) |
| Supply | uncapped |
| Split | **80% treasury, 20% team** |
| Transferable | **No — soulbound** |

Price, supply and both payout addresses are **immutable** — there are no
setters, and the deploy tests assert it. Payment is exact: the contract reverts
on an over- or under-payment rather than keeping the difference.

The number of Cultists in a Bloodline is fixed the moment it is raised. There
is no function anywhere in the contract that adds to it.

**Payouts.** 80% of the mint is the players' pot and 20% is the treasury —
this is what the in-game doctrine chart shows. How the pot is divided at the
end of the run is **not implemented** and not yet specified here.

---

## 4. The Bloodline NFT

An ERC-721, **soulbound**. Not a tokenbound account — the ERC-6551 design was
dropped.

**It cannot leave the wallet that raised it.** No sale, no gift, no transfer, no
burn, no approval to a marketplace, and no privileged path for the contract
owner. A leaderboard place cannot be bought, and a line cannot be flipped
part-way through a run. It says so on chain: ERC-5192 `locked()` returns true
and `Locked` is emitted at mint, so a marketplace shows it as locked instead of
offering a Sell button that reverts.

The price of that: no secondary market, and **a lost wallet is a lost Bloodline**
— nobody can recover or reissue one.

**Carries**
- **Cultists** — 1 to 20, from the chain, fixed at mint. The payout multiplier.
- **Devotion** — earned by play, held server-side, only ever rises
- **Streak** — consecutive days with all three duties done
- **A name** — given once, when the line is raised, or later from LINES
- **An X handle** — optional; it is what others type to credit a referral

The card a marketplace shows is built live from current Devotion
(`GET /nft/:tokenId`), so a Bloodline improves by being played. Nothing is
minted, migrated or signed to make that happen.

**One wallet may hold many Bloodlines.** Each is a separate row with its own
Devotion, streak and confession count; you play one at a time and every call
says which.

---

## 5. Daily duties, Devotion & streaks

**The daily three**, in this order:

1. **Light the Brazier** — lay wood, fetch a torch, bring it to the wood
2. **Purifying Pain** — take up the switch and put it in the Abbot's hands
3. **Holy Ritual** — stand on the blood-red tile at the shrine

**What a duty pays rises with the calendar week** — the same figure for
everybody, whenever they joined:

| Week | Per duty | All three | A perfect week |
|---|---|---|---|
| 1 | 10 | 30 | 210 |
| 2 | 12 | 36 | 252 |
| 3 | 15 | 45 | 315 |
| 4 | 20 | 60 | 420 |
| 5 | 28 | 84 | 588 |
| 6 | 38 | 114 | 798 |
| 7 | 50 | 150 | 1,050 |
| 8 | 60 | 180 | 1,260 |

This is the mechanism that keeps a late joiner in the running: their days are
worth more than the early player's days were. A perfect player arriving in
week 3 finishes about 15% behind a perfect day-one player on duties, not 60%.

Sleeping in the bed chambers closes and saves the day.

**Streak multipliers**

The multiplier applies to **duties only** — never to X, never to referrals —
and it is not retroactive: it changes what the NEXT duty pays.

A full week of all three duties unlocks 1.1×. After that it rises another 0.1×
for every further two weeks of unbroken streak.

| Streak | Multiplier |
|---|---|
| 0–6 days | 1.0× |
| 7–20 days | 1.1× |
| 21–34 days | 1.2× |
| 35–48 days | 1.3× |
| 49 days + | 1.4× |

For a player who never misses, that is 1.0× in week 1, 1.1× in weeks 2–3,
1.2× in weeks 4–5, 1.3× in weeks 6–7 and 1.4× in week 8 — a perfect run of
duties totalling **6,216 Devotion**.

Level no longer touches the multiplier. It is for ranking and for show.

**Streaks are per Bloodline, not per wallet.** One wallet holding three lines
has three independent streaks, three multipliers and three confession counts.

**Other Devotion** — neither of these takes the streak multiplier.
- **Referral** — 10 to both sides, once. The person you name must already have
  set their X handle in the abbey. Capped at **10 successful referrals** per
  Bloodline: it is the one earner with no daily ceiling and no work in it.
- **X engagement** — 5 for commenting the phrase *"Eternal Throb, Eternal
  Life"* on a post, claimable once per post and **twice a day** — 10 a day,
  560 across the run. The old motto is still honoured. Likes and reposts pay
  nothing: they are free to manufacture.

**The board.** None of this has to be remembered. A board on the dead-end wall
of the west warren, beside the stair down to the cells, reads back three pages:
the Bloodline's Devotion, streak and multiplier; the week, the Devotion a task
pays and the days left; and what its referrals have earned.

---

## 6. Confession — mending a broken streak

Miss a day and the streak is gone. The Confessor will mend it, for a price.

**The price is a percentage of what the Bloodline cost to raise**, rising as
the run goes on:

| Week | Days | Cost |
|---|---|---|
| 1 | 0–6 | **25%** of the line's mint cost |
| 2–4 | 7–27 | **50%** |
| 5–7 | 28–48 | **100%** |
| 8 | 49–55 | **200%** |

"Mint cost" is `0.01 AVAX × the line's Cultists`. So:

| | 1 Cultist | 5 Cultists | 20 Cultists |
|---|---|---|---|
| Week 1 | 0.0025 | 0.0125 | 0.05 |
| Weeks 2–4 | 0.005 | 0.025 | 0.10 |
| Weeks 5–7 | 0.01 | 0.05 | 0.20 |
| Week 8 | 0.02 | 0.10 | 0.40 |

A break in week one is a stumble; a break in week eight is most of the run
thrown away, and it costs like it. Scaling by Cultists means a twenty-Cultist
holder does not mend for a one-Cultist price.

The price depends on the week you **confess** in, not the week you broke. The
Confessor names the figure before you kneel. It does **not** escalate with the
number of previous confessions — the price is the week and the Cultists and
nothing else, so a player can work it out.

**Paying.** Three steps, and the client decides none of them. `/confession`
with no transaction hash answers **402** with the price and the treasury address
to send it to; the wallet signs that exact transfer; the hash goes back up and
the server checks it against the chain before forgiving anything:

1. the transaction exists and its receipt says it succeeded
2. `to` is the treasury — read from the contract's immutable `treasury()`,
   never from a config file
3. `value` is at least the wei quoted for this player, this week
4. the sender still holds the Bloodline being mended
5. that hash has not already been spent on a confession

(4) stops one payment mending a stranger's line; (5) stops the same payment
mending twice, backed by a UNIQUE index so it holds when two requests race.
Any one failing means the streak stays broken and nothing is taken.

---

## 7. Levels & progression

- Level has **no cap**, and it no longer feeds the streak multiplier
- All actions earn **Devotion only**
- No gold is paid or shown during the run

---

## 8. The end of the run

Day 55 is the last day. The run ends; nothing resets.

**How the pot is divided is not designed yet.** The old Final Communion — gold
reveal, the Leave-or-Tithe choice, ranks decided at the ceremony — has been
removed from the game and from this document. What replaces it is an open
question, and this section is deliberately a stub rather than a description of
something that does not exist.

---

## 9. Social

- **Referrals** — see §5. Set at mint or later from LINES on the menu.
- **Cathedral Rooms** — four claimable alcoves in the transept; first to press
  A on an unowned alcove holds it. No cost to claim.
- **Presence** — other players connected at the same time appear, move, chat
  and react live, including a catch-up snapshot when you join mid-session.
- **Mancala** — a real server-authoritative 2-player Kalah game in the kitchen
  with a 5% house rake. The wager moves **Devotion, not AVAX**.
- **The Guru/Abbot** — the abbey's own, not a normal Cultist.

---

## 10. Removed

Recorded so nobody reintroduces them by reading an old draft:

- **Seasons** — the 56-active/14-break repeating cycle, season numbers, and
  per-season resets. There is one run.
- **Final Communion** — the Day 56 ceremony, gold reveal, Leave/Tithe, and the
  ranks decided there.
- **ERC-6551 tokenbound Cultist** — the NFT is a plain ERC-721.
- **ETH pricing and 2,220-per-season supply** — it is AVAX, 0.01 per Cultist,
  uncapped.
- **Confession cost escalating per confession** — replaced by §6.
- **Souls** (§9 of v4.1) and **Bloodline/Children** (§8 of v4.1) — the altar
  and nursery are still physically in the abbey as scenery, but there are no
  mechanics behind them and they are not part of this run.
- **Gifts** — giver +10, receiver +5, an offering to the Abbot +50, with daily
  limits. Not in this run. The design is recorded below and the database
  scaffolding is kept, so it can come back without a migration.

### Gifts, parked

Kept here so the design is not lost. A gift spawns in the world; a player picks
it up and carries it visibly; walking it to another Cultist and offering it
pays the giver 10 Devotion and the receiver 5, with the giver limited to one a
day and the receiver to ten; offering it to the Abbot instead pays 50, once a
day.

What survives in the code: the `gifts` table, `players.held_gift_id`, and the
`gifts_given_today` / `gifts_received_today` counters with their daily reset.
Nothing spawns, carries or offers — no route, no socket event, no scene code.

---

## 11. Design goals check

| Goal | Status |
|---|---|
| Daily play worth turning up for | Built |
| Players see each other, live | Built |
| One clean run with an end | Clock built; the ending is not designed |
| Devotion-only progression | Built |
| Uncapped level, ranking only | Built |
| Streaks per Bloodline | Built |
| Confession priced by week and holding | Built, and collecting |
| Real payouts | Not built |

---

## 12. Known gaps

1. **The end of the run is undesigned.** §8.
2. **Gifts are parked**, not built — §10.
3. **No wallet-signature auth.** Player identity is a locally generated
   pseudo-id in `localStorage`; `/bind` does verify NFT ownership on-chain
   before it will write a row, but the session itself is not signed.
4. **Mancala wagers move Devotion, not money.**
5. **Souls and Children have no mechanics.**
