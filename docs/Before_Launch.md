# Before the real launch

Everything that has to happen between the current test run and the real one,
written while it was fresh rather than remembered later. Nothing in this file
has been done — it is a list, not a record.

The game is currently running a **test** on Avalanche C-Chain with the soulbound
`ThrobbinAbbeyBloodline` at `0x78b796dcCadD44825A6A75AfC8BeB13d6a9Cb878`. The
real launch moves to **Robinhood Chain**.

---

## 0. The one that cannot be undone

**Decide the mint price before deploying, and decide it deliberately.**

`PRICE_PER_CULTIST_WEI` is `10000000000000000` — 0.01 of the native token. On
Avalanche that is roughly a quarter. Robinhood Chain's gas token is **ETH**, so
the same number is about **a hundred times more**: a 20-Cultist Bloodline would
cost 0.2 ETH.

The price is an immutable constructor argument. Getting it wrong means another
redeploy, another day 0, and another wiped database.

It is set in `.github/workflows/deploy-contract.yml`, in the "Write .env" step —
it is **hardcoded there, not a workflow input**, so it has to be edited in the
file before the deploy is run:

```yaml
echo "PRICE_PER_CULTIST_WEI=10000000000000000"
```

Rough shapes, for whatever ETH is worth on the day:

| Per Cultist | A full 20-Cultist line |
|---|---|
| 0.0001 ETH | 0.002 ETH |
| 0.001 ETH | 0.02 ETH |
| 0.01 ETH (unchanged) | 0.2 ETH |

---

## 1. Robinhood Chain

Permissionless, fully EVM (Arbitrum Orbit), mainnet live 1 July 2026. The
contract deploys **unmodified** — nothing in `ThrobbinAbbeyBloodline.sol` is
chain-specific.

| | |
|---|---|
| Chain ID | `4663` |
| RPC | `https://rpc.mainnet.chain.robinhood.com/` |
| Gas token | **ETH** |
| Explorer | Blockscout — `robinhoodchain.blockscout.com` |

Two things get **better** on this chain:

- **ETH is native.** The scoring document always said the prize pool was in ETH;
  on Avalanche that was simply untrue. Here it is true without a translation.
- **Blockscout verification usually needs no API key.** The contract has been
  unverified this whole time because `SNOWTRACE_KEY` was never set, so nobody
  could read the soulbound rule for themselves. That blocker probably
  disappears for free — hardhat reaches Blockscout through `customChains`.

One thing gets **worse** if ignored:

- Robinhood documents the public RPC as **rate-limited** and recommends a
  dedicated provider for production. The server reads the chain on *every*
  `/bind` and every `/confession` verification, so on a busy mint the public
  endpoint is what would start failing binds. Point the RPC env var at a
  provider (Chainstack supports the chain) before opening the mint.

---

## 2. Every place the chain is named

Ten files. All of it mechanical.

### Chain id — `43114` becomes `4663`

| File | Line | What |
|---|---|---|
| `server/src/index.js` | 1257 | `chainId: 43114` in the `/collection` reply |
| `web/index.html` | 11 | `<meta name="wc-chain-id">` |
| `web/index.html` | 16 | `<meta name="bloodline-chain-id">` |
| `web/js/wallet.js` | 55 | `WC_CHAIN` fallback |
| `web/js/wallet.js` | 58 | `BLOODLINE_CHAIN_ID` fallback |
| `web/js/wallet.js` | 173 | `chainId: '0xa86a'` — **hex**, becomes `0x1237` |
| `web/js/main.js` | 1365 | the WRONG_CHAIN message names "Avalanche (43114)" |
| `contracts/scripts/deploy.js` | 66 | prints the meta tag to paste |
| `contracts/hardhat.config.js` | 42, 50 | network definitions |

### RPC

| File | Line | What |
|---|---|---|
| `server/src/index.js` | 194 | `AVAX_RPC` and its default |
| `web/js/wallet.js` | 176 | `rpcUrls` for the add-chain prompt |
| `contracts/hardhat.config.js` | 41, 49 | hardhat networks |

`AVAX_RPC` is a poor name once the chain is not Avalanche. Rename it to
`CHAIN_RPC` in the same pass — it is read in `server/src/index.js` and
`contracts/hardhat.config.js` and set in `.github/workflows/deploy-contract.yml`.

### The word AVAX, where a player reads it

| File | Line | What |
|---|---|---|
| `web/js/wallet.js` | 175 | `nativeCurrency: { name: 'Avalanche', symbol: 'AVAX' }` |
| `web/js/scenes/abbey.js` | 922 | the Confessor naming his price |
| `web/js/scenes/abbey.js` | 976 | "Paid N AVAX. Streak restored." |
| `web/js/main.js` | 1375, 1387 | the mint screen's price and total |
| `web/js/main.js` | 1542 | "Confirm N AVAX in your wallet" |
| `server/src/index.js` | 715, 756 | the two confession price errors |

Also the helpers named for it: `weiToAvax` in `server/src/lib/gameLogic.js:173`
and `formatAvax` in `web/js/wallet.js:264`. The arithmetic is identical — both
tokens are 18 decimals — so this is naming only.

And the documents: `docs/Throbbin_Abbey_GDD.md` §3 and §6 quote AVAX prices
throughout, and `docs/Contract_Changes.md` names the chain.

### Network names

`.github/workflows/deploy-contract.yml` offers `fuji` / `avalanche` as the
network choice, and `contracts/deployments/avalanche.json` is named for the
chain. Robinhood Chain has a testnet; add it as the non-mainnet option in the
same place `fuji` sits now.

---

## 3. Still not built

**The endgame.** No ranking, no payout, no decided split. Day 55 arrives and
nothing happens. GDD §8 is a deliberate stub. This is the one item that needs a
decision before it needs code: how the 80% pot divides across the ranking
(top-N fixed shares? proportional to Devotion? Devotion × Cultists?), and
whether payout is on-chain or settled by hand.

**X Devotion is unearnable.** `X_BEARER_TOKEN` is unset, so `/x/claim` answers
503 to everyone. That is 560 Devotion of the design — a whole earning channel —
inert. Either set the token or cut the channel from the documents, but do not
launch with it advertised and dead.

---

## 4. Known and accepted, so nobody rediscovers them in a panic

**Duties are still scriptable.** The server now requires the right order, a live
session, its own view of your position, and a dwell as long as the rite — but a
script that speaks the socket protocol can satisfy all four. It is roughly 30
lines and about **31 seconds a day** (12s + 6s + 13s). Movement validation —
rejecting position jumps faster than a player can walk — was considered and
deliberately deferred. It is the obvious next step if the leaderboard starts
looking wrong.

**One wallet may hold many Bloodlines, each earning independently.** Every line
has its own Devotion, streak and daily flags, so buying more lines multiplies
what one person can earn. That is arguably the intended shape of the mint, but
it compounds with the point above and is worth a deliberate decision rather than
a discovery.

**No signature auth on the ordinary calls.** `/bind` verifies on-chain ownership
and reclaiming a line on a new device now requires a signature, but `/duty`,
`/referral` and `/x/handle` still trust the localStorage id. The signing path
now exists on both sides — `signOwnership()` in `web/js/wallet.js` and
`verifyMessage` in the server — so extending it to every call is no longer a
from-scratch job.

---

## 5. The order to run it in

The six steps are written up in `docs/Contract_Changes.md` under "Redeploying
and restarting the run" and are unchanged by the chain move:

1. `close-mint` on the OLD contract, with its address in `contract_address`
2. `withdraw` from the OLD contract
3. `deploy` the new one
4. commit the new address in four places — including `DEPLOYED_AT`, **which is
   day 0**
5. **Restart the run** workflow, `confirm: RESTART` (archives the database;
   without it the first person to mint the new #1 is locked out)
6. `open-mint` on the new contract — last, so nobody can mint into a collection
   the server is not yet reading

Day 0 resets to the new contract's deploy timestamp. Week 1, a duty worth 10,
56 days on the clock.
