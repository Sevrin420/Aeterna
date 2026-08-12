# Launching on Robinhood Chain

Everything between the current Avalanche test and the real launch. Nothing here
has been done — it is a plan, not a record. Where a decision has been made it
says so; where one is still open it says that too, and open decisions are the
things that will hold the launch up.

**Current state:** a test run on Avalanche C-Chain, soulbound
`ThrobbinAbbeyBloodline` at `0x78b796dcCadD44825A6A75AfC8BeB13d6a9Cb878`,
day 0 of 2026-08-09.

---

## Decisions taken

| | |
|---|---|
| Chain | **Robinhood Chain** (id `4663`, gas token ETH) |
| Mint price | **0.01 ETH per Cultist** |
| Founder mint | **One free Bloodline for the deployer wallet** |
| Founder payout | **None. The founder's line takes no share, however it places.** |
| Old Avalanche lines | Go dead. No migration, no compensation. |

**What 0.01 ETH per Cultist means in practice.** A Bloodline holds 1–20
Cultists, so the range is **0.01 ETH to 0.2 ETH**, and Cultists are the payout
multiplier — so the people with the most at stake are paying 0.2 ETH each. This
is roughly a hundred times the real cost of the Avalanche test, where 0.01 AVAX
was about a quarter. It is recorded here as chosen, not queried; the only note
worth carrying forward is that **`MAX_CULTISTS` is now the price lever**, not
`pricePerCultist`. Both are immutable at deploy.

---

## 1. The contract needs one change

The free founder mint does not exist yet. `mint()` requires exact payment with
no exception:

```solidity
require(msg.value == cultists * pricePerCultist, "wrong value");
```

There is no owner path around it, and there should not be one bolted onto
`mint()` — a payable function with a "unless you are the owner" branch is how
mints get drained. It wants its own function that can be read at a glance and
can only ever fire once.

### To add to `contracts/contracts/ThrobbinAbbeyBloodline.sol`

```solidity
/// Spent or not. One Bloodline, once, for the wallet that deployed the
/// collection — and a flag rather than a balance so it cannot be topped up.
bool public founderMinted;

/// WHICH token the founder took, or 0 if it has not been taken yet.
///
/// This exists for the payout, not for the mint. The founder's line is barred
/// from taking a share, and a rule like that is worth nothing if it lives in a
/// document — whoever writes the endgame six weeks from now needs to be able to
/// ASK which line is excluded, and any player needs to be able to check the
/// answer for themselves. On chain, permanently, is the only version of that
/// which survives being forgotten.
uint256 public founderTokenId;

/**
 * @notice The deployer's single free Bloodline.
 * @dev Deliberately NOT a branch inside mint(). A payable function that waives
 *      payment for one caller is one edit away from waiving it for everyone;
 *      this is a separate, non-payable function that takes no money, cannot be
 *      called twice, and is obvious in the ABI to anyone reading the contract.
 *
 *      It does not require mintOpen, so the founder's line can be raised and
 *      the whole flow checked end to end before the public mint is opened.
 */
function founderMint(uint256 cultists) external onlyOwner returns (uint256 tokenId) {
    require(!founderMinted, "founder mint spent");
    require(cultists >= 1 && cultists <= MAX_CULTISTS, "1-20 cultists");
    require(_nextId <= maxSupply, "sold out");

    founderMinted = true;
    tokenId = _nextId++;
    founderTokenId = tokenId;
    cultistsOf[tokenId] = cultists;
    _safeMint(msg.sender, tokenId);
    emit Minted(msg.sender, tokenId, cultists, 0);   // paid = 0, and says so
    emit Locked(tokenId);
}
```

### Tests to add to `contracts/test/bloodline.test.js`

- the owner may call it once and pays nothing
- the second call reverts `founder mint spent`
- a non-owner call reverts (`OwnableUnauthorizedAccount`)
- it still respects 1–20 Cultists and `maxSupply`
- **the token it produces is soulbound like any other** — the founder cannot
  sell theirs either
- `Minted` carries `paid = 0`, so the chain records it as free rather than
  looking like an unpaid mint
- `founderTokenId` is 0 before the mint and the minted id afterwards, so the
  payout can exclude it without being told which one it was

### Two consequences that come with it

1. **The founder's line is soulbound too.** It can never be sold or moved. That
   is consistent, and it is also permanent — worth saying out loud once.
2. **It is visible.** `founderMinted`, `founderTokenId`, and a `Minted` event
   carrying `paid = 0` are all public. Better announced than discovered.

### And the payout rule, which is decided

**The founder's line takes no share of the pot, however well it places.** It is
free to play, free to keep a streak, and free to appear in the standings — it
simply cannot be paid.

There is a detail in that which changes what other people get, so it is settled
here rather than left to whoever writes §4:

**The founder's line is removed from the ranking before the pot is divided, not
merely skipped while being paid.** If it finished first and were only skipped,
second place would still be paid a second-place share and everyone below would
keep their lower share — the founder's presence would quietly cost every player
money without the founder taking any. Removed first, second place becomes first
and is paid as first. The pot divides exactly as though the founder had never
entered, which is the only reading of "takes no payout" that costs the players
nothing.

The endgame code should read `founderTokenId` from the chain rather than
hard-coding a number, so the exclusion is verifiable by anyone and cannot drift
if the contract is ever redeployed again.

---

## 2. Chain configuration

| | |
|---|---|
| Chain ID | `4663` (`0x1237`) |
| RPC | `https://rpc.mainnet.chain.robinhood.com/` |
| Gas token | ETH |
| Explorer | Blockscout — `robinhoodchain.blockscout.com` |
| Contract changes needed | **None.** It is EVM; the Solidity deploys unmodified. |

Two things improve on this chain: **ETH is native**, so the scoring document's
"prize pool is in ETH" stops being untrue, and **Blockscout verification
generally needs no API key** — which likely retires the unverified-contract
problem that `SNOWTRACE_KEY` never solved. Hardhat reaches Blockscout through
`customChains`.

One thing to handle: Robinhood documents the public RPC as **rate-limited** and
recommends a provider for production. The server reads the chain on *every*
`/bind` and every `/confession`, so the public endpoint is what would start
failing binds on a busy mint. Point it at a provider (Chainstack supports the
chain) before opening.

### Every place the chain is named

**Chain id — `43114` → `4663`**

| File | Line | |
|---|---|---|
| `server/src/index.js` | 1257 | `chainId` in the `/collection` reply |
| `web/index.html` | 11, 16 | the two meta tags |
| `web/js/wallet.js` | 55, 58 | `WC_CHAIN` and `BLOODLINE_CHAIN_ID` fallbacks |
| `web/js/wallet.js` | 173 | `chainId: '0xa86a'` — **hex**, becomes `0x1237` |
| `web/js/main.js` | 1365 | the WRONG_CHAIN message names "Avalanche (43114)" |
| `contracts/scripts/deploy.js` | 66 | prints the meta tag to paste |
| `contracts/hardhat.config.js` | 42, 50 | network definitions |

**RPC** — `server/src/index.js:194`, `web/js/wallet.js:176`,
`contracts/hardhat.config.js:41,49`. The env var is called `AVAX_RPC`; rename it
to `CHAIN_RPC` in the same pass (read in the server and hardhat config, set in
`.github/workflows/deploy-contract.yml`).

**The word AVAX, where a player reads it** — `web/js/wallet.js:175`
(`nativeCurrency`), `web/js/scenes/abbey.js:922,976` (the Confessor),
`web/js/main.js:1375,1387,1542` (mint screen and confession), and
`server/src/index.js:715,756` (the two price errors). Also the helpers named for
it: `weiToAvax` (`server/src/lib/gameLogic.js:173`) and `formatAvax`
(`web/js/wallet.js:264`) — both tokens are 18 decimals, so this is naming only.

**Network names** — `.github/workflows/deploy-contract.yml` offers
`fuji` / `avalanche`; `contracts/deployments/avalanche.json` is named for the
chain. Robinhood Chain has a testnet: put it where `fuji` sits.

**The price** — `.github/workflows/deploy-contract.yml`, "Write .env" step,
line 96. It is **hardcoded, not a workflow input**, so it must be edited in the
file:

```yaml
echo "PRICE_PER_CULTIST_WEI=10000000000000000"     # 0.01 — unchanged for ETH
```

The number happens to be the same. That is a coincidence of the two tokens both
having 18 decimals, not a no-op — it is 0.01 **ETH** now. Confirm it is intended
rather than left over.

**Docs** — `docs/Throbbin_Abbey_GDD.md` §3 and §6 quote AVAX prices throughout;
`docs/Contract_Changes.md` names the chain and the old address.

---

## 3. Money, before anything is signed

- **The deployer wallet needs ETH on Robinhood Chain** for deploy gas. Bridged
  in, ahead of time.
- **Team and treasury addresses.** The same EVM addresses work — same keys,
  same addresses — but they are set immutably at deploy, so confirm they are
  the intended ones and that you control them **on this chain**. Currently held
  as the `TEAM_ADDRESS` and `TREASURY_ADDRESS` repo secrets.
- **Players need ETH on Robinhood Chain to mint.** They cannot pay from
  Ethereum mainnet. Whatever the bridging route is, it needs to be written down
  somewhere a player will find it, or the mint screen is a dead end for anyone
  who arrives with ETH in the wrong place.

---

## 4. Still not built

**The endgame.** No ranking, no payout, no decided split. Day 55 arrives and
nothing happens. GDD §8 is a deliberate stub. It needs a decision before it
needs code:

- how the 80% pot divides — top-N fixed shares? proportional to Devotion?
  Devotion × Cultists?
- on-chain or settled by hand?

The founder question is **settled**: excluded, and removed from the ranking
before the division rather than skipped during it — see §1.

This is the single thing standing between "the game works" and "the game can
finish". Everything else on this page is a day's work or a form to fill in.

**X Devotion is unearnable.** `X_BEARER_TOKEN` is unset, so `/x/claim` answers
503 to everyone — 560 Devotion of the design, a whole earning channel, inert.
Either set the token or cut it from the documents. Do not launch with it
advertised and dead.

---

## 5. Known and accepted

Recorded so they are decisions, not discoveries.

**Duties are scriptable.** The server requires the right order, a live session,
its own view of your position, and a dwell as long as the rite — but a script
that speaks the socket protocol satisfies all four. Roughly 30 lines and about
**31 seconds a day** (12s + 6s + 13s). Movement validation — rejecting position
jumps faster than a player can walk — was considered and deliberately deferred.
It is the obvious next step if the leaderboard starts looking wrong, and with
0.2 ETH lines in play the incentive to script is now considerably larger than it
was at 0.2 AVAX.

**One wallet may hold many Bloodlines, each earning independently.** Every line
has its own Devotion, streak and daily flags, so buying more lines multiplies
what one person can earn — and compounds with the point above.

**No signature auth on ordinary calls.** `/bind` verifies on-chain ownership,
and reclaiming a line on a new device requires a signature, but `/duty`,
`/referral` and `/x/handle` still trust the localStorage id. The signing path
now exists on both sides — `signOwnership()` in `web/js/wallet.js` and
`verifyMessage` in the server — so extending it is no longer a from-scratch job.

**Taking real money changes the standard.** The game will accept payment and pay
out based on ranked performance. Whether that is a game of skill, a promotion,
or something a regulator has an opinion about depends on jurisdiction, and it is
worth an hour of professional advice before the mint opens rather than after.

---

## 6. The order to run it in

Unchanged by the chain move; written up in `docs/Contract_Changes.md`. Every
mainnet action needs `DEPLOY` typed into the confirm box.

1. **Dry run on the Robinhood testnet.** The founder mint is new code and the
   price is immutable — deploy once where it costs nothing, mint a line, check
   the game reads it, then throw it away.
2. **Close the old mint** — `close-mint`, `contract_address` = the Avalanche
   address `0xC5D08383B1e56297Adbfa4f15E87588996f4C343`.
3. **Sweep the old contract** — `withdraw`, same address. Whatever was minted
   during the test is real money at an address nothing will point at again.
4. **Deploy** to Robinhood Chain. Tests are a hard gate; nothing signs if one
   fails.
5. **Verify on Blockscout**, so the soulbound rule is publicly readable.
6. **Founder mint** — `founderMint(n)` from the deployer wallet, before the
   public mint opens.
7. **Commit the new address in four places**, then deploy the server:
   `contracts/deployments/avalanche.json` (rename it), the `bloodline-address`
   meta tag, the server's `BLOODLINE_ADDRESS` fallback, and `DEPLOYED_AT` —
   **which is day 0**.
8. **Restart the run** — archives the database. Not optional: token ids start at
   1 again, and `/bind` refuses a token already bound to a row, so without it
   the first person to mint the new #1 is locked out.
9. **Open the mint** — last, so nobody can mint into a collection the server is
   not yet reading.

Day 0 becomes the new contract's deploy timestamp: week 1, a duty worth 10, 56
days on the clock.

### One thing to tell the old testers

Anyone holding an Avalanche Bloodline will connect, be read against the new
collection, and be told they hold nothing. That is the decision working
correctly, but from their side they own an NFT and the game says they do not.
Either say so plainly in advance, or have the client detect a holder of the old
collection and explain it — it is a small change and turns a confusing dead end
into an answer.
