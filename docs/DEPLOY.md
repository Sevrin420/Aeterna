# Deploy

Three steps. **PREFLIGHT** is free and changes nothing. **LAUNCH** opens the
doors and is irreversible. **BEGIN** starts the clock, and is yours to fire
whenever you like — the run does not start until you do.

---

## Before either: four things only you can do

Nothing in the repository can do these, and PREFLIGHT will tell you if any is
missing rather than letting the launch find out.

| | |
|---|---|
| **Real secrets** | `DEPLOYER_KEY`, `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`, `ADMIN_TOKEN` — credentials. These must be repo secrets and must never be pasted anywhere. |
| **`OLD_DEPLOYER_KEY`** | The key for `0x2cBf16…`, which owns the Avalanche collection. **Needed to close the old mint**, because the new deployer does not own it. Also a secret. |
| **Addresses** | `TEAM_ADDRESS`, `TREASURY_ADDRESS`, and the deployer's own address — **public**, and readable off the chain by anyone. Keep them as secrets, or type them straight into the workflow inputs. Typed wins; the secret is the fallback. |
| **`ADMIN_TOKEN`** | **A password you invent.** Any long random string — it is not issued by anyone and does not have to look like anything. It does two things: it **starts the run** (`/admin/begin`) and it **reads the final standings**. Both endpoints answer 404 without it, so a launch held at day 0 with no token is a run that can never start. LAUNCH refuses that combination. |
| **Gas** | ETH in the deployer wallet **on Robinhood Chain**. Bridged in ahead of time. |
| **Team + treasury** | Must be addresses you control **on Robinhood Chain**. Both are immutable at deploy. |

### The wallets, as configured

| Role | Address |
|---|---|
| Deployer / owner | `0x91596DFCD3aA33cBB6a20D1BaAA82c072c40b2A2` |
| Team (20%) | `0xe8C03A96fEC88E51f7BB1315bF58F38321B5aCaB` |
| Treasury (80%) | `0x018B025A1f4d4C049CE4B24ACC080E6f922e67e8` |
| $THROBBIN | `0xe8fB470E0685437d7739BD2AacBA60b228800335` |

All four are distinct — checked, not assumed. They are the workflow defaults, so
nothing needs typing at the button.

**`DEPLOYER_KEY` must be the key for `0x91596D…`.** It is a *new* wallet: the
Avalanche collection was deployed by `0x2cBf16…`, which is why the old chain
needs its own key — see below.

### The four wallets, and which are which

| Role | What it is | Where it lives |
|---|---|---|
| **Deployer / owner** | Signs the deploys. Opens and closes the mint, takes the founder line, names and prices tolls. **Never receives mint money.** | `DEPLOYER_KEY` |
| **Team** | 20% of everything minted and every toll | `TEAM_ADDRESS` |
| **Treasury** | 80% — the pot the run pays out of | `TREASURY_ADDRESS` |
| **Founder line** | The free Bloodline. Minted by the owner, **to** the owner, and soulbound there forever. Excluded from the payout. | the deployer wallet |

Mint money never touches the deployer wallet: `withdraw()` and `withdrawToken()`
pay only team and treasury, both immutable, and anyone may call them. So a
compromised deployer key costs you control of the mint — not the funds — **as
long as the treasury is a different wallet**.

PREFLIGHT prints all three and says plainly when any two are the same. They are
fixed forever at deploy, so that report is the last honest moment to notice.

**Team and treasury are addresses, not keys.** Nothing is protected by keeping
them in a secret — anyone can read them off the chain. They can go in the
workflow inputs instead, where you can see them in the confirm summary before
pressing LAUNCH. The launch refuses anything that is not a 40-hex-digit address
before it signs, since both are immutable the moment the constructor runs.

**`DEPLOYER_KEY` is a private key and is different in kind.** It must stay a
repo secret. So must `VPS_SSH_KEY` and `ADMIN_TOKEN`.

**The deployer's ADDRESS is public, and worth stating.** It is derived from the
key and configured nowhere, so without a second source the runner deploys with
whatever key it holds — and the first sign it was the wrong one is a collection
owned by a wallet you do not control and an old mint that cannot be closed.
`expect_deployer` is that second source: name the wallet you mean, and a secret
holding a different key fails **before anything is signed**, in both PREFLIGHT
and LAUNCH. The key itself never appears in a log.

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
| `expect_deployer` | `0x91596DFCD3aA33cBB6a20D1BaAA82c072c40b2A2` (defaulted) |
| `team_address` | `0xe8C03A96fEC88E51f7BB1315bF58F38321B5aCaB` (defaulted) |
| `treasury_address` | `0x018B025A1f4d4C049CE4B24ACC080E6f922e67e8` (defaulted) |
| `await_begin` | `true` — **opens the doors, holds the clock at day 0** |
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

**The old chain also needs its own key.** `setMintOpen` is `onlyOwner`, and the
Avalanche collection is owned by `0x2cBf16…` — not by the new deployer. Set
`OLD_DEPLOYER_KEY` to that wallet's key and the close and sweep use it; leave it
unset and the close will revert. Sweeping works either way, because `withdraw()`
is callable by anyone.

If you would rather not put the old key in this repo at all, close the Avalanche
mint by hand first and run LAUNCH with `old_contract` blank. The money can still
be swept afterwards by anybody.

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
    `CONFESSION_TREASURY`, `TOLLS_ADDRESS`, `ABBEY_AWAIT_BEGIN`,
    `FOUNDER_TOKEN_ID` and `ADMIN_TOKEN` to `/etc/aeterna-server.env`;
    **archives the player database**; checks `/collection` reports the new
    address; and **opens the mint last**

It does **not** start the run — see step 3 below.

### It is irreversible

It signs a deploy, archives the live player database and opens a public mint.
The guards are the typed `LAUNCH` and the test gate. There is no undo.

The archive is not optional: token ids restart at 1 on a new collection and
`/bind` refuses a token already bound to a row, so without it the first person
to mint the new #1 is told it belongs to someone else and cannot get in at all.

---

## 3. BEGIN — the starting gun

### First: `ADMIN_TOKEN`

It is not a thing you obtain. You make one up, save it as a repo secret, and
keep a copy where you keep passwords. Any long random string; 32+ characters is
plenty. One way to make one:

```
openssl rand -hex 32
```

or on a Mac/Linux box without openssl:

```
head -c 32 /dev/urandom | base64
```

It is the only key to two doors, both of which fail closed — no token on the
server means the endpoint does not exist:

| | |
|---|---|
| `POST /admin/begin` | **Starts the run.** Without this you cannot begin at all. |
| `GET /admin/standings` | The final Devotion table with holder addresses — how you know who to pay. |

Lose it and you can put a new one in `/etc/aeterna-server.env` on the box, so it
is recoverable — but only by someone who can ssh in.


Launching does **not** start the run. With `await_begin` true the mint opens,
people connect, raise lines, name them and walk the abbey — and **nothing is
counted**. Duties do not pay, streaks do not accrue, the Confessor has nothing
to forgive. The board says so and the abbey says so on the way in.

Fire it when you are ready:

```
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://membersonly.cc/admin/begin
```

**That instant becomes day 0, for everybody at once.** Week 1 starts, the base
duty is worth 10, and there are 56 days on the clock.

Ask without firing:

```
curl -H "x-admin-token: $ADMIN_TOKEN" https://membersonly.cc/admin/begin
```

Three things worth knowing:

- **It fires once.** A second call is refused and tells you when the first was.
  Day 0 moving after people have started keeping streaks would rewrite every
  week boundary underneath them.
- **It survives a restart.** The time is written to the database, not held in
  the process — a bounced service must not silently reschedule the run.
- **It needs `ADMIN_TOKEN`.** Without it the endpoint is a 404 and there is no
  way to start the run at all.

Why hold at all: without it, week 1 burns while people are still minting, and
whoever gets in on the first afternoon is a week ahead of whoever gets in on
the second.

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
