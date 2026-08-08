# API Endpoints & WebSocket Events

## REST API (Minimal)

### Auth
- POST /auth/login             (planned — see wallet-signature auth in server/README.md)
- POST /auth/logout             (planned)
- POST /register                ← current dev-mode stand-in: upserts a Cultist by a local pseudo-wallet id

### Player
- GET  /me                      ← includes computed `multiplier`, `needsConfession`, `confessionCost` (AVAX) and `confessionPrice` ({week, pct, cultists, wei, avax}); both null when nothing is owed AND when the chain cannot be read
                                Also everything the Reckoning board reads, all of it derived and none of it stored:
                                `taskDevotion` ({base, award, week}), `clock` (the same shape as /day) and
                                `referralDevotion` ({asReferee, broughtIn, fromBringing, total}).
- GET  /day                     ← the abbey's clock: {day, week, ended, lastDay, daysLeft, weeks, since, confessionPct}.
                                Day 0 is the contract's deployment day; the run is days 0-55 (8 weeks). Replaces /season — no seasons, no break, no Final Communion.
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
- POST /confession            ← price is a % of the line's mint cost by week (25% wk1, 50% wk2-4, 100% wk5-7, 200% wk8) x its Cultists.
                                Call with no txHash -> 402 {price, payTo}. Pay, then call with txHash: the payment is verified on-chain (receipt succeeded, to == treasury, value >= quoted, sender holds the token, hash unspent) before the streak is mended.

### Referrals & X
- POST /referral              ← `{ xHandle }`. Pays 10 to both sides, once. 409 if the referee was already
                                brought in, if the pair is mutual, or if the referrer has already brought in
                                their 10 (`REFERRAL_CAP`); 400 for naming yourself or another line of your own wallet.
- POST /referral/decline      ← closes the question for good; asking is a one-time thing.
- POST /x/claim               ← `{ kind: 'comment', postId }`. 5 Devotion, once per post and at most twice a
                                day (`X_DAILY_CLAIMS`) — 429 past that, checked before the trip to X. 503 when
                                X verification is not configured.

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
