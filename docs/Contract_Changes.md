# Throbbin Abbey — the deployed contract, and what is left to do

## What is deployed

**`AeternaBloodline`** — `0xC5D08383B1e56297Adbfa4f15E87588996f4C343`, Avalanche
C-Chain (43114), deployed 2026-08-02T02:29:39Z
(`contracts/deployments/avalanche.json`, run
[30728931702](https://github.com/Sevrin420/Aeterna/actions/runs/30728931702)).

A single plain ERC-721. One contract, not the five-contract family the earlier
notes planned for.

| | |
|---|---|
| Price | 0.01 AVAX per Cultist |
| Cultists per token | 1–20, chosen at mint, **fixed forever** |
| Supply | uncapped |
| Split | 80% treasury, 20% team |
| Metadata | served from `https://membersonly.cc/nft/`, built live from Devotion |

**Immutable, asserted by the test suite:** price, supply, and both payout
addresses. There are no setters. `withdraw` splits 80/20 and can be called by
anyone — the owner can never touch the money or redirect it.

The team and treasury addresses are held as GitHub secrets and deliberately
kept out of the repo. They are not confidential — anyone can read them from the
chain with `team()` and `treasury()` — they are simply not restated here.

## What the contract does NOT do

Everything below is off-chain, in the game server, by design:

- **Devotion, streaks, levels** — server-side, in SQLite
- **Confession** — priced by the server (see the GDD §6); no on-chain function
- **Gifts, Mancala wagers, Cathedral rooms** — server-side; the Mancala wager
  moves Devotion, not AVAX
- **Payouts at the end of the run** — not built, and not designed

## Left to do

1. **Confession payment.** The price is computed and quoted; nothing is
   collected. Needs the treasury address in the client, and server-side
   verification of the transaction: receipt fetched, status success, `to` is
   the treasury, `value` at least the quoted wei, and the same hash not already
   spent on another confession. Until all five hold, a stored `txHash` is a
   note and not a receipt.
2. **End-of-run payout.** 80% of the mint is the players' pot. How it is
   divided is undesigned, and there is no contract function for it.
3. **Wallet-signature auth.** `/bind` verifies NFT ownership on-chain before
   writing a row, but the session identity itself is an unsigned
   locally-generated id.

## Removed from the plan

The earlier version of this file mapped a family of contracts
(`FamiliaCultist` → `AeternaCultist`, `AeternaSoul`, `AeternaGame`,
`AeternaPayouts`) and a set of design changes that no longer apply. Recorded
here so nobody rebuilds them from an old draft:

- **ERC-6551 tokenbound accounts** — the NFT is a plain ERC-721
- **Souls, and the progressive per-season Soul cap** — no contract, no mechanics
- **Children / Bloodline breeding** — no contract, no mechanics
- **Season-aware mint pricing, 2,220-per-season supply, ETH denomination** —
  it is one price, uncapped, in AVAX
- **Final Communion**, gold reveal, Devotion doubling, on-chain Level Up
- **On-chain 2-player wagering with a 5% rake** — Mancala is server-side and
  wagers Devotion
- **Admin rank prefixes and admin-controlled yield** — no contract support
- **Confession cost escalating per use** — replaced by the week-and-Cultists
  price in the GDD §6
