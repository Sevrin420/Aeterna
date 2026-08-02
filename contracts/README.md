# Aeterna Bloodline — Avalanche C-Chain

One NFT is a **Bloodline**. It is minted once holding **1–20 Cultists** at
**0.01 AVAX each**, and that count is fixed forever — there is no function
anywhere in the contract that raises it. A wallet may hold several Bloodlines;
the game makes you play one at a time.

Cultists do **not** change how much Devotion an act is worth. They are a
multiplier on the end-of-season payout, settled off-chain, so the contract
never needs to know what Devotion is.

Devotion lives on the server and is served through `tokenURI`, so a Bloodline's
card visibly upgrades as its holder plays — with no transaction, and with no
owner anywhere able to rewrite what a token holds.

## Deploying

```bash
cd contracts
npm install
cp .env.example .env      # then fill it in — every value is immutable
npm test                  # 11 tests; run them before spending anything

npm run deploy:fuji       # testnet first. Free AVAX: faucet.avax.network
npm run open:fuji         # mint starts CLOSED; this opens it
# mint once against Fuji, check the card, then:
npm run deploy:avalanche
npm run open:avalanche
```

The mainnet deploy prints every immutable value and waits 15 seconds before
signing, so a wrong address is a Ctrl-C rather than a redeploy.

Afterwards the script prints the two meta tags to paste into `web/index.html`.

## What is immutable, and why it matters

Set once at deploy and **never changeable**: price per Cultist, max supply, the
team address, the treasury address. There are deliberately no setters for any
of them, and the tests assert their absence.

The owner key can only: open/close the mint, and point `baseURI` at the server.
It **cannot touch the money** — `withdraw()` is callable by anyone and can only
ever push to the two addresses baked in at deploy, split 10% team / 90%
treasury, matching what the doctrine tells players. An open caller is
deliberate: if only an owner could move funds, a lost key would strand the
treasury.

## Before mainnet

- `npm test` green.
- Deployed and minted against Fuji at least once.
- `TEAM_ADDRESS` and `TREASURY_ADDRESS` checked character by character.
- `MAX_SUPPLY` decided — it cannot be raised later.
- This contract has **not been audited**. It is small and uses OpenZeppelin
  ERC721Enumerable + Ownable unmodified, but that is not the same thing.

## Deploying from GitHub (no local setup)

Actions tab → **Deploy Bloodline contract** → Run workflow.

### One-time: add three repository secrets

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | What it is |
|---|---|
| `DEPLOYER_KEY` | Private key of the deploying wallet, `0x`-prefixed. Needs a little AVAX for gas — that is all it ever needs. It does **not** receive mint money. |
| `TEAM_ADDRESS` | Gets 10% of mint. **Immutable once deployed.** |
| `TREASURY_ADDRESS` | Gets 90% of mint. **Immutable once deployed.** |
| `SNOWTRACE_KEY` | Optional, for contract verification. |

### About the deploying wallet

Make a **fresh wallet** for this and put only gas money in it. Its key ends up
in a CI secret, and a key in CI is a key on someone else's computer. It owns
the collection afterwards — it can open/close the mint and repoint metadata —
but it cannot touch a coin of the mint proceeds: those go straight to the two
addresses above, and there is no setter for either.

Gas on Avalanche for this deploy is cents. ~0.5 AVAX is plenty.

Never paste the key into an issue, a PR, a chat, or this repo.

### Then

1. Run with network **fuji**, action **deploy**. Watch the tests pass, then the
   address print.
2. Commit the printed `deployments/fuji.json` (download it from the run's
   artifacts) so `open-mint` can find it.
3. Run again with action **open-mint**. Mint one Bloodline from a wallet.
4. Happy? Same three steps with network **avalanche**, typing `DEPLOY` in the
   confirm box.
5. Paste the two printed meta tags into `web/index.html`.
