// Sweep the contract's balance to the team and the treasury.
//
// Mint payments are NOT forwarded when a Bloodline is raised — mint() takes the
// AVAX and keeps it, so the money accumulates as the contract's own balance
// until somebody calls withdraw(). This is that call.
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

async function main() {
  const net = hre.network.name;
  const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
  if (!fs.existsSync(f)) throw new Error(`No deployment recorded for ${net}. Deploy first.`);
  const { address } = JSON.parse(fs.readFileSync(f, 'utf8'));

  const c = await hre.ethers.getContractAt('AeternaBloodline', address);
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
  console.log(`balance    ${avax(before)} AVAX`);

  if (before === 0n) {
    // Not an error worth failing the job over, and worth saying plainly: a
    // zero balance means either nothing has been minted or somebody has swept
    // it already. withdraw() would revert with "nothing to withdraw".
    console.log('\nNothing to sweep. Either no mints yet, or the balance has already been withdrawn.');
    return;
  }

  const toTeam = (before * BigInt(teamBps)) / 10000n;
  const toTreasury = before - toTeam;
  console.log(`\nsweeping   ${avax(toTeam)} AVAX to team, ${avax(toTreasury)} AVAX to treasury`);

  const teamBefore = await provider.getBalance(team);
  const treasuryBefore = await provider.getBalance(treasury);

  const tx = await c.withdraw();
  console.log(`tx         ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`sealed in block ${receipt.blockNumber}, status ${receipt.status}`);

  const [after, teamAfter, treasuryAfter] = await Promise.all([
    provider.getBalance(address), provider.getBalance(team), provider.getBalance(treasury),
  ]);
  console.log(`\ncontract   ${avax(before)} -> ${avax(after)} AVAX`);
  console.log(`team       +${avax(teamAfter - teamBefore)} AVAX`);
  console.log(`treasury   +${avax(treasuryAfter - treasuryBefore)} AVAX`);
}

main().catch((e) => { console.error(e); process.exit(1); });
