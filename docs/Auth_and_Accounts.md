# Accounts and Auth (shared across all games)

Status: **spec, not implemented.** Decisions below are settled unless marked open.

## Goals

- One account works across every game on membersonly.cc.
- Players sign up with a username and password, or with a wallet. No email is collected.
- A wallet proves control of an address with SIWE (EIP-4361) and is used to gate NFT-restricted games and prizes.
- Each game declares its own access level. Most games need only a logged-in account.

## Decisions

| Topic | Decision |
|---|---|
| Email | None. Never collected. |
| Password reset | Only via a linked wallet. An account with no wallet has no reset: a lost password means a lost account. |
| Wallet-only accounts | Allowed. No password needed. Sign in again with the same wallet to recover. |
| Wallets per account | **One.** A wallet links to at most one account, and an account holds at most one wallet. |
| Gating chain | **Undecided.** Chain, RPC and collection come from config per gate, so the choice is a config change. |

## Account types

| Type | Credentials | Can play | Recovery |
|---|---|---|---|
| Password only | username + password | Open, Account games | None. Signup warns the player that a lost password is unrecoverable and offers to link a wallet. |
| Password + wallet | username + password + linked wallet | All, including Wallet games | Reset by signing a SIWE message with the linked wallet |
| Wallet only | wallet | Open, Account, Wallet, NFT-gated games | Sign in again with the wallet |

## Access levels

Each game (or prize) declares one level. The shared auth layer enforces it.

| Level | Requirement | Checked |
|---|---|---|
| `open` | None | — |
| `account` | Valid session | Every request |
| `wallet` | Session whose account has a linked wallet | Every request |
| `nft` | Linked wallet currently holds the gate NFT | Entry to the game, and every prize claim, read from chain |

A login-time NFT check is only a display hint. Access and prize decisions re-read chain state.

## Data model

```sql
accounts (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,              -- argon2id; NULL for wallet-only accounts
  created_at    TEXT NOT NULL
);

wallets (
  address    TEXT PRIMARY KEY,     -- checksummed; globally unique
  account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),  -- one wallet per account
  linked_at  TEXT NOT NULL
);

sessions (
  token_hash TEXT PRIMARY KEY,     -- SHA-256 of the cookie token; the raw token is never stored
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

siwe_nonces (
  nonce      TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL,        -- 'login' | 'link' | 'reset'
  account_id INTEGER,              -- set for 'link' and 'reset'
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
```

Each account has at most one wallet. The `wallets.account_id UNIQUE` constraint enforces that. `wallets.address` is unique, so a wallet cannot sit on two accounts.

## Endpoints

All under `/auth`. Responses never reveal whether a username exists.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | `{username, password}`. Creates a password-only account and sets a session. Rejects a wallet already linked, if any. |
| POST | `/auth/login` | `{username, password}`. Sets a session. |
| POST | `/auth/logout` | Revokes the current session. |
| GET | `/auth/me` | Returns `{accountId, username, wallet, nftStatus}` or 401. Used by every game. |
| POST | `/auth/siwe/nonce` | `{purpose}`. Returns a single-use nonce, valid for about 5 minutes. |
| POST | `/auth/siwe/login` | `{message, signature}`. Logs in as the account holding that wallet, or creates a wallet-only account if none exists. |
| POST | `/auth/siwe/link` | `{message, signature}`. Requires a session. Links the wallet to the current account. Fails if the wallet or the account already has one. |
| POST | `/auth/siwe/reset` | `{message, signature, newPassword}`. Sets a new password for the account the wallet is linked to. |

## Wallet sign-in (SIWE)

1. Client requests a nonce from `/auth/siwe/nonce` with its purpose.
2. Client builds an EIP-4361 message: `domain = membersonly.cc`, `uri`, `chainId`, `nonce`, `issuedAt`, `expirationTime`. The chain ID in the message is the server's login chain, not the gating chain.
3. Wallet signs. Server verifies:
   - signature recovers to the address;
   - `domain` matches exactly;
   - nonce exists, is unused, and is unexpired (marked used atomically);
   - `purpose` matches the endpoint.
4. Server then acts per endpoint: login, link, or reset.

Nonces are single-use, so a captured signature can't be replayed.

## NFT gate check

- Config per gate: `{chainId, rpcUrl, contract, minBalance}`. Chain and contract are open, so this stays data, not code.
- `nft` access: read `balanceOf(wallet)` on the gate contract at the moment of entry or claim. Cache for a short TTL (30–60 s) to limit RPC use. Cache never serves a claim decision after a transfer you know about; claims bypass cache.
- A player who proved ownership and later sold the NFT loses `nft` access on the next check. Their account and password are unaffected.

## Signup warning (required copy)

Shown before a password-only account is created, and on the account page while no wallet is linked:

> There is no password reset without a linked wallet. If you forget your password, your account cannot be recovered. Link a wallet to be able to reset it.

## Security requirements

- Passwords: argon2id. Never logged.
- Sessions: random 256-bit token; cookie `HttpOnly; Secure; SameSite=Lax; Domain=.membersonly.cc; Path=/`; stored as hash; 30-day sliding expiry.
- Rate limits on `/auth/login`, `/auth/signup`, `/auth/siwe/*` per IP and per account.
- Generic errors for login failures: no username enumeration.
- State-changing POSTs require the session cookie plus a same-origin check.
- Password change or reset revokes all other sessions for that account.

## Existing identity

The current dev stand-in (`POST /register` with a client-generated pseudo-wallet id in `localStorage`) is replaced by this model. Existing Cultist rows keyed by that id need a migration plan before cutover. **Open:** whether any live players must be carried over.

## Open items

1. **Gate chain and collection.** Undecided: Robinhood (4663) or Avalanche (43114). Config-driven, so it does not block the build. Also resolve the conflict between `docs/Launching_On_Robinhood_Chain.md` ("nothing deployed") and `contracts/deployments/robinhood.json` (a deployment dated 2026-08-13).
2. **Migration of pseudo-wallet players.** Keep, drop or map.
3. **Session domain.** Confirm `membersonly.cc` and subdomains are all controlled by the same deployment.

## Build order

1. Schema, argon2id hashing and session table with tests.
2. `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/me`.
3. SIWE nonce, verify, and login/link/reset endpoints with tests for replay, domain mismatch and expiry.
4. Access-level middleware and the NFT gate reader, with the chain read stubbed in tests.
5. Migrate the existing game to `/auth/me`.
