// Wallet + Cultist-NFT hooks for the entrance lobby.
//
// The game is meant to be opened inside a crypto wallet's in-app browser
// (MetaMask, Coinbase Wallet, Trust, Rabby, etc.), which injects an EIP-1193
// provider at window.ethereum. connectWallet() does a real account request;
// fetchBloodlines() reads the deployed collection for what that wallet holds.
// A wallet holding nothing still falls through into the game as a wandering
// spirit (per the design) — but a wallet whose chain read FAILS does not, since
// "the RPC is down" and "you own nothing" must never look the same.

import { GAME_NAME } from './config.js';
import { beginWait, endWait } from './wait.js';

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
// The deployed collection. Both are read by fetchCultists() below.
export const BLOODLINE_ADDRESS = _meta('bloodline-address');
export const BLOODLINE_CHAIN_ID = Number(_meta('bloodline-chain-id')) || 43114;
// WalletConnect opens on the same chain the collection lives on. It used to be
// a second number that could drift out of step with the first.
const WC_CHAIN = Number(_meta('wc-chain-id')) || BLOODLINE_CHAIN_ID;
// The gas token's ticker, shown wherever a price is. ETH on Robinhood Chain,
// AVAX on Avalanche — a label, never used for arithmetic.
export const COIN = _meta('chain-symbol') || 'AVAX';
// Everything priced that is not the mint — mini games and whatever else gets
// built. Empty until the tolls contract is deployed, and empty must read as
// "nothing is priced yet", never as an error.
export const TOLLS_ADDRESS = _meta('tolls-address') || '';
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
      name: GAME_NAME,
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
  // The second door: paying in the collection's ERC-20 instead of the coin.
  payToken: '0x96336b30',
  tokenPricePerCultist: '0xa157c70f',
  mintWithToken: '0xb3eaff8b',
  // …and the token's own surface, called AT THE TOKEN, not at the collection.
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',
  approve: '0x095ea7b3',
  transfer: '0xa9059cbb',
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

// Everything the wallet needs to be told about the chain, from the same meta
// tags a deploy rewrites. The hex id is DERIVED from BLOODLINE_CHAIN_ID rather
// than written out again: when those two were separate values, moving the game
// to another chain switched the wallet to Avalanche and then compared the
// result against the new chain, so ensureChain() could only ever throw.
export const CHAIN_PARAMS = {
  chainId: '0x' + BLOODLINE_CHAIN_ID.toString(16),
  chainName: _meta('chain-name') || 'Avalanche C-Chain',
  nativeCurrency: {
    name: _meta('chain-currency') || 'Avalanche',
    symbol: COIN,
    decimals: 18,
  },
  rpcUrls: [_meta('chain-rpc') || 'https://api.avax.network/ext/bc/C/rpc'],
  blockExplorerUrls: [_meta('chain-explorer') || 'https://snowtrace.io'],
};

// Ask the wallet to move to the collection's chain, adding it if it has never
// heard of it.
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
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_PARAMS.chainId }] });
  } catch (e) {
    // 4902: the wallet does not know this chain yet. Anything else is the
    // player declining, and declining is their right — it is not an error to
    // shout about, but nothing on-chain can be read until they relent.
    if (e && (e.code === 4902 || e.code === -32603)) {
      try {
        await p.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] });
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

// The other door out of the browser, and the slower one — this is the "looking
// for NFTs" the player waits through. Same treatment as req() in api.js: the
// PLEASE WAIT is raised here, once, rather than at the several call sites that
// read the contract.
// `to` defaults to the collection. It is passed explicitly only to read the
// payment token's own decimals/symbol/balanceOf/allowance, which belong to the
// token contract and not to this one.
async function ethCall(data, to) {
  beginWait();
  try { return await _ethCall(data, to); }
  finally { endWait(); }
}

async function _ethCall(data, to = BLOODLINE_ADDRESS) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!to) throw new Error('NO_CONTRACT');

  // Ask what chain we are on BEFORE trusting an answer from it. A wallet
  // sitting on Ethereum answers every one of these calls with '0x' — there is
  // no contract at this address there — and '0x' decodes to zero, which reads
  // as "mint closed" and "you hold nothing". Both are lies, and both are
  // indistinguishable from the truth unless the chain is checked here.
  const chain = await currentChainId();
  if (chain !== null && chain !== BLOODLINE_CHAIN_ID) throw new Error('WRONG_CHAIN');

  const out = await p.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
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
  // Held across the whole loop rather than around each poll: this is two
  // minutes of two-second sleeps, and a legend that came up for each request
  // and went down for each sleep would be a stutter, not a wait.
  beginWait();
  try {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await p.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        if (r) return r;
      } catch { /* keep waiting */ }
      await new Promise((res) => setTimeout(res, everyMs));
    }
    return null;
  } finally {
    endWait();
  }
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

// ── THE SECOND DOOR: $THROBBIN ──────────────────────────────────────────────
//
// The collection takes an ERC-20 as well as the chain's coin, at a flat price
// of its own. TWO PRICES, NOT A CONVERSION — there is no oracle and no rate
// anywhere in this file. Both are read off the contract; neither is derived
// from the other.
//
// Everything here fails SOFT. A collection deployed with the token door shut
// has no payToken(), and an older one has no such function at all — both must
// come back as "no token door", never as an error that stops a coin mint.

let _tokenInfo = undefined;     // undefined = unread, null = no token door

/**
 * The payment token, or null. Cached: all of it is immutable on the contract.
 * Shape: { address, price (BigInt, smallest units), symbol, decimals }.
 */
export async function fetchPayToken() {
  if (_tokenInfo !== undefined) return _tokenInfo;
  if (!BLOODLINE_ADDRESS) { _tokenInfo = null; return null; }
  try {
    const raw = await ethCall(SEL.payToken);
    const addr = '0x' + String(raw).replace(/^0x/, '').slice(-40).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr) || /^0x0{40}$/.test(addr)) { _tokenInfo = null; return null; }

    const price = hexToBig(await ethCall(SEL.tokenPricePerCultist));
    if (price <= 0n) { _tokenInfo = null; return null; }

    const decimals = Number(hexToBig(await ethCall(SEL.decimals, addr)));
    let symbol = 'TOKEN';
    try { symbol = decodeAbiString(await ethCall(SEL.symbol, addr)) || 'TOKEN'; } catch { /* keep it */ }

    _tokenInfo = {
      address: addr,
      price,
      symbol,
      decimals: Number.isFinite(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
    };
    return _tokenInfo;
  } catch {
    // An older collection has no payToken() at all and reverts. That is "no
    // token door", not an outage — and it must not be cached as such if the
    // cause was actually a dead RPC, so this one is left unset to retry.
    return null;
  }
}

/// A `string` return: [offset][length][bytes]. Some older tokens answer with a
/// bare bytes32 instead, which is read as NUL-padded ASCII rather than refused —
/// a missing ticker must never stop a payment.
function decodeAbiString(hex) {
  const b = String(hex || '').replace(/^0x/, '');
  if (!b) return null;
  if (b.length === 64) {
    const s = (b.match(/.{2}/g) || []).map((h) => String.fromCharCode(parseInt(h, 16)))
      .join('').replace(/\0+$/, '').trim();
    return /^[\x20-\x7e]{1,32}$/.test(s) ? s : null;
  }
  const off = Number(BigInt('0x' + b.slice(0, 64))) * 2;
  const len = Number(BigInt('0x' + b.slice(off, off + 64)));
  if (!len || len > 128) return null;
  return (b.slice(off + 64, off + 64 + len * 2).match(/.{2}/g) || [])
    .map((h) => String.fromCharCode(parseInt(h, 16))).join('').trim();
}

/// Smallest units -> a human string. BigInt throughout: a Number cannot hold
/// 30,000 tokens at 18 decimals without losing the low digits.
export function formatUnits(raw, dp) {
  const v = BigInt(raw || 0);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(dp);
  const whole = (a / scale).toString();
  const frac = (a % scale).toString().padStart(dp, '0').replace(/0+$/, '');
  // Thousands separators: 30000 THROBBIN is a number people read in groups.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/**
 * The chain's own coin, held by this wallet.
 *
 * Needed because PAYING IN THE TOKEN STILL COSTS GAS, and gas is never the
 * token. Somebody who bought THROBBIN and holds no ETH can afford the price and
 * still cannot send the transaction — and the wallet's own error for that is
 * unreadable. Checked here so the game can say what is actually wrong.
 */
export async function fetchCoinBalance(address) {
  const p = activeProvider();
  if (!p) return null;
  try {
    return hexToBig(await p.request({ method: 'eth_getBalance', params: [address, 'latest'] }));
  } catch {
    return null;                       // unknown is not zero — do not block on it
  }
}

export async function fetchTokenBalance(address) {
  const t = await fetchPayToken();
  if (!t) return null;
  return hexToBig(await ethCall(SEL.balanceOf + padAddr(address), t.address));
}

async function tokenAllowance(owner) {
  const t = await fetchPayToken();
  if (!t) return 0n;
  return hexToBig(await ethCall(SEL.allowance + padAddr(owner) + padAddr(BLOODLINE_ADDRESS), t.address));
}

/**
 * Mint paying in the token. TWO transactions, and there is no way around it:
 * an ERC-20 has to be told before it will let anyone move it, so an approval is
 * signed first and the mint second.
 *
 * The approval is for EXACTLY what this mint costs, not the unlimited approval
 * most dapps ask for. It is one extra signature per mint and it means a
 * Bloodline raised today leaves nothing standing that could move tokens
 * tomorrow.
 *
 * `onStep` is called with 'approve' | 'mint' so the screen can say which of the
 * two signatures a player is looking at — two unexplained wallet prompts in a
 * row is how a mint gets abandoned half-done.
 */
export async function mintBloodlineWithToken(address, cultists, onStep = () => {}) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!BLOODLINE_ADDRESS) throw new Error('NO_CONTRACT');
  const n = Math.floor(Number(cultists));
  if (!Number.isFinite(n) || n < 1 || n > 20) throw new Error('BAD_CULTISTS');

  const t = await fetchPayToken();
  if (!t) throw new Error('NO_TOKEN');
  if (!(await fetchMintOpen())) throw new Error('MINT_CLOSED');

  const cost = t.price * BigInt(n);
  const held = await fetchTokenBalance(address);
  if (held !== null && held < cost) throw new Error('NOT_ENOUGH_TOKEN');
  // Two transactions to sign, and both burn the chain's coin. A wallet with
  // none cannot mint however much of the token it holds.
  const gas = await fetchCoinBalance(address);
  if (gas !== null && gas === 0n) throw new Error('NO_GAS');

  // Skip the approval when a previous one already covers it — a mint abandoned
  // between the two signatures leaves an allowance behind, and asking for it
  // again would be a second signature for nothing.
  if ((await tokenAllowance(address)) < cost) {
    onStep('approve');
    const approveHash = await p.request({
      method: 'eth_sendTransaction',
      params: [{
        from: address,
        to: t.address,
        data: SEL.approve + padAddr(BLOODLINE_ADDRESS) + padUint(cost),
      }],
    });
    // The mint reverts if it is mined before the approval lands, so this waits
    // rather than firing both and hoping the ordering holds.
    await waitForTx(approveHash);
  }

  onStep('mint');
  return p.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: BLOODLINE_ADDRESS, data: SEL.mintWithToken + padUint(n) }],
  });
}

/**
 * Pay for a confession in the token: a plain ERC-20 transfer to the treasury.
 *
 * No approval here — a transfer moves the caller's own tokens and needs no
 * permission from anybody. Like the coin version below, both the destination
 * and the amount are the SERVER's, and the server checks the chain again before
 * it forgives anything.
 */
export async function payConfessionWithToken(address, token, to, raw) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(to || ''))) throw new Error('NO_TREASURY');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(token || ''))) throw new Error('NO_TOKEN');
  const amount = BigInt(raw || 0);
  if (amount <= 0n) throw new Error('BAD_AMOUNT');
  await ensureChain();

  const held = await fetchTokenBalance(address);
  if (held !== null && held < amount) throw new Error('NOT_ENOUGH_TOKEN');
  const gas = await fetchCoinBalance(address);
  if (gas !== null && gas === 0n) throw new Error('NO_GAS');

  beginWait();
  try {
    return await p.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to: token, data: SEL.transfer + padAddr(to) + padUint(amount) }],
    });
  } finally {
    endWait();
  }
}

// Pay for a confession: a plain coin transfer to the abbey's treasury.
//
// `to` and `wei` are BOTH the server's, quoted by /confession, and neither is
// computed here. The treasury the server quotes is read from the contract's own
// immutable `treasury()` — so the address a player's money goes to is the
// contract's answer, not a constant in this file that could drift or be edited.
// The amount is likewise the server's arithmetic; the client's job is to sign
// what it was quoted, and the server checks the chain again before it forgives
// anything.
// Prove the wallet is yours, without spending anything.
//
// Used for one thing: taking a Bloodline back onto a new device. The server
// will not move a bound row on the say-so of an address, because an address is
// public and the caller supplies it — a signature is the difference between
// "this is the owner's address" and "this is the owner".
//
// personal_sign rather than a typed-data scheme: it is the one signing method
// every injected wallet and every WalletConnect wallet supports, and the
// message is meant to be read by a human in a confirmation dialog.
export async function signOwnership(address, message) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  beginWait();
  try {
    return await p.request({
      // personal_sign takes the message FIRST and the address second, which is
      // the reverse of eth_sign and the usual way to get this wrong.
      method: 'personal_sign',
      params: [message, address],
    });
  } finally {
    endWait();
  }
}

export async function payConfession(address, to, wei) {
  const p = activeProvider();
  if (!p) throw new Error('NO_WALLET');
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(to || ''))) throw new Error('NO_TREASURY');
  const value = BigInt(wei || 0);
  if (value <= 0n) throw new Error('BAD_AMOUNT');
  await ensureChain();
  beginWait();
  try {
    return await p.request({
      method: 'eth_sendTransaction',
      params: [{ from: address, to, value: '0x' + value.toString(16) }],
    });
  } finally {
    endWait();
  }
}
