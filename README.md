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

Then open `http://localhost:3000/` — the Fastify server serves the `web/` frontend directly alongside the API. Slide the power switch (bottom-right of the console) on, watch **AETERNA** fall into place, press **A** to enter the abbey courtyard, and move with the D-pad or arrow keys.

## Status

Starter server + first playable frontend scene. See `server/README.md` for what's implemented vs. still needed (wallet-signature auth, on-chain payment verification, admin-wallet protection, full duty/streak logic, etc.) before this is exposed publicly. The frontend currently ends at the courtyard — duties, gifts, and multiplayer presence (already stubbed in the Socket.io server) are not yet wired into the client.

## Contract deployment

Smart contract deployment (testnet or mainnet) requires explicit confirmation from the project owner before any deploy script runs. No exceptions.
