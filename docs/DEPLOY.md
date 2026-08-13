# Deploy

Two buttons in **Actions**. The first one is free and changes nothing; the
second one is the launch.

---

## Before either: four things only you can do

Nothing in the repository can do these, and PREFLIGHT will tell you if any is
missing rather than letting the launch find out.

| | |
|---|---|
| **Repo secrets** | `DEPLOYER_KEY`, `TEAM_ADDRESS`, `TREASURY_ADDRESS`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` |
| **`ADMIN_TOKEN`** | Any long random string. Without it the final standings can never be read, and there is no second chance to want it. |
| **Gas** | ETH in the deployer wallet **on Robinhood Chain**. Bridged in ahead of time. |
| **Team + treasury** | Must be addresses you control **on Robinhood Chain**. Both are immutable at deploy. |

`EXPLORER_KEY` is optional — Blockscout takes any key.

---

## 1. PREFLIGHT — free, run it as often as you like

**Actions → `PREFLIGHT — check the launch will work` → Run workflow.**

It signs nothing, deploys nothing and touches nothing on the box. It checks:

- the contract tests
- every secret the launch reads
- the RPC answers, and agrees which chain it is
- the deployer has gas
- team and treasury are real addresses
- **$THROBBIN really is an ERC-20 on that chain**, and what 30,000 works out to
  in its own decimals
- the old collection is reachable **on its own chain**, owned by your key, and
  how much is sitting in it waiting to be swept
- ssh, the service unit, `/opt/aeterna-server`, `/opt/web`, rsync, npm, disk
- whether a player database exists — because the launch will archive it
- the live abbey is answering

It ends in **GO** or **NO-GO** with a table. Get a GO before pressing the other
button.

---

## 2. LAUNCH — the irreversible one

**Actions → `LAUNCH — deploy, restart and open` → Run workflow.**

### The testnet dry run, first

| Input | Value |
|---|---|
| `network` | `robinhoodTestnet` |
| `confirm` | `LAUNCH` |
| `pay_token` | **blank** — $THROBBIN is not on the testnet |
| `pay_token_per_cultist` | **blank** |
| `old_contract` | **blank** — nothing to close there |
| everything else | leave the defaults |

This exercises the entire nine-step sequence for free, including the database
archive and the mint opening last. It is the only place the sequence itself can
be got wrong at no cost.

### Then mainnet

| Input | Value |
|---|---|
| `network` | `robinhood` |
| `confirm` | `LAUNCH` |
| `price_per_cultist_wei` | `10000000000000000` — **0.01 ETH.** Read this before pressing. |
| `pay_token` | `0xe8fB470E0685437d7739BD2AacBA60b228800335` |
| `pay_token_per_cultist` | `30000` |
| `deploy_tolls` | `true` |
| `founder_cultists` | `1` |
| `old_contract` | `0x78b796dcCadD44825A6A75AfC8BeB13d6a9Cb878` (defaulted) |
| `old_network` | `avalanche` (defaulted) |
| `max_supply` | uncapped (defaulted) |
| `base_uri` | `https://membersonly.cc/nft/` (defaulted) |

`price_per_cultist_wei` is unchanged from the Avalanche test, which is a
coincidence of both tokens having 18 decimals and **not** a no-op: it was 0.01
AVAX, and it is now 0.01 **ETH**. A 20-Cultist line costs **0.2 ETH**.

`old_network` is `avalanche` on purpose. The collection being shut down is not
on the chain being launched to, and closing and sweeping it has to happen on
**its** chain.

### What the button does, in order

1. Refuses unless `confirm` is exactly `LAUNCH`
2. **Runs the contract tests as a hard gate** — nothing is signed if one fails
3. Closes the old mint, on the old chain
4. Sweeps the old collection, on the old chain
5. Deploys the collection
6. Verifies it on Blockscout (best effort)
7. Founder mint — before anyone else can mint
8. Deploys the tolls contract, and verifies it
9. Rewrites and commits the address, the chain meta tags, the token, the tolls
   address and `DEPLOYED_AT` — **which is day 0** — with `[skip ci]`
10. Deploys server and web; writes `CHAIN_ID`, `CHAIN_RPC`, `CHAIN_SYMBOL`,
    `CONFESSION_TREASURY`, `TOLLS_ADDRESS`, `FOUNDER_TOKEN_ID` and `ADMIN_TOKEN`
    to `/etc/aeterna-server.env`; **archives the player database**; checks
    `/collection` reports the new address; and **opens the mint last**

### It is irreversible

It signs a deploy, archives the live player database and opens a public mint.
The guards are the typed `LAUNCH` and the test gate. There is no undo.

The archive is not optional: token ids restart at 1 on a new collection and
`/bind` refuses a token already bound to a row, so without it the first person
to mint the new #1 is told it belongs to someone else and cannot get in at all.

---

## Afterwards

**Check the run summary** — it prints the collection address, the chain, day 0,
the founder token id and the tolls address, and shouts if `ADMIN_TOKEN` was
missing.

**Say two things wherever the mint is advertised:**

- Players need **ETH on Robinhood Chain**, and cannot pay from Ethereum mainnet.
- **Paying in $THROBBIN still costs ETH for gas**, and it is two transactions
  (approve, then mint). A wallet holding 600,000 THROBBIN and no ETH cannot
  raise a line. The game says so plainly, but it will still be the most common
  question.

**Adding a mini game later** is one transaction, not a deploy:

```
TOLL=dice COIN=0.001 TOKEN=5000 npm run toll:robinhood
```

then one call on the server — see `Launching_On_Robinhood_Chain.md` §2.

---

## Still open

- **How the 80% pot divides.** Not needed to launch; needed before anyone can
  be paid.
- **Duties are scriptable** — roughly 30 lines and 31 seconds a day. Movement
  validation was deliberately deferred and is the obvious next step if the
  standings start looking wrong.
- **Taking real money and paying on ranked performance** is worth an hour of
  professional advice before the mint opens rather than after.
