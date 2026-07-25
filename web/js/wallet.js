// Wallet + Cultist-NFT hooks for the entrance lobby.
//
// The game is meant to be opened inside a crypto wallet's in-app browser
// (MetaMask, Coinbase Wallet, Trust, Rabby, etc.), which injects an EIP-1193
// provider at window.ethereum. connectWallet() does a real account request;
// fetchCultists() is where the on-chain ownership check will live once the
// Cultist NFT contract exists — until then it returns none, so every player
// falls through into the game as a wandering spirit (per the design).

// ── DEMO / TEST MODE ────────────────────────────────────────────────────────
// Add ?demo (or ?mock) to the URL to test the full connect -> choose-Cultist ->
// enter flow WITHOUT owning any NFT, and even on a browser with no wallet:
//   https://membersonly.cc/?demo            -> mock connect + 3 sample Cultists
//   https://membersonly.cc/?mockCultists=5  -> real connect, but 5 fake Cultists
//   https://membersonly.cc/?mockWallet      -> mock connect only (0 Cultists)
// A real wallet browser without these params behaves for real.
const _params = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
const DEMO = _params.has('demo') || _params.has('mock');
export const MOCK_CULTISTS = _params.has('mockCultists')
  ? Math.max(0, parseInt(_params.get('mockCultists'), 10) || 3)
  : (DEMO ? 3 : 0);
export const MOCK_WALLET = DEMO || _params.has('mockWallet') || MOCK_CULTISTS > 0;
const DEMO_ADDR = '0xDEM0000000000000000000000000000000000000';
const DEMO_NAMES = ['Brother Vane', 'Sister Morrow', 'The Pale Acolyte', 'Brother Ash', 'Sister Thorn', 'Wraithe'];

export function isDemoMode() { return MOCK_WALLET; }

export function hasInjectedWallet() {
  return MOCK_WALLET || (typeof window !== 'undefined' && !!window.ethereum);
}

// Prompt the wallet to connect and return the selected address. Uses the real
// injected provider when present; falls back to a demo address only when a
// demo/mock URL param is set. Throws 'NO_WALLET' if neither applies.
export async function connectWallet() {
  const eth = typeof window !== 'undefined' ? window.ethereum : null;
  if (eth) {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('NO_ACCOUNT');
    return accounts[0];
  }
  if (MOCK_WALLET) return DEMO_ADDR; // no real wallet, but demo mode is on
  throw new Error('NO_WALLET');
}

export function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

// Return the Cultist NFTs owned by `address` as [{ id, name, image }].
//
// ── WIRE-IN POINT ──────────────────────────────────────────────────────────
// When the Cultist collection is deployed, resolve ownership here. Two easy
// options:
//   1. An indexer (Alchemy/Moralis/Reservoir) NFT-by-owner endpoint, filtered
//      to the Cultist contract address, then map each token to {id,name,image}.
//   2. Read the contract directly: balanceOf(address) + tokenOfOwnerByIndex,
//      then tokenURI -> metadata.
// Set CULTIST_CONTRACT and implement, keeping the empty-array fallback so a
// wallet with no Cultists still returns [] (the caller lets them in as a
// spirit).
export const CULTIST_CONTRACT = null; // e.g. '0x...'
export async function fetchCultists(/* address */) {
  if (MOCK_CULTISTS > 0) {
    return Array.from({ length: MOCK_CULTISTS }, (_, i) => ({
      id: i + 1,
      name: DEMO_NAMES[i % DEMO_NAMES.length],
    }));
  }
  if (!CULTIST_CONTRACT) return [];
  return [];
}
