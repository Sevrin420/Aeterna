// The founder's single free Bloodline.
//
// Run once, from the deployer wallet, before the public mint is opened — so
// token #1 is the founder's and the whole flow can be checked end to end while
// nobody else can mint.
//
// It prints founderTokenId, which is the number the payout excludes. That
// number wants recording somewhere it will be found again: FOUNDER_TOKEN_ID in
// the server's environment, and the contract itself carries it for anyone who
// wants to check.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const net = hre.network.name;
  const cultists = Number(process.env.FOUNDER_CULTISTS || 1);
  if (!Number.isInteger(cultists) || cultists < 1 || cultists > 20) {
    throw new Error(`FOUNDER_CULTISTS must be 1-20, got ${process.env.FOUNDER_CULTISTS}`);
  }

  let address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
    if (!fs.existsSync(f)) throw new Error(`No deployment recorded for ${net}, and no CONTRACT_ADDRESS.`);
    address = JSON.parse(fs.readFileSync(f, 'utf8')).address;
  }
  if (!hre.ethers.isAddress(address)) throw new Error(`Not an address: ${address}`);

  const c = await hre.ethers.getContractAt('ThrobbinAbbeyBloodline', address);
  const [signer] = await hre.ethers.getSigners();

  console.log(`contract   ${address}`);
  console.log(`owner      ${await c.owner()}`);
  console.log(`signer     ${signer.address}`);
  console.log(`cultists   ${cultists}`);

  // Said plainly rather than left to a revert: onlyOwner would fail with a
  // custom error that reads like a bug if the wrong key is loaded.
  if ((await c.owner()).toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error('The signer is not the contract owner. Wrong DEPLOYER_KEY for this collection.');
  }
  if (await c.founderMinted()) {
    console.log(`\nAlready spent — founderTokenId is ${await c.founderTokenId()}. Nothing to do.`);
    return;
  }

  const tx = await c.founderMint(cultists);
  console.log(`tx         ${tx.hash}`);
  await tx.wait();

  const tokenId = await c.founderTokenId();
  console.log(`\nfounderTokenId ${tokenId}`);
  console.log('Set FOUNDER_TOKEN_ID to that on the server, or the founder line is not excluded from the payout.');

  // Written beside the deployment record so the number survives the run.
  const f = path.join(__dirname, '..', 'deployments', `${net}.json`);
  if (fs.existsSync(f)) {
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    rec.founderTokenId = Number(tokenId);
    rec.founderCultists = cultists;
    fs.writeFileSync(f, JSON.stringify(rec, null, 2));
    console.log(`recorded in deployments/${net}.json`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
