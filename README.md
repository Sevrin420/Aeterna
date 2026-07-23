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

## Stack

Game Server: Node.js + Fastify + better-sqlite3 · Realtime: Socket.io · Signing: Cloudflare Worker (Devotion signature on manual save) · Contracts: Solidity (ERC-721 + ERC-6551) · Frontend: static · Process manager: PM2

See `docs/Architecture.md` for the full design.

## Status

Starter server only — see `server/README.md` for what's implemented vs. still needed (wallet-signature auth, on-chain payment verification, admin-wallet protection, full duty/streak logic, etc.) before this is exposed publicly.

## Contract deployment

Smart contract deployment (testnet or mainnet) requires explicit confirmation from the project owner before any deploy script runs. No exceptions.
