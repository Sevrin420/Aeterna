# Games on membersonly.cc: inline X cards, login and anonymous play

This is the working reference for the series of games. Read `Auth_and_Accounts.md` for the account and wallet design in full.

## Status at a glance

| Piece | State |
|---|---|
| Inline X player cards | **Live** for Lunch Rush (`/lunch-rush/`) |
| Throbbin Abbey | Live, on its own wallet-based dev login |
| Shared accounts (username + password) | **Specified, not built** |
| Wallet sign-in (SIWE) and NFT gating | **Specified, not built** |
| Anonymous play tracking | **Specified, not built**. Lunch Rush doesn't record plays yet |

Nothing below says a feature works unless the table says it does.

## How the games are built

- Each game is a **single static HTML file** under `web/<game>/`, served at `https://membersonly.cc/<game>/`. The server (`server/src/index.js`) serves `web/` as static files.
- Games have no backend of their own. Anything that must be remembered (plays, rewards, accounts) goes through the shared server API described in `Auth_and_Accounts.md`.
- Each game's `index.html` carries the X card tags. Copy the block from `web/lunch-rush/index.html` for a new game and change the title, description, path and image.

## Launching a game inline on X

X embeds a game as a **player card**: a 480×480 iframe in the timeline.

Required tags in `<head>` (see `web/lunch-rush/index.html`):

```html
<meta name="twitter:card" content="player">
<meta name="twitter:site" content="@sevrin420">
<meta name="twitter:title" content="...">
<meta name="twitter:description" content="...">
<meta name="twitter:image" content="https://membersonly.cc/<game>/previ.png">
<meta name="twitter:image:width" content="1200">
<meta name="twitter:image:height" content="630">
<meta name="twitter:player" content="https://membersonly.cc/<game>/">
<meta name="twitter:player:width" content="480">
<meta name="twitter:player:height" content="480">
```

Rules that matter for a game to embed:

- **Fit 480×480.** The game must play at that size and on phones.
- **Don't send frame-blocking headers.** The server must not send `X-Frame-Options` or a `Content-Security-Policy` with a narrow `frame-ancestors`. The Caddy site block for each game must allow `frame-ancestors` for X.
- **No external requests.** Keep each game self-contained so it loads inside the iframe.
- **Card image.** `previ.png` at 1200×630 is what X shows before the player loads. Only the first frame of a GIF is used, so an animated GIF doesn't animate on the card.
- **X caches cards.** A changed image or title can take days to refresh. Renaming the image file forces a new fetch.
- **Timeline posts.** A post with attached media (GIF or video) doesn't show the player card. Post the game link as a reply, or post the card alone.

## Login for players

Two ways in. Both end in the same account, and a player can use either or both.

### Username and password
- Create with a username and password. **No email is collected.**
- **There is no password reset without a linked wallet.** A lost password with no wallet linked means a lost account. Signup says so before creating the account.
- Linking a wallet makes password reset possible.

### Wallet (Sign-In with Ethereum)
- The player signs a message with their wallet. The server verifies it and signs them in.
- A wallet with no account creates a **wallet-only account**. No password needed. Sign in again with the same wallet to come back.
- The wallet also proves control of an NFT, which gates restricted games and prizes.
- **One wallet per account.** An account links at most one wallet.

### Access levels per game
Each game declares one level:

| Level | Who can play |
|---|---|
| `open` | Anyone, no account |
| `account` | Any signed-in account |
| `wallet` | Accounts with a linked wallet |
| `nft` | Linked wallet that currently holds the gate NFT (read from chain at entry) |

## Playing anonymously

- Some games are open to anyone without signing in.
- **Every play is recorded**, signed in or not:
  - signed-in plays attach to the account;
  - anonymous plays group under an anonymous id stored in a one-year cookie.
- If an anonymous player later signs up, logs in or links a wallet, their anonymous history moves to that account. Each anonymous id can be claimed once.
- Clearing cookies or switching browser starts a new anonymous history. Anonymous history is for convenience, not a record that can be relied on.

## Rewards

- **Only accounts with a linked wallet are reward-eligible**, because rewards are paid to a wallet.
- Anonymous players and password-only accounts still appear in leaderboards and analytics.
- Linking a wallet makes all earlier plays on the account count. Plays are never re-scored, only counted when a reward is computed.

## Adding a new game (checklist)

1. Create `web/<game>/index.html`, self-contained, 480×480, with the card tags above.
2. Create `web/<game>/previ.png` at 1200×630.
3. Choose the access level for the game.
4. Register the game id, title and access level in the server's game registry (once it exists).
5. Confirm the game's path returns 200 and that the Caddy site block allows X to frame it.
6. Post the link as a reply to a card-only post.

## Open decisions

- Which chain and collection gate NFT prizes. Robinhood (4663) and Avalanche (43114) are both candidates, and the docs disagree about whether Robinhood is deployed. See `Auth_and_Accounts.md`.
- Whether existing pseudo-wallet players in Throbbin Abbey are carried over when the new login ships.
