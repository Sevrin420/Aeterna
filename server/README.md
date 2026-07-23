# Aeterna Server Starter

Minimal Node.js + Fastify + SQLite + Socket.io backend for Season 1.

## Quick Start

```bash
cp .env.example .env
# edit .env with your values

npm install
npm start
# or
pm2 start src/index.js --name aeterna
```

This also serves the `../web` static frontend (the console boot screen + abbey courtyard scene) at `/`.

## What is included
- Dev-mode player registration (`/register`) — upserts a Cultist by a local pseudo-wallet id (see caveat below)
- Player state (`/me`), including computed streak multiplier and pending-confession status
- Full duty → Devotion → streak logic, with daily flag reset (`/duty/:type`)
- Escalating Confession cost, with real streak-break detection/logging and forgiveness on confess
- Gift spawning + pickup/give/drop backed by SQLite (`/gifts/*`), enforcing GDD daily limits
- Manual save (`/save`) — ready for Cloudflare Worker signature
- Admin Devotion award
- Full WebSocket presence, movement, emojis, chat, and physical gift flow (client wired up in `web/`)

## What you still need to add
- Real wallet-signature authentication (SIWE) — `/register` is a dev/testnet stand-in, not real auth
- Real Cloudflare Worker call inside `/save`
- On-chain payment verification for Confession (cost is computed and recorded, not collected)
- Level Up, Souls, Bloodline/Children, Final Communion, and the 2-player wager game
- Zone-based movement broadcasting (for performance at scale)

See the Architecture folder for full design.
