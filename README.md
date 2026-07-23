# Aeterna

*Vita Aeterna*

An invitation-only, multi-generational NFT cult RPG on Avalanche. Players mint Cultist NFTs, perform daily duties in a shared top-down pixel abbey, build streaks, level up, and at the end of each season perform Final Communion. Value accrual is expressed through **Devotion**; Souls carry Devotion across generations.

## Layout

| Path | Contents |
|------|----------|
| `docs/Aeterna_GDD_v4.1.md` | Full game design document |
| `docs/Architecture.md` | Backend architecture (VPS + Cloudflare Worker + contracts split) |
| `docs/API_and_WebSockets.md` | REST + WebSocket API spec |
| `docs/SQLite_Schema.sql` | Canonical off-chain data schema |
| `docs/Contract_Changes.md` | Smart contract rename map and required changes |
| `docs/Aeterna_Handoff_Overview.md` | Original handoff summary and next steps |
| `server/` | Node.js (Fastify + Socket.io + better-sqlite3) starter game server, intended to run on a VPS via PM2 |
| `web/` | Static pixel-art frontend: the Egyptian console boot screen and the first playable scene (abbey courtyard) |

## Stack

Game Server: Node.js + Fastify + better-sqlite3 · Realtime: Socket.io · Signing: Cloudflare Worker (Devotion signature on manual save) · Contracts: Solidity (ERC-721 + ERC-6551) · Frontend: static · Process manager: PM2

See `docs/Architecture.md` for the full design.

## Running the game locally

```bash
cd server
cp .env.example .env
npm install
npm start
```

Then open `http://localhost:3000/` — the Fastify server serves the `web/` frontend directly alongside the API. Slide the power switch (bottom-right of the console) on, watch **AETERNA** fall into place, press **A**, name your Cultist, and you're in the abbey courtyard.

In the courtyard: walk to the **shrine**, **garden**, or **candle rack** and press A to perform each of the three daily duties (real Devotion + streak logic server-side, per `docs/Aeterna_GDD_v4.1.md` §5); pick up a **gift** and press A near the **Guru** statue to offer it (+50 Devotion) or near another connected player to gift them (+10/+5, daily limits enforced); press B to drop a held gift; a broken streak lights up the **confession booth** with its escalating cost; check the **leaderboard** scroll for the top Cultists by Devotion; press 1/2/3 for an emoji reaction; and stand at the **gate** and press B for Save & Exit (calls `/save`, then powers the console off). Other players connected at the same time appear, move, and react live via Socket.io.

## Status

Starter server + a fully playable first scene. Player identity is a **dev-mode stand-in**: the client generates a local pseudo-wallet id (`localStorage`) and `POST /register` upserts a Cultist row for it — there is no real wallet/SIWE auth yet, no on-chain mint, and `/confession`'s cost isn't verified against an actual ETH payment (see `server/README.md` for the full still-needed list: wallet-signature auth, on-chain payment verification, admin-wallet protection). Levels, Souls, Bloodline/Children, Final Communion, and the 2-player wager game (GDD §6-10) are not implemented yet — this covers the daily duty loop, physical gifts, confession, and live multiplayer presence (GDD §5, §11).

## Contract deployment

Smart contract deployment (testnet or mainnet) requires explicit confirmation from the project owner before any deploy script runs. No exceptions.
