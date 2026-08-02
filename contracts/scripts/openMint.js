// Opens minting on an already-deployed collection. Separate from the deploy on
// purpose: it means the contract can be out, verified and checked over before
// it is able to take a single coin.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const net = hre.network.name;
  const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
  if (!fs.existsSync(f)) throw new Error(`No deployment recorded for ${net}. Deploy first.`);
  const { address } = JSON.parse(fs.readFileSync(f, 'utf8'));
  const c = await hre.ethers.getContractAt('AeternaBloodline', address);
  const tx = await c.setMintOpen(true);
  console.log(`opening mint on ${address}…  ${tx.hash}`);
  await tx.wait();
  console.log('mint is OPEN.');
}

main().catch((e) => { console.error(e); process.exit(1); });
