# Launching on Robinhood Chain

Everything between the current Avalanche test and the real launch. Sections are
marked **DONE** or **OPEN**; the open ones are what will hold the launch up.

**Current state:** a test run on Avalanche C-Chain, soulbound
`ThrobbinAbbeyBloodline` at `0x78b796dcCadD44825A6A75AfC8BeB13d6a9Cb878`,
day 0 of 2026-08-09. **Nothing has been deployed to Robinhood Chain.**

## The short version

The launch is one button: **Actions → `LAUNCH — deploy, restart and open`**.
Pick the network, type `LAUNCH`, run it. It runs the contract tests as a hard
gate, closes and sweeps the old collection, deploys, verifies, takes the
founder's free line, rewrites and commits every place the chain and the address
are named, deploys the server and web, archives the player database, checks the
abbey is answering on the new collection, and opens the mint last.

What is **not** automatic, and must be true before the button is pressed:

| | |
|---|---|
| ETH on Robinhood Chain in the deployer wallet | §3 |
| `TEAM_ADDRESS` / `TREASURY_ADDRESS` correct **on this chain** | §3 |
| `ADMIN_TOKEN` set as a repo secret | else the final standings cannot be read |
| A non-rate-limited RPC, if the mint is expected to be busy | §2 |
| How the 80% pot divides | §4 — still undecided |

---

## Decisions taken

| | |
|---|---|
| Chain | **Robinhood Chain** (id `4663`, gas token ETH) |
| Mint price | **0.01 ETH per Cultist, or 30,000 $THROBBIN** |
| $THROBBIN | `0xe8fB470E0685437d7739BD2AacBA60b228800335` |
| Founder mint | **One free Bloodline for the deployer wallet** |
| Founder payout | **None. The founder's line takes no share, however it places.** |
| Payout method | **Settled by hand.** No payout contract; the operator pays winners directly. |
| Old Avalanche lines | Go dead. No migration, no compensation. |

**What 0.01 ETH per Cultist means in practice.** A Bloodline holds 1–20
Cultists, so the range is **0.01 ETH to 0.2 ETH**, and Cultists are the payout
multiplier — so the people with the most at stake are paying 0.2 ETH each. This
is roughly a hundred times the real cost of the Avalanche test, where 0.01 AVAX
was about a quarter. It is recorded here as chosen, not queried; the only note
worth carrying forward is that **`MAX_CULTISTS` is now the price lever**, not
`pricePerCultist`. Both are immutable at deploy.

---

## 1. The founder mint — **DONE**

Built, tested and committed: `founderMint()` and `founderTokenId` are in
`contracts/contracts/ThrobbinAbbeyBloodline.sol`, with nine tests covering it in
`contracts/test/bloodline.test.js` (29 passing). `contracts/scripts/founderMint.js`
calls it, and the launch workflow runs that script between the deploy and the
mint opening. The rest of this section is why it is shaped the way it is.

`mint()` requires exact payment with no exception:

```solidity
require(msg.value == cultists * pricePerCultist, "wrong value");
```

There is no owner path around it, and there should not be one bolted onto
`mint()` — a payable function with a "unless you are the owner" branch is how
mints get drained. It wants its own function that can be read at a glance and
can only ever fire once.

### What was added to `contracts/contracts/ThrobbinAbbeyBloodline.sol`

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

### The tests that cover it

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

## 2. Chain configuration — **DONE**

| | | |
|---|---|---|
| | mainnet | testnet |
| Chain ID | `4663` (`0x1237`) | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com/` | `https://rpc.testnet.chain.robinhood.com/` |
| Gas token | ETH | ETH |
| Explorer | `robinhoodchain.blockscout.com` | `explorer.testnet.chain.robinhood.com` |
| Faucet | — | `faucet.testnet.chain.robinhood.com` |
| Contract changes needed | **None.** It is EVM; the Solidity deploys unmodified. | |

> The **testnet** values came from a search, not from Robinhood's own docs
> (`docs.robinhood.com` is unreachable from the build environment). Confirm chain
> id `46630` against the faucet's own add-chain page before relying on it. If it
> is wrong, it is one line in `contracts/hardhat.config.js` and one entry in the
> launch workflow's `CHAINS` map — and it is a testnet, so being wrong costs
> nothing but a failed run.

**Nothing about the chain is hardcoded any more.** The client reads all of it
from meta tags in `web/index.html`:

```html
<meta name="bloodline-chain-id" content="43114" />
<meta name="chain-name"         content="Avalanche C-Chain" />
<meta name="chain-currency"     content="Avalanche" />
<meta name="chain-symbol"       content="AVAX" />
<meta name="chain-rpc"          content="https://api.avax.network/ext/bc/C/rpc" />
<meta name="chain-explorer"     content="https://snowtrace.io" />
```

Those six are what `wallet_addEthereumChain` is built from, and `chain-symbol`
is the ticker printed beside every price — the mint screen, the Confessor's
demand, and the confession toast all read it, so none of them can say AVAX on a
chain that charges ETH. The launch workflow rewrites all six together from a
single `CHAINS` map, so moving chains is a deploy rather than an edit.

The server takes `CHAIN_ID` and `CHAIN_RPC` from its environment, written to
`/etc/aeterna-server.env` by the same workflow. `AVAX_RPC` is still read as a
fallback so an existing box keeps working. Hardhat has all four networks and
Blockscout `customChains` entries for both Robinhood ones.

**One latent bug was fixed along the way.** `ensureChain()` used to ask the
wallet to switch to a hardcoded `0xa86a` and then compare the result against
`BLOODLINE_CHAIN_ID`. Those were two independent values: changing the chain id
alone would have made the switch succeed and the check fail, so every wallet
would have been told `WRONG_CHAIN` forever. The hex id is now derived from the
decimal one and cannot drift.

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

### What is still named for Avalanche, and does not matter

Naming only — no behaviour depends on any of it:

- `weiToAvax` (`server/src/lib/gameLogic.js`) and `formatAvax`
  (`web/js/wallet.js`). Both tokens are 18 decimals; the maths is identical.
- `AVAX_RPC` in the server, kept as a fallback for `CHAIN_RPC`.
- `contracts/deployments/avalanche.json` — the record of the old test deploy.
  A Robinhood launch writes `robinhood.json` beside it.
- The two server-side price errors in `server/src/index.js`, and the AVAX prices
  quoted throughout `docs/Throbbin_Abbey_GDD.md` §3 and §6 and in
  `docs/Contract_Changes.md`.

### The price — **CONFIRM BEFORE THE MAINNET RUN**

`price_per_cultist_wei` is now a **workflow input**, defaulting to
`10000000000000000` — 0.01. It is no longer buried in a YAML line.

That number is unchanged from the Avalanche test, which is a coincidence of the
two tokens both having 18 decimals and **not** a no-op: it was 0.01 AVAX, about
a quarter, and it is now 0.01 **ETH**. A 20-Cultist line costs **0.2 ETH**. Read
the value in the box before typing `LAUNCH`.

### The mint price is the only price

There are exactly **two** things a player pays today, and the second is derived
from the first — in **both** currencies:

| | coin | $THROBBIN |
|---|---|---|
| **Mint** | `pricePerCultist × cultists` | `tokenPricePerCultist × cultists` |
| **Confession** | `pricePerCultist × cultists × week%` | `tokenPricePerCultist × cultists × week%` |

**Two prices, not a conversion.** There is no oracle and no rate anywhere — both
are flat numbers fixed at deploy. A mint costs what the sign says whatever the
market does that week, and the consequence is worth stating once: if the token's
value moves, one of the two doors becomes the cheap one, and **neither price can
be changed afterwards**. Both are immutable.

At 30,000 a Cultist that is **30,000 to 600,000 THROBBIN** for a line, and a
week-8 mending on a 20-Cultist line is **1,200,000 THROBBIN** (200%).

The server reads `pricePerCultist()` off the deployed contract at boot — it is
not configured anywhere — so **changing the mint price changes the confession
charge with it, automatically**. There is nothing else to edit and no third
charge.

The week bands are `CONFESSION_WEEK_PCT` in `server/src/lib/gameLogic.js`:
25% through week 1, 50% weeks 2–4, 100% weeks 5–7, 200% week 8. At 0.01 that
means a 1-Cultist line mends for 0.0025 → 0.02 ETH across the run, and a
20-Cultist line for **0.05 → 0.4 ETH**. The top of that range is twice what the
line cost to raise, which is the design — but it is a number worth having looked
at deliberately before the mint opens rather than discovering in week 8.

### Adding something else that costs money, later

Mini games, entries, wagers — anything priced that is not the mint — go through
`ThrobbinAbbeyTolls`, a second contract deployed beside the collection.

**Adding one is a transaction, not a deploy:**

```
TOLL=dice COIN=0.001 TOKEN=5000 npm run toll:robinhood
```

That names a toll, prices it in either currency or both, and opens it. Nothing
is rebuilt, nothing is redeployed, and the collection is not touched.

**Then one call on the server:**

```js
const paid = await verifyToll(txHash, { toll: 'dice', player: fresh });
if (!paid.ok) return reply.code(paid.status).send({ error: paid.error });
paid.spend();          // once the thing paid for has actually been given
// paid.amount / paid.inToken / paid.ref — then run the game.
```

`verifyToll` already checks the three things that make a payment safe: it went
to the abbey's own tolls contract for **this** toll, it was signed by the wallet
holding **this** Bloodline, and the hash cannot be spent twice. `POST /toll/:name`
is a working endpoint and the reference implementation of the pattern; it banks
a payment and grants nothing, because what a payment buys is the game's
business.

**Why it is a separate contract.** `ThrobbinAbbeyBloodline` is immutable on
purpose — its price, its supply and both payout addresses cannot be changed by
anyone, and that promise is worth more than the convenience of one contract. A
price map the owner can edit does not belong beside it. Kept apart, a toll can
be repriced, switched off or got wrong and a Bloodline is still a Bloodline.
The tolls contract can also be deployed **later**, on its own, without touching
a live collection.

**What the owner can and cannot do.** They can name tolls, price them and close
them. They cannot move the money: `withdraw` splits to the same two immutable
addresses as the collection and anyone may call it. And a reprice cannot
overcharge anyone mid-signature — payment is exact and checked in the same
transaction, so a player signing the old price gets a revert, not a surprise
charge.

`TOLLS_ADDRESS` on the server and the `tolls-address` meta tag are both written
by the launch workflow. Until they are set, nothing is priced and `/tolls`
returns an empty board — which is the correct state before the first game
exists.

### `CONFESSION_TREASURY` must be set at every deploy

The server refuses to take confession money unless the contract's `treasury()`
matches `CONFESSION_TREASURY` — two independent sources agreeing, so no single
wrong value can redirect a payment. The fallback in the source is the **first**
collection's treasury, and it is only correct by accident.

Deploy with a different `TREASURY_ADDRESS` and leave that unset, and every
confession answers `503` for the whole run, because the check is comparing the
new contract against the old address. The launch workflow now writes it from the
same secret the contract was deployed with. If you ever deploy by hand, set it
by hand.

---

## 3. Money, before anything is signed

- **The deployer wallet needs ETH on Robinhood Chain** for deploy gas. Bridged
  in, ahead of time.
- **Team and treasury addresses.** The same EVM addresses work — same keys,
  same addresses — but they are set immutably at deploy, so confirm they are
  the intended ones and that you control them **on this chain**. Currently held
  as the `TEAM_ADDRESS` and `TREASURY_ADDRESS` repo secrets.
- **Paying in $THROBBIN still costs ETH for gas**, and paying in the token is
  TWO transactions (approve, then mint). A wallet holding 600,000 THROBBIN and
  no ETH cannot raise a line. The game now says so plainly instead of surfacing
  the wallet's own error, but it is still the likeliest thing anyone will be
  confused by on launch day — say it wherever the token is advertised.
- **Players need ETH on Robinhood Chain to mint.** They cannot pay from
  Ethereum mainnet. Whatever the bridging route is, it needs to be written down
  somewhere a player will find it, or the mint screen is a dead end for anyone
  who arrives with ETH in the wrong place.

---

## 4. The endgame — **built, except the division**

GDD §8 was a deliberate stub. Two of its three questions are answered and the
code for both is in: the founder is excluded (§1), and the pot is **settled by
hand** — no payout contract, the operator pays the winners directly. One
question is left, and it is the only one that still blocks paying anyone:

- **how the 80% pot divides** — top-N fixed shares? proportional to Devotion?
  Devotion × Cultists?

### The run ends — **DONE**

Past `lastDay`, `/duty`, `/referral`, `/x/claim` and `/confession` answer `410`
and say why. The abbey stays open — people can walk it, read the board, see
where they finished — it simply stops paying.

### The standings are frozen — **DONE**

The first request after the run closes writes every line into `final_standings`
and never writes it again. Ranking from a live query answers differently every
time it is run, and paying from a moving list means the record of what you paid
cannot be reconciled with the list you paid from.

The founder's line is recorded with `rank = NULL` and **removed before the
ranking**, not skipped during it — so second place becomes first and is paid as
first, exactly as though the founder had never entered (§1).

`FOUNDER_TOKEN_ID` in the server environment is what names that line. The launch
workflow reads it back from `founderTokenId` on the contract and writes it to
`/etc/aeterna-server.env` automatically. **If it is unset, no line is excluded.**

### An admin-only export — **DONE**

`GET /admin/standings`, with `x-admin-token`. It carries what a payment needs:
rank, token id, holder address, Devotion, Cultists, streak. A wrong token and a
missing token both answer **404**, not 401 — the endpoint does not admit to
existing. There is no public leaderboard; one existed and was deliberately
removed, because it served a ranking of every player to anyone with the URL.

**`ADMIN_TOKEN` must be set or the standings cannot be read at all.** Set it as
a repository secret and the launch workflow writes it to the server; the run
summary says so loudly if it is missing.

**Soulbinding makes this unambiguous, and that is worth noticing.** Because a
Bloodline can never be transferred, the address that minted it is the address
holding it at the end. There is no "who owned it at snapshot time" question, no
last-minute sale to a different wallet, no dispute about which address to pay.
That property was chosen for other reasons and pays off here.

### Still to do by hand

**A record of what was paid.** Who, how much, which transaction. Without it, a
dispute six weeks later has nothing to appeal to but memory. It should be
written as the payments are made, not reconstructed afterwards.

### What settling by hand means for the players

The pot sits in the treasury and the operator sends it out. That works, and it
asks the players to trust a person rather than a contract — which is a
reasonable trade for a first run, and only reasonable if the process is stated
plainly beforehand: who pays, from which address, on what schedule, and what a
player does if they were missed. Silence on any of those turns an honest delay
into a story about a rug.

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

## 6. The launch — one button

**Actions → `LAUNCH — deploy, restart and open` → Run workflow.**

| Input | |
|---|---|
| `network` | `robinhoodTestnet` first. Then `robinhood`. |
| `confirm` | Type `LAUNCH`. Anything else and the run stops on the first step. |
| `price_per_cultist_wei` | `10000000000000000` = 0.01. **Immutable.** Read §2. |
| `founder_cultists` | `1`–`20`, or `0` to skip the founder mint. |
| `old_contract` | The previous collection, to close and sweep. Blank on a first launch. |
| `max_supply` | Uncapped by default. **Immutable.** |
| `base_uri` | Where metadata is served. Must end in a slash. |

What it does, in the one order that works, stopping at the first failure:

1. Refuses unless `confirm` is exactly `LAUNCH`.
2. **Runs the contract tests as a hard gate.** Nothing is signed if one fails.
3. Closes the mint on the old collection, if one was named.
4. Sweeps the old collection's balance to team and treasury. Whatever was minted
   during the test is real money at an address nothing will point at again.
5. Deploys the new contract.
6. Verifies it on Blockscout — best effort, a failure here does not stop a
   launch that has already signed a deploy.
7. **Founder mint**, before anyone else can mint.
8. Rewrites and commits the address, the six chain meta tags, the server's
   `CHAIN_ID`, and `DEPLOYED_AT` — **which is day 0**. Committed with
   `[skip ci]` so `deploy-server.yml` does not race this run.
9. Deploys the server and web; writes `CHAIN_ID`, `CHAIN_RPC`,
   `FOUNDER_TOKEN_ID` and `ADMIN_TOKEN` to `/etc/aeterna-server.env`;
   **archives the player database**; checks `/collection` reports the new
   address; and **opens the mint last**.

Step 9's archive is not optional. Token ids start at 1 again on a new
collection, and `/bind` refuses a token already bound to a row — without it the
first person to mint the new #1 is told it belongs to somebody else and cannot
get into the abbey at all.

Day 0 becomes the new contract's deploy timestamp: week 1, a duty worth 10, 56
days on the clock.

### The secrets it needs

Repo secrets, all checked in step 1 and named in the error if missing:
`DEPLOYER_KEY`, `TEAM_ADDRESS`, `TREASURY_ADDRESS`, `VPS_HOST`, `VPS_USER`,
`VPS_SSH_KEY`. Optional: `EXPLORER_KEY` (Blockscout takes anything),
`ADMIN_TOKEN` (without it the final standings cannot be read).

Both workflows use `environment: <network>`, so if any of those secrets are
scoped to a GitHub **environment** rather than the repository, an environment
named `robinhood` and `robinhoodTestnet` needs to exist with them in it. The
secrets check fails loudly and before anything is signed if they do not.

### Before pressing it on mainnet

- **Dry-run the whole workflow on `robinhoodTestnet` first.** The founder mint
  and the chain rewiring are both new code, and the price and payout addresses
  are immutable. This is the only place any of it can be wrong for free.
- **The run is irreversible.** It signs a deploy, archives the live player
  database and opens a public mint. The only guards are the typed `LAUNCH` and
  the test gate. There is no undo.
- Re-running it is safe in the sense that it will not double-mint the founder
  (the contract refuses) and will not leave duplicate environment keys — but it
  **will** deploy a second collection and archive the database again.

### One thing to tell the old testers

Anyone holding an Avalanche Bloodline will connect, be read against the new
collection, and be told they hold nothing. That is the decision working
correctly, but from their side they own an NFT and the game says they do not.
Either say so plainly in advance, or have the client detect a holder of the old
collection and explain it — it is a small change and turns a confusing dead end
into an answer.
