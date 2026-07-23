# API Endpoints & WebSocket Events

## REST API (Minimal)

### Auth
- POST /auth/login             (planned — see wallet-signature auth in server/README.md)
- POST /auth/logout             (planned)
- POST /register                ← current dev-mode stand-in: upserts a Cultist by a local pseudo-wallet id

### Player
- GET  /me                      ← includes computed `multiplier`, `needsConfession`, `confessionCost`
- POST /save                  ← triggers Cloudflare Worker signature

### Duties
- POST /duty/pray
- POST /duty/garden
- POST /duty/candles
- GET  /duty/status

### Gifts
- GET  /gifts/nearby
- POST /gifts/pickup
- POST /gifts/give               (`{ targetWallet }` for another Cultist, or `{ toGuru: true }`)
- POST /gifts/drop                ← returns a held gift to the ground at the given tile

### Confession
- POST /confession            ← escalating cost

### Social
- GET  /leaderboard
- GET  /player/:id

### Admin (protected)
- POST /admin/award
- POST /admin/rank
- POST /admin/unlock-yield

---

## WebSocket Events (Lightweight)

### Client → Server
| Event          | Payload                          | Purpose                    |
|----------------|----------------------------------|----------------------------|
| join           | { tokenId, name, prefix, x, y }  | Enter abbey                |
| leave          | —                                | Disconnect                 |
| move           | { x, y, dir }                    | Position update            |
| emoji          | { emoji }                        | Reaction                   |
| chat           | { text }                         | Optional chat              |
| pickup_gift    | { giftId }                       | Pick up gift               |
| offer_gift     | { targetPlayerId }               | Offer held gift            |
| accept_gift    | { fromPlayerId }                 | Accept offer               |
| decline_gift   | { fromPlayerId }                 | Decline offer              |
| drop_gift      | —                                | Drop held gift             |

### Server → Client
| Event             | Payload                              | Purpose                    |
|-------------------|--------------------------------------|----------------------------|
| player_joined     | { id, name, prefix, x, y }           | Player appeared            |
| player_left       | { id }                               | Player left                |
| player_moved      | { id, x, y, dir }                    | Movement                   |
| emoji_show        | { id, emoji }                        | Show emoji                 |
| chat_msg          | { id, name, text }                   | Chat                       |
| gift_picked       | { playerId, giftId }                 | Now holding gift           |
| gift_offered      | { fromPlayerId, giftId }             | Received offer             |
| gift_transferred  | { fromId, toId, giftId }             | Gift accepted & gone       |
| gift_dropped      | { playerId, giftId, x, y }           | Gift returned to world     |
