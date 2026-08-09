# Throbbin Abbey — the deployed contract, and what is left to do

## What is deployed

**`ThrobbinAbbeyBloodline`** — address recorded in
`contracts/deployments/avalanche.json`, Avalanche C-Chain (43114).

A single ERC-721, **soulbound**. One contract, not the five-contract family the
earlier notes planned for.

| | |
|---|---|
| Collection name | `Throbbin Abbey Bloodline` (`THROB`) |
| Price | 0.01 AVAX per Cultist |
| Cultists per token | 1–20, chosen at mint, **fixed forever** |
| Supply | uncapped |
| Split | 80% treasury, 20% team |
| Transferable | **No.** Soulbound, ERC-5192, permanently locked at mint |
| Metadata | served from `https://membersonly.cc/nft/`, built live from Devotion |

### Soulbound

A Bloodline cannot be transferred, sold, given away or burned. Enforcement is
in `_update`, the single chokepoint every mint, transfer and burn in ERC-721
passes through, so it covers `transferFrom`, both `safeTransferFrom` overloads
and anything an extension might add. `approve` and `setApprovalForAll` revert
too, so a holder cannot sign an approval or list a line anywhere. The contract
owner has no privileged path — there is no `burn`, no admin transfer.

It reports itself: `locked(tokenId)` returns true, `supportsInterface` answers
for **ERC-5192** (`0xb45a3c0e`), and `Locked(tokenId)` is emitted at mint, so a
marketplace can show it as locked rather than offering a Sell button that
reverts.

**The cost of this, stated plainly:** there is no secondary market, and a lost
wallet is a lost Bloodline with no recovery by anyone, including us.

### The previous collection

**`AeternaBloodline`** — `0xC5D08383B1e56297Adbfa4f15E87588996f4C343`,
deployed 2026-08-02T02:29:39Z (run
[30728931702](https://github.com/Sevrin420/Aeterna/actions/runs/30728931702)).
Superseded and its mint closed. It carried the on-chain name "Aeterna
Bloodline", which a deployed constructor cannot change, and it was **freely
transferable** — the soulbound rule above is the reason it was replaced
rather than kept.

Bloodlines minted on it are not read by the abbey any more. Its balance is
swept with the `withdraw` action and its own address passed in `contract_address`.

**Immutable, asserted by the test suite:** price, supply, and both payout
addresses. There are no setters. `withdraw` splits 80/20 and can be called by
anyone — the owner can never touch the money or redirect it.

The team and treasury addresses are held as GitHub secrets and deliberately
kept out of the repo. They are not confidential — anyone can read them from the
chain with `team()` and `treasury()` — they are simply not restated here.

## Redeploying and restarting the run

The order matters. Each step is the **Deploy Bloodline contract** workflow
(Actions tab) unless it says otherwise, and every mainnet action needs `DEPLOY`
typed into the confirm box — including `withdraw` and `close-mint`.

1. **Close the old mint.**
   `network: avalanche`, `action: close-mint`, `contract_address:` the OLD
   address, `confirm: DEPLOY`. Do this FIRST. Two open mints for one game means
   coins paid for Bloodlines the abbey does not read.

2. **Sweep the old contract.**
   `action: withdraw`, `contract_address:` the OLD address. Anything minted
   since the last sweep is still sitting there, and nothing else will ever point
   at that address again.

3. **Deploy.**
   `action: deploy`, `contract_address:` blank. The tests are a hard gate; a
   single failing assertion stops the job before a transaction is signed. The
   run prints the new address and writes `deployments/avalanche.json`, which is
   uploaded as an artifact — **the runner's copy is not committed**, so take the
   address from the log or the artifact.

4. **Commit the new address in four places**, then deploy the server:
   - `contracts/deployments/avalanche.json` — the record
   - `web/index.html` — `<meta name="bloodline-address">`
   - `server/src/index.js` — the `BLOODLINE_ADDRESS` fallback
   - `server/src/lib/gameLogic.js` — `DEPLOYED_AT`, **which is day 0**

5. **Restart the run.** The **Restart the run** workflow, `confirm: RESTART`.
   This is not optional: token ids start at 1 again, and `/bind` refuses a token
   already bound to a row, so without it the first person to mint the new #1 is
   locked out of the abbey. The old database is archived on the box, not deleted.

6. **Open the new mint.**
   `action: open-mint`, `contract_address:` blank (it reads the deployments
   file), `confirm: DEPLOY`. Last, so nobody can mint into a collection the
   server is not yet reading.

Day 0 is the new contract's deploy timestamp, so the run begins again at week 1
with a duty worth 10 Devotion.

## What the contract does NOT do

Everything below is off-chain, in the game server, by design:

- **Devotion, streaks, levels** — server-side, in SQLite
- **Confession** — priced by the server and paid as a plain AVAX transfer to
  the treasury; the server verifies the transaction before mending a streak.
  There is no confession function on the contract (see the GDD §6).
- **Gifts, Mancala wagers, Cathedral rooms** — server-side; the Mancala wager
  moves Devotion, not AVAX
- **Payouts at the end of the run** — not built, and not designed

## Left to do

1. **End-of-run payout.** 80% of the mint is the players' pot. How it is
   divided is undesigned, and there is no contract function for it.
2. **Wallet-signature auth.** `/bind` verifies NFT ownership on-chain before
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
