// Wallet + Cultist-NFT hooks for the entrance lobby.
//
// The game is meant to be opened inside a crypto wallet's in-app browser
// (MetaMask, Coinbase Wallet, Trust, Rabby, etc.), which injects an EIP-1193
// provider at window.ethereum. connectWallet() does a real account request;
// fetchBloodlines() reads the deployed collection for what that wallet holds.
// A wallet holding nothing still falls through into the game as a wandering
// spirit (per the design) — but a wallet whose chain read FAILS does not, since
// "the RPC is down" and "you own nothing" must never look the same.

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

// ── THE CHAIN ───────────────────────────────────────────────────────────────
// There is no build step here, so there is no ethers to import. The contract
// surface the game actually touches is five calls wide, and every argument is
// either an address or a uint256 — so the encoding is done by hand rather than
// pulling a library over a CDN on the critical path of the title screen.

// Whichever provider the current connection is riding on. The injected one when
// the game is open inside a wallet's browser, the WalletConnect session
// otherwise — reads and writes must both go through the SAME one, or a mint
// gets signed by a wallet that never agreed to the read.
function activeProvider() {
  if (typeof window !== 'undefined' && window.ethereum) return window.ethereum;
  if (_wc) return _wc;
  return null;
}

const SEL = {
  bloodlinesOf: '0x979ec4c9',
  cultistsOf: '0x5c9f881c',
  pricePerCultist: '0x9cb324c4',
  mintOpen: '0x24bbd049',
  mint: '0xa0712d68',
  ownerOf: '0x6352211e',
};

const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const padUint = (n) => BigInt(n).toString(16).padStart(64, '0');
const hexToBig = (h) => BigInt(h && h !== '0x' ? h : '0x0');

// Split a 32-byte-word return blob into words.
function words(hex) {
  const b = (hex || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= b.length; i += 64) out.push(b.slice(i, i + 64));
  return out;
}

// Which chain the wallet is actually pointed at right now.
export async function currentChainId() {
  const p = activeProvider();
  if (!p) return null;
  try {
    return Number(await p.request({ method: 'eth_chainId' }));
  } catch {
    return null;
  }
}

const AVALANCHE_PARAMS = {
  chainId: '0xa86a',                       // 43114
  chainName: 'Avalanche C-Chain',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
  blockExplorerUrls: ['https://snowtrace.io'],
};

// Ask the wallet to move to Avalanche, adding it if it has never heard of it.
// MetaMask opens on whichever chain the player last used — usually Ethereum —
// and every read below would then be answered by a chain that has never heard
// of this contract.
export async function ensureChain() {
  // There is no chain to switch to in demo mode, and no provider to ask. Every
  // other demo entry point short-circuits like this; this one did not, so
  // ?demo threw NO_WALLET here and could never reach the Bloodline picker —
  // the documented way to look at the entrance without a wallet was shut.
  if (MOCK_WALLET) return true;
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if ((await currentChainId()) === BLOODLINE_CHAIN_ID) return true;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: AVALANCHE_PARAMS.chainId }] });
  } catch (e) {
    // 4902: the wallet does not know this chain yet. Anything else is the
    // player declining, and declining is their right — it is not an error to
    // shout about, but nothing on-chain can be read until they relent.
    if (e && (e.code === 4902 || e.code === -32603)) {
      try {
        await p.request({ method: 'wallet_addEthereumChain', params: [AVALANCHE_PARAMS] });
      } catch {
        throw new Error('WRONG_CHAIN');
      }
    } else {
      throw new Error('WRONG_CHAIN');
    }
  }
  if ((await currentChainId()) !== BLOODLINE_CHAIN_ID) throw new Error('WRONG_CHAIN');
  return true;
}

async function ethCall(data) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!BLOODLINE_ADDRESS) throw new Error('NO_CONTRACT');

  // Ask what chain we are on BEFORE trusting an answer from it. A wallet
  // sitting on Ethereum answers every one of these calls with '0x' — there is
  // no contract at this address there — and '0x' decodes to zero, which reads
  // as "mint closed" and "you hold nothing". Both are lies, and both are
  // indistinguishable from the truth unless the chain is checked here.
  const chain = await currentChainId();
  if (chain !== null && chain !== BLOODLINE_CHAIN_ID) throw new Error('WRONG_CHAIN');

  const out = await p.request({
    method: 'eth_call',
    params: [{ to: BLOODLINE_ADDRESS, data }, 'latest'],
  });
  // Right chain, no code at the address: a misconfigured meta tag, not a false.
  if (!out || out === '0x') throw new Error('NO_CONTRACT_HERE');
  return out;
}

// uint256[] comes back as [offset][length][...items]. The offset is always 0x20
// for a lone dynamic return, but it is read rather than assumed.
function decodeUintArray(hex) {
  const w = words(hex);
  if (!w.length) return [];
  const off = Number(BigInt('0x' + w[0])) / 32;
  const len = Number(BigInt('0x' + (w[off] || '0')));
  return w.slice(off + 1, off + 1 + len).map((x) => BigInt('0x' + x));
}

export async function fetchPricePerCultist() {
  return hexToBig(await ethCall(SEL.pricePerCultist));
}

// wei -> a human AVAX string. BigInt the whole way: a Number cannot hold wei
// without losing the low digits, and the earlier version of this scaled by 1e5
// and then split the string as if it were hundredths, so 0.01 AVAX read as
// "10.00". Display only — what is actually SENT is computed from the chain's
// own price in mintBloodline() and never from this.
export function formatAvax(wei, dp = 4, minDp = 2) {
  const scale = 10n ** 18n;
  const whole = wei / scale;
  const frac = ((wei % scale) * 10n ** BigInt(dp)) / scale;
  // Trim the noise off the end, but never below minDp — this is a price, and
  // "0.2 AVAX" reads as an odd amount where "0.20 AVAX" reads as money.
  const fs = frac.toString().padStart(dp, '0').replace(/0+$/, '').padEnd(minDp, '0');
  return fs ? `${whole}.${fs}` : `${whole}`;
}

export async function fetchMintOpen() {
  return hexToBig(await ethCall(SEL.mintOpen)) === 1n;
}

// Every Bloodline `address` holds, with the Cultists each one carries.
// Returns [{ id, cultists, name }] — ONE ENTRY PER BLOODLINE, not per Cultist.
// A wallet may hold several; the game makes you play one at a time, so the
// caller picks from this list and binds that token.
export async function fetchBloodlines(address) {
  if (MOCK_CULTISTS > 0) {
    return Array.from({ length: Math.min(3, MOCK_CULTISTS) }, (_, i) => ({
      id: i + 1,
      cultists: Math.max(1, Math.floor(MOCK_CULTISTS / Math.min(3, MOCK_CULTISTS))),
      name: DEMO_NAMES[i % DEMO_NAMES.length],
    }));
  }
  if (!BLOODLINE_ADDRESS || !address) return [];
  let ids;
  try {
    ids = decodeUintArray(await ethCall(SEL.bloodlinesOf + padAddr(address)));
  } catch (e) {
    // A dead RPC — or a wallet on the wrong chain — must not read as "you own
    // nothing". That would quietly demote a holder to a ghost and start them a
    // second pile of Devotion. The specific reasons are passed through so the
    // player is told which one it is.
    if (e && (e.message === 'WRONG_CHAIN' || e.message === 'NO_CONTRACT_HERE')) throw e;
    throw new Error('CHAIN_UNREACHABLE');
  }
  const out = [];
  for (const id of ids) {
    let cultists = 0;
    try { cultists = Number(hexToBig(await ethCall(SEL.cultistsOf + padUint(id)))); } catch { /* leave 0 */ }
    out.push({ id: Number(id), cultists, name: `Bloodline #${id}` });
  }
  return out;
}

// Kept for the callers that only want a head count. The total Cultists across
// every Bloodline held — which is NOT the same as the number of Bloodlines.
export async function fetchCultists(address) {
  const lines = await fetchBloodlines(address);
  return lines;
}

export function totalCultists(bloodlines) {
  return (bloodlines || []).reduce((n, b) => n + (b.cultists || 0), 0);
}

// Wait for a submitted transaction to be mined. Polls the same provider that
// signed it. Resolves with the receipt, or null if it never appears in time —
// the caller must treat null as "unknown", not as "failed", because the
// transaction may still be sitting in the mempool.
export async function waitForTx(hash, { tries = 60, everyMs = 2000 } = {}) {
  const p = activeProvider();
  if (!p) return null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await p.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (r) return r;
    } catch { /* keep waiting */ }
    await new Promise((res) => setTimeout(res, everyMs));
  }
  return null;
}

// Mint one Bloodline holding `cultists` Cultists. Exact payment only — the
// contract reverts on an over- or under-payment rather than keeping the
// difference, so the value is computed from the chain's own price, never from a
// number hardcoded here.
export async function mintBloodline(address, cultists) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!BLOODLINE_ADDRESS) throw new Error('NO_CONTRACT');
  const n = Math.floor(Number(cultists));
  if (!Number.isFinite(n) || n < 1 || n > 20) throw new Error('BAD_CULTISTS');
  if (!(await fetchMintOpen())) throw new Error('MINT_CLOSED');

  const price = await fetchPricePerCultist();
  const value = price * BigInt(n);
  return p.request({
    method: 'eth_sendTransaction',
    params: [{
      from: address,
      to: BLOODLINE_ADDRESS,
      data: SEL.mint + padUint(n),
      value: '0x' + value.toString(16),
    }],
  });
}
