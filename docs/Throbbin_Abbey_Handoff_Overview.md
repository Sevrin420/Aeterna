# Throbbin Abbey — Overview

**Slogan:** Eternal Throb, Eternal Life
**Shape:** one playthrough, eight weeks
**Chain:** Avalanche C-Chain (43114)
**Last updated:** August 8, 2026

This was a handoff package describing a project that had not been built. It is
now an overview of one that has. Where something is still missing it is listed
under "Gaps" rather than described as if it exists.

---

## The documents

| File | Contents |
|---|---|
| `docs/Throbbin_Abbey_GDD.md` | Game design — the clock, duties, Devotion, confession |
| `docs/Architecture.md` | Stack and the split between server, worker and chain |
| `docs/API_and_WebSockets.md` | HTTP routes and socket events |
| `docs/Contract_Changes.md` | What is deployed on-chain, and what is left |
| `docs/SQLite_Schema.sql` | Database schema |
| `README.md` | What is actually playable today |

---

## Summary

An invitation-only NFT cult RPG in a shared top-down pixel abbey. Players raise
a Bloodline, keep three daily duties, build a streak, and are counted for it in
**Devotion**.

### The run

**One playthrough of eight weeks. Day 0 is the day the contract was deployed
(2026-08-02); the run is days 0 to 55.** No seasons, no break, nothing repeats.
The clock is global — every player is on the same day — and is served by
`GET /day`.

### Core loop

1. **Mint a Bloodline** — 0.01 AVAX per Cultist, 1 to 20 Cultists, fixed at mint
2. **Name it**, and name whoever brought you in (both optional, both settable
   later from LINES on the menu)
3. **Three daily duties**, in order: Light the Brazier, Purifying Pain, Holy
   Ritual — 10 Devotion each, times the streak multiplier
4. **Sleep** in the bed chambers to close and save the day
5. **Miss a day** and the streak breaks; the Confessor mends it for a price
   that rises with the week and scales with the line's Cultists

### Decisions that hold

- Everything is **Devotion**; there is no Legacy system
- Level is uncapped; level 10 gives the maximum multiplier
- **Streaks are per Bloodline**, not per wallet — one wallet holding three
  lines has three independent streaks
- Confession is priced by **week × Cultists**, and does not escalate with the
  number of previous confessions
- Price, supply and both payout addresses are **immutable on-chain**

---

## Technical shape

| Component | Role |
|---|---|
| VPS (Node + Fastify + SQLite) | Duties, streaks, Devotion, confession, presence, chat |
| Cloudflare Worker | Signs Devotion on manual save |
| One ERC-721 contract | Mint only — Cultist count and the 80/20 money split |
| Static frontend | The game client |

---

## Economics

- **0.01 AVAX per Cultist**, uncapped supply
- A full 20-Cultist Bloodline costs 0.2 AVAX
- **80% treasury / 20% team**, enforced by the contract and callable by anyone
- The in-game doctrine shows the split to players as Winners 80% / Treasury 20%

---

## Gaps

1. **Confession takes no payment.** The price is quoted and recorded; nothing
   is collected, and the game says so. Needs the treasury address plus
   server-side receipt verification.
2. **The end of the run is undesigned.** There is no payout mechanism and no
   ceremony — Final Communion was removed rather than replaced.
3. **No wallet-signature auth.** `/bind` verifies NFT ownership on-chain, but
   the session identity is an unsigned local id.
4. **Mancala wagers move Devotion, not AVAX.**
5. **Souls and Children** have no mechanics; the altar and nursery are scenery.

---

## Removed

Seasons and the 56/14 cycle, Final Communion and the gold reveal, ERC-6551
tokenbound accounts, Souls and the progressive Soul cap, Children and breeding,
ETH pricing and the 2,220-per-season supply, per-use confession escalation, and
the four-season economic model. See `docs/Throbbin_Abbey_GDD.md` §10.

---

## Ownership

Owned and operated by the creator (the Abbot in-game). Admin functions are
controlled by the project wallet.
