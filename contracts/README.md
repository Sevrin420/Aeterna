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
