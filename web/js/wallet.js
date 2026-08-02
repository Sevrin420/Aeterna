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

// ── WALLETCONNECT ───────────────────────────────────────────────────────────
// The game is played in an ordinary browser as often as inside a wallet's own,
// and an ordinary browser has no window.ethereum to ask. WalletConnect is the
// bridge: it puts up a QR code on desktop and deep-links straight into the
// wallet app on a phone.
//
// Two things this needs that are NOT code:
//
//   1. A PROJECT ID from cloud.reown.com (free). It is public — it identifies
//      the dapp to the relay, it is not a secret — so it lives in a meta tag in
//      index.html rather than in a build. With no project id set, the whole
//      path stays shut and connectWallet() falls back to whatever is injected.
//   2. Network access to a CDN at runtime, because there is no build step here
//      to bundle the library into. The import is lazy, so a player who never
//      presses Connect never fetches it, and a failure to fetch surfaces as a
//      plain error rather than a dead button.
const _meta = (n) => (typeof document !== 'undefined'
  ? (document.querySelector(`meta[name="${n}"]`) || {}).content || '' : '');
export const WC_PROJECT_ID = _meta('wc-project-id');
const WC_CHAIN = Number(_meta('wc-chain-id')) || 43114;      // Avalanche C-Chain
// The deployed collection. Both are read by fetchCultists() below.
export const BLOODLINE_ADDRESS = _meta('bloodline-address');
export const BLOODLINE_CHAIN_ID = Number(_meta('bloodline-chain-id')) || 43114;
const WC_SRC = 'https://esm.sh/@walletconnect/ethereum-provider@2.17.2';

export function hasWalletConnect() { return !!WC_PROJECT_ID; }

let _wc = null;
async function initWalletConnect() {
  if (_wc) return _wc;
  if (!WC_PROJECT_ID) throw new Error('WC_NOT_CONFIGURED');
  let mod;
  try {
    mod = await import(/* @vite-ignore */ WC_SRC);
  } catch {
    throw new Error('WC_LOAD_FAILED');
  }
  const EthereumProvider = mod.EthereumProvider || mod.default;
  _wc = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [WC_CHAIN],
    showQrModal: true,
    metadata: {
      name: 'Vita Aeterna',
      description: 'A death-cult abbey.',
      url: typeof location !== 'undefined' ? location.origin : 'https://membersonly.cc',
      icons: [`${typeof location !== 'undefined' ? location.origin : ''}/assets/icon.png`],
    },
  });
  return _wc;
}

// Opens the WalletConnect modal (or the wallet app, on a phone) and returns the
// address that came back.
export async function connectWalletConnect() {
  const wc = await initWalletConnect();
  await wc.connect();
  const accounts = wc.accounts || [];
  if (!accounts.length) throw new Error('NO_ACCOUNT');
  return accounts[0];
}

export async function disconnectWallet() {
  try { if (_wc) await _wc.disconnect(); } catch { /* already gone */ }
  _wc = null;
}

// Prompt the wallet to connect and return the selected address. Uses the real
// injected provider when present; falls back to a demo address only when a
// demo/mock URL param is set. Throws 'NO_WALLET' if neither applies.
export async function connectWallet() {
  if (MOCK_WALLET) return DEMO_ADDR;
  // Inside a wallet's own browser, ask it directly — putting a WalletConnect QR
  // in front of someone who is already standing in MetaMask is nonsense.
  const eth = typeof window !== 'undefined' ? window.ethereum : null;
  if (eth) {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('NO_ACCOUNT');
    return accounts[0];
  }
  if (WC_PROJECT_ID) return connectWalletConnect();
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
