// Open or close minting on an already-deployed collection.
//
// Separate from the deploy on purpose: it means the contract can be out,
// verified and checked over before it is able to take a single coin.
//
// It CLOSES as well as opens, because a redeploy has two halves. Standing up a
// new collection while the old one is still selling leaves two live mints for
// the same game, and every coin paid into the old one buys a Bloodline the
// abbey no longer reads. Shut the old one first, then open the new.
//
//   MINT_OPEN=true|false      which way to set it (required)
//   CONTRACT_ADDRESS=0x…      override the address (optional)
//
// Without CONTRACT_ADDRESS it uses deployments/<network>.json, which after a
// redeploy names the NEW collection — so closing the old one is the case that
// has to pass the address in, and it is the case where being explicit matters.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const net = hre.network.name;
  const raw = String(process.env.MINT_OPEN || '').toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    throw new Error("MINT_OPEN must be 'true' or 'false'");
  }
  const open = raw === 'true';

  let address = process.env.CONTRACT_ADDRESS;
  if (address) {
    if (!hre.ethers.isAddress(address)) throw new Error(`CONTRACT_ADDRESS is not an address: ${address}`);
    console.log(`address    ${address}   (from CONTRACT_ADDRESS)`);
  } else {
    const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
    if (!fs.existsSync(f)) throw new Error(`No deployment recorded for ${net}. Deploy first, or pass CONTRACT_ADDRESS.`);
    address = JSON.parse(fs.readFileSync(f, 'utf8')).address;
    console.log(`address    ${address}   (from deployments/${net}.json)`);
  }

  // setMintOpen(bool) has the same selector on the old collection as on this
  // one, so this script can shut a contract built from earlier source.
  const c = await hre.ethers.getContractAt('ThrobbinAbbeyBloodline', address);
  const was = await c.mintOpen();
  console.log(`mintOpen   ${was} -> ${open}`);
  if (was === open) {
    console.log('Already set that way. Nothing to do.');
    return;
  }

  const tx = await c.setMintOpen(open);
  console.log(`tx         ${tx.hash}`);
  await tx.wait();
  console.log(`mint is ${open ? 'OPEN' : 'CLOSED'}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
