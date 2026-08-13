// The tolls contract: everything in the abbey that costs money and is not the
// mint.
//
// Deployed beside the collection and never instead of it. It can also be
// deployed LATER, on its own, without touching a live collection — which is the
// point of it being a separate contract, so this script does not require a
// collection to exist.
//
// It takes the same team and treasury as the collection and the same token, all
// read off the collection when one is recorded, so the two cannot disagree
// about where money goes.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const ZERO = '0x0000000000000000000000000000000000000000';

async function main() {
  const net = hre.network.name;
  const recFile = path.join(__dirname, '..', 'deployments', `${net}.json`);
  const rec = fs.existsSync(recFile) ? JSON.parse(fs.readFileSync(recFile, 'utf8')) : {};

  // The collection is the authority on all three when there is one: it holds
  // them immutably, and a toll paying somewhere the mint does not is a bug
  // nobody would notice until the money was already split wrong.
  let team = process.env.TEAM_ADDRESS;
  let treasury = process.env.TREASURY_ADDRESS;
  let payToken = process.env.PAY_TOKEN || '';

  const collection = process.env.CONTRACT_ADDRESS || rec.address;
  if (collection && hre.ethers.isAddress(collection)) {
    const c = await hre.ethers.getContractAt('ThrobbinAbbeyBloodline', collection);
    team = await c.team();
    treasury = await c.treasury();
    try { payToken = await c.payToken(); } catch { payToken = ZERO; }
    console.log(`from collection  ${collection}`);
  }

  if (!hre.ethers.isAddress(team)) throw new Error(`team is not an address: ${team}`);
  if (!hre.ethers.isAddress(treasury)) throw new Error(`treasury is not an address: ${treasury}`);
  if (!payToken || !hre.ethers.isAddress(payToken)) payToken = ZERO;

  const [deployer] = await hre.ethers.getSigners();
  console.log(`network          ${net}  (chain ${hre.network.config.chainId})`);
  console.log(`deployer         ${deployer.address}`);
  console.log(`team    (20%)    ${team}`);
  console.log(`treasury (80%)   ${treasury}`);
  console.log(`token            ${payToken === ZERO ? 'none — tolls are coin-only' : payToken}`);

  const T = await hre.ethers.getContractFactory('ThrobbinAbbeyTolls');
  const t = await T.deploy(team, treasury, payToken);
  await t.waitForDeployment();
  const addr = await t.getAddress();

  console.log(`\ntolls deployed   ${addr}`);
  console.log('No tolls are named yet. Add one with scripts/setToll.js — that is a');
  console.log('transaction, not a deploy, and it is all a new priced thing needs.');

  rec.tolls = addr;
  fs.mkdirSync(path.dirname(recFile), { recursive: true });
  fs.writeFileSync(recFile, JSON.stringify(rec, null, 2));
  console.log(`recorded in deployments/${net}.json`);

  console.log(`\nPut this in web/index.html:`);
  console.log(`  <meta name="tolls-address" content="${addr}" />`);
  console.log(`\nVerify:  npx hardhat verify --network ${net} ${addr} ${team} ${treasury} ${payToken}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
