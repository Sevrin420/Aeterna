// Everything the launch will need FROM THE CHAIN, read and never written.
//
// Not one transaction is signed here. Every failure it reports is one that
// would otherwise have surfaced mid-launch — some of them after a contract was
// already deployed and the clock had started, which is the expensive half.
//
// Two modes:
//   default      the chain being launched TO: gas, addresses, the token
//   OLD_ONLY=1   the chain the PREVIOUS collection is on: reachable, ownable,
//                and how much is sitting in it waiting to be swept
const hre = require('hardhat');

const ZERO = '0x0000000000000000000000000000000000000000';
const ok = (s) => console.log(`ok        ${s}`);
const note = (s) => console.log(`note      ${s}`);
const bad = [];
const fail = (s) => { bad.push(s); console.log(`MISSING   ${s}`); };

async function main() {
  const net = hre.network.name;
  const chainId = hre.network.config.chainId;
  const [signer] = await hre.ethers.getSigners();
  const GAS = { robinhood: 'ETH', robinhoodTestnet: 'ETH', avalanche: 'AVAX', fuji: 'AVAX' };
  const coin = GAS[net] || 'ETH';

  console.log(`network   ${net}  (chain ${chainId} in the config)`);

  // The RPC answering at all, and answering as the chain we think it is. A
  // mismatch here is how a deploy lands somewhere nobody meant it to.
  let live;
  try {
    live = Number((await hre.ethers.provider.getNetwork()).chainId);
  } catch (e) {
    fail(`the RPC for ${net} did not answer: ${e.shortMessage || e.message}`);
    return done();
  }
  // hardhat's own in-process networks declare no chainId, so there is nothing
  // to disagree with. Every real network here declares one, and a mismatch on
  // those is how a deploy lands on a chain nobody meant.
  if (chainId === undefined) ok(`the RPC answers, chain ${live} (this network declares no chainId)`);
  else if (live !== chainId) fail(`the RPC says chain ${live}, the config says ${chainId}`);
  else ok(`the RPC answers, and agrees it is chain ${live}`);

  if (process.env.OLD_ONLY === '1') return oldCollection(coin, done);

  // ---- the deployer ---------------------------------------------------------
  const bal = await hre.ethers.provider.getBalance(signer.address);
  console.log(`deployer  ${signer.address}`);

  // IS THE KEY IN THE SECRET THE KEY YOU THINK IT IS?
  //
  // The address is not configured anywhere — it is derived from DEPLOYER_KEY,
  // so the runner will happily deploy with whatever key it was given. EXPECT_
  // DEPLOYER is the second source: state the wallet you MEAN, and a secret
  // holding a different key fails here instead of producing a collection owned
  // by a wallet you do not control and an old mint that cannot be closed.
  //
  // The address is public. The key is not, and never appears here.
  const expect = (process.env.EXPECT_DEPLOYER || '').trim();
  if (expect) {
    if (!hre.ethers.isAddress(expect)) {
      fail(`EXPECT_DEPLOYER is not an address: ${expect}`);
    } else if (expect.toLowerCase() !== signer.address.toLowerCase()) {
      fail(`DEPLOYER_KEY is the key for ${signer.address}, but you expected ${expect} — the wrong key is in the secret`);
    } else {
      ok('DEPLOYER_KEY is the key for the wallet you expected');
    }
  } else {
    note('no EXPECT_DEPLOYER given — nothing is checking that the secret holds the key you think it does');
  }
  console.log(`balance   ${hre.ethers.formatEther(bal)} ${coin}`);
  // Not a precise gas estimate — a floor. Two deploys, a founder mint and two
  // setMintOpen calls all have to fit, and being told "you have none" after the
  // first one succeeds is the failure this is here to prevent.
  if (bal === 0n) fail(`the deployer holds no ${coin} on ${net} — it cannot deploy anything`);
  else if (bal < 10n ** 15n) fail(`the deployer holds under 0.001 ${coin} — very likely not enough for two deploys`);
  else ok('the deployer has gas');

  // ---- where the money will go ---------------------------------------------
  const team = process.env.TEAM_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  for (const [label, addr] of [['TEAM_ADDRESS', team], ['TREASURY_ADDRESS', treasury]]) {
    if (!addr || !hre.ethers.isAddress(addr)) { fail(`${label} is not an address: ${addr}`); continue; }
    if (addr.toLowerCase() === ZERO) { fail(`${label} is the zero address`); continue; }
    // Immutable at deploy, so this is the last moment either can be corrected.
    ok(`${label} ${addr}`);
  }

  // THREE ROLES, AND WHETHER THEY ARE THREE WALLETS.
  //
  // Not failures — one wallet can legitimately be two of these. But all three
  // are fixed forever at deploy and none of them can be changed afterwards, so
  // the last honest moment to notice they are the same is now, printed rather
  // than assumed.
  //
  // The one that actually matters: the DEPLOYER key signs, and it is the key
  // most likely to be on a laptop. Money never lands in it — withdraw() pays
  // only team and treasury — unless the treasury IS it, at which point every
  // coin the run takes sits behind the key that has been used the most.
  const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
  const dep = signer.address;
  if (same(team, treasury)) {
    note('TEAM_ADDRESS and TREASURY_ADDRESS are the SAME wallet — the 20/80 split still happens on chain, but both halves land in one place.');
  } else if (team && treasury) {
    ok('team and treasury are different wallets');
  }
  if (same(treasury, dep)) {
    note('THE TREASURY IS THE DEPLOYER WALLET. Everything the run takes will sit behind the key that signs the deploys. A separate treasury is worth the five minutes.');
  } else if (treasury) {
    ok('the treasury is not the deployer — signing keys and held funds are apart');
  }
  if (same(team, dep)) note('TEAM_ADDRESS is the deployer wallet too.');
  // Said whichever way it goes, because it is a thing to have decided rather
  // than discovered: the founder's free Bloodline is minted BY the owner, TO
  // the owner, and it is soulbound, so it can never be moved to another wallet.
  note(`the founder's free line will be raised in the deployer wallet ${dep}, and is soulbound there forever`);

  // ---- what a line will cost ------------------------------------------------
  const price = BigInt(process.env.PRICE_PER_CULTIST_WEI || 0);
  if (price === 0n) fail('PRICE_PER_CULTIST_WEI is zero');
  else {
    console.log(`price     ${hre.ethers.formatEther(price)} ${coin} per Cultist`);
    console.log(`          ${hre.ethers.formatEther(price * 20n)} ${coin} for a 20-Cultist line   <- IMMUTABLE`);
  }

  // ---- the token ------------------------------------------------------------
  const tokenAddr = (process.env.PAY_TOKEN || '').trim();
  const human = (process.env.PAY_TOKEN_PER_CULTIST || '').trim();
  if (!tokenAddr && !human) {
    note('no token — the mint will be coin-only. Correct for a testnet dry run.');
  } else if (!tokenAddr || !human) {
    fail('PAY_TOKEN and PAY_TOKEN_PER_CULTIST must be set together, or neither');
  } else if (!hre.ethers.isAddress(tokenAddr)) {
    fail(`PAY_TOKEN is not an address: ${tokenAddr}`);
  } else {
    // THE CHECK THAT MATTERS. An address that is not an ERC-20 on THIS chain
    // gets past every other test and then makes a collection nobody can mint
    // from with the token — permanently, because the address is immutable.
    const erc20 = new hre.ethers.Contract(tokenAddr, [
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
    ], hre.ethers.provider);
    try {
      const code = await hre.ethers.provider.getCode(tokenAddr);
      if (!code || code === '0x') throw new Error('no contract at that address on this chain');
      const dp = Number(await erc20.decimals());
      const sym = await erc20.symbol();
      const supply = await erc20.totalSupply();
      const raw = hre.ethers.parseUnits(human, dp);
      ok(`the token answers: ${sym}, ${dp} decimals`);
      console.log(`          supply ${hre.ethers.formatUnits(supply, dp)} ${sym}`);
      console.log(`price     ${human} ${sym} per Cultist  =  ${raw} raw`);
      console.log(`          ${Number(human) * 20} ${sym} for a 20-Cultist line   <- IMMUTABLE`);
      if (raw === 0n) fail('PAY_TOKEN_PER_CULTIST works out to zero');
    } catch (e) {
      fail(`PAY_TOKEN ${tokenAddr} is not a working ERC-20 on ${net}: ${e.shortMessage || e.message}`);
    }
  }

  return done();
}

// The collection being shut down, on ITS chain — which is not the one being
// launched to. Read-only: this says what the sweep will find, it does not sweep.
async function oldCollection(coin, done) {
  const addr = (process.env.OLD_CONTRACT || '').trim();
  const [signer] = await hre.ethers.getSigners();
  if (!hre.ethers.isAddress(addr)) { fail(`OLD_CONTRACT is not an address: ${addr}`); return done(); }

  const code = await hre.ethers.provider.getCode(addr);
  if (!code || code === '0x') {
    fail(`no contract at ${addr} on ${hre.network.name} — wrong address, or wrong chain for it`);
    return done();
  }
  ok(`the old collection is there: ${addr}`);

  const c = await hre.ethers.getContractAt('ThrobbinAbbeyBloodline', addr);
  try {
    const owner = await c.owner();
    console.log(`owner     ${owner}`);
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      // Only the owner may close a mint. Sweeping is open to anyone, so this
      // stops the close and not the sweep — worth separating.
      fail(`the deployer key does not own the old collection — the mint cannot be closed (sweeping still can)`);
    } else ok('the deployer owns it, so its mint can be closed');
  } catch (e) {
    fail(`could not read owner() on the old collection: ${e.shortMessage || e.message}`);
  }

  try {
    console.log(`mintOpen  ${await c.mintOpen()}`);
  } catch { note('could not read mintOpen() — an older collection may not have it'); }

  const bal = await hre.ethers.provider.getBalance(addr);
  console.log(`balance   ${hre.ethers.formatEther(bal)} ${coin}   <- this is what the sweep will move`);
  if (bal === 0n) note('nothing in coin to sweep — already swept, or nothing was minted');

  try {
    const tokenAddr = await c.payToken();
    if (tokenAddr && tokenAddr !== ZERO) {
      const erc20 = new hre.ethers.Contract(tokenAddr, [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
      ], hre.ethers.provider);
      const [dp, sym, tb] = await Promise.all([erc20.decimals(), erc20.symbol(), erc20.balanceOf(addr)]);
      console.log(`token     ${hre.ethers.formatUnits(tb, dp)} ${sym} to sweep`);
    }
  } catch {
    note('the old collection predates token minting — nothing in token to sweep');
  }

  return done();
}

function done() {
  if (bad.length) {
    console.log(`\n${bad.length} problem${bad.length === 1 ? '' : 's'}:`);
    for (const b of bad) console.log(`  - ${b}`);
    process.exit(1);
  }
  console.log('\nAll clear on this chain. Nothing was signed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
