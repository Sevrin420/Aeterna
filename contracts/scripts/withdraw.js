// Sweep the contract's balances to the team and the treasury — BOTH currencies.
//
// Mint payments are NOT forwarded when a Bloodline is raised — mint() takes the
// coin and keeps it, and mintWithToken() does the same with the ERC-20, so the
// money accumulates as the contract's own balance until somebody calls
// withdraw() / withdrawToken(). This is those calls.
//
// withdraw() is deliberately callable by anyone and the two destinations are
// immutable, so this script cannot send the money anywhere except the addresses
// fixed at deploy. It has no choice to get wrong: no recipient argument, no
// amount argument. It sweeps the whole balance, 20% to team and 80% to
// treasury, or it reverts.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const avax = (wei) => hre.ethers.formatEther(wei);
const ZERO = '0x0000000000000000000000000000000000000000';
// The gas token's ticker, for the printout only.
const GAS = { robinhood: 'ETH', robinhoodTestnet: 'ETH', avalanche: 'AVAX', fuji: 'AVAX' };

async function main() {
  const net = hre.network.name;
  const coin = GAS[net] || 'ETH';
  const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
  if (!fs.existsSync(f)) throw new Error(`No deployment recorded for ${net}. Deploy first.`);
  const { address: recorded } = JSON.parse(fs.readFileSync(f, 'utf8'));
  // CONTRACT_ADDRESS lets this sweep a collection the deployments file no
  // longer names — the one case that matters is the old collection after a
  // redeploy, whose balance is still real money sitting at an address nothing
  // else points at any more.
  const address = process.env.CONTRACT_ADDRESS || recorded;
  if (!hre.ethers.isAddress(address)) throw new Error(`Not an address: ${address}`);

  // The ABI for team/treasury/TEAM_BPS/withdraw is identical on the old
  // collection, so the current artifact reads either one.
  const c = await hre.ethers.getContractAt('ThrobbinAbbeyBloodline', address);
  const provider = hre.ethers.provider;

  // Read the destinations off the contract rather than from any file. They are
  // immutable, so this is what the money is going to go to whatever anyone
  // believes — and printing them is the point: it is the check that the
  // addresses deployed are the addresses expected.
  const [team, treasury, teamBps] = await Promise.all([c.team(), c.treasury(), c.TEAM_BPS()]);
  const before = await provider.getBalance(address);

  console.log(`contract   ${address}`);
  console.log(`team       ${team}   (${Number(teamBps) / 100}%)`);
  console.log(`treasury   ${treasury}   (${(10000 - Number(teamBps)) / 100}%)`);
  console.log(`balance    ${avax(before)} ${coin}`);

  if (before === 0n) {
    // Not an error worth failing the job over, and worth saying plainly: a
    // zero balance means either nothing has been minted or somebody has swept
    // it already. withdraw() would revert with "nothing to withdraw".
    console.log('\nNothing in coin to sweep. Either no coin mints yet, or it has already been withdrawn.');
    await sweepToken(c, address, team, treasury, teamBps);
    return;
  }

  const toTeam = (before * BigInt(teamBps)) / 10000n;
  const toTreasury = before - toTeam;
  console.log(`\nsweeping   ${avax(toTeam)} ${coin} to team, ${avax(toTreasury)} ${coin} to treasury`);

  const teamBefore = await provider.getBalance(team);
  const treasuryBefore = await provider.getBalance(treasury);

  const tx = await c.withdraw();
  console.log(`tx         ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`sealed in block ${receipt.blockNumber}, status ${receipt.status}`);

  const [after, teamAfter, treasuryAfter] = await Promise.all([
    provider.getBalance(address), provider.getBalance(team), provider.getBalance(treasury),
  ]);
  console.log(`\ncontract   ${avax(before)} -> ${avax(after)} ${coin}`);
  console.log(`team       +${avax(teamAfter - teamBefore)} ${coin}`);
  console.log(`treasury   +${avax(treasuryAfter - treasuryBefore)} ${coin}`);

  await sweepToken(c, address, team, treasury, teamBps);
}

// The ERC-20 half. Separate on the contract and separate here, because either
// balance can be zero while the other is not — and an older collection has no
// payToken() at all, which is a "nothing to do", not a failure.
async function sweepToken(c, address, team, treasury, teamBps) {
  let tokenAddr;
  try {
    tokenAddr = await c.payToken();
  } catch {
    console.log('\nThis collection predates token minting — no token to sweep.');
    return;
  }
  if (!tokenAddr || tokenAddr === ZERO) {
    console.log('\nToken minting is off on this collection — no token to sweep.');
    return;
  }

  const erc20 = new hre.ethers.Contract(tokenAddr, [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ], hre.ethers.provider);
  const [dp, sym, bal] = await Promise.all([erc20.decimals(), erc20.symbol(), erc20.balanceOf(address)]);
  const fmt = (v) => hre.ethers.formatUnits(v, dp);

  console.log(`\ntoken      ${sym}  ${tokenAddr}`);
  console.log(`balance    ${fmt(bal)} ${sym}`);
  if (bal === 0n) {
    console.log('Nothing in token to sweep.');
    return;
  }

  const toTeam = (bal * BigInt(teamBps)) / 10000n;
  console.log(`\nsweeping   ${fmt(toTeam)} ${sym} to team, ${fmt(bal - toTeam)} ${sym} to treasury`);
  const tx = await c.withdrawToken();
  console.log(`tx         ${tx.hash}`);
  const r = await tx.wait();
  console.log(`sealed in block ${r.blockNumber}, status ${r.status}`);

  const [after, t, tr] = await Promise.all([
    erc20.balanceOf(address), erc20.balanceOf(team), erc20.balanceOf(treasury),
  ]);
  console.log(`\ncontract   ${fmt(bal)} -> ${fmt(after)} ${sym}`);
  console.log(`team       ${fmt(t)} ${sym} held`);
  console.log(`treasury   ${fmt(tr)} ${sym} held`);
}

main().catch((e) => { console.error(e); process.exit(1); });
