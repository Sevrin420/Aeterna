// One command, one deploy. Everything it needs comes from contracts/.env, and
// it refuses rather than guesses: a missing address or a zero price stops the
// run before a transaction is signed, because every one of these values is
// immutable once the contract is out.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in contracts/.env`);
  return v;
}

async function main() {
  const net = hre.network.name;
  const price = BigInt(need('PRICE_PER_CULTIST_WEI'));
  const maxSupply = BigInt(need('MAX_SUPPLY'));
  const team = need('TEAM_ADDRESS');
  const treasury = need('TREASURY_ADDRESS');
  const baseURI = need('BASE_URI');

  if (price === 0n) throw new Error('PRICE_PER_CULTIST_WEI is zero');
  if (!hre.ethers.isAddress(team)) throw new Error('TEAM_ADDRESS is not an address');
  if (!hre.ethers.isAddress(treasury)) throw new Error('TREASURY_ADDRESS is not an address');
  if (!baseURI.endsWith('/')) throw new Error('BASE_URI must end with a slash');

  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`\nnetwork          ${net}`);
  console.log(`deployer         ${deployer.address}`);
  console.log(`balance          ${hre.ethers.formatEther(bal)} AVAX`);
  console.log(`price / cultist  ${hre.ethers.formatEther(price)} AVAX`);
  console.log(`a full Bloodline ${hre.ethers.formatEther(price * 20n)} AVAX  (20 cultists)`);
  const UNCAPPED = 2n ** 256n - 1n;
  console.log(`max supply       ${maxSupply === UNCAPPED ? 'uncapped' : maxSupply}`);
  console.log(`team    (20%)    ${team}`);
  console.log(`treasury (80%)   ${treasury}`);
  console.log(`base URI         ${baseURI}`);

  if (net === 'avalanche') {
    console.log('\n*** AVALANCHE MAINNET. Every value above is immutable. ***');
    console.log('Ctrl-C now if any of it is wrong. Continuing in 15s…\n');
    await new Promise((r) => setTimeout(r, 15000));
  }

  const F = await hre.ethers.getContractFactory('AeternaBloodline');
  const c = await F.deploy(price, maxSupply, team, treasury, baseURI);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`\ndeployed         ${addr}`);
  console.log('mint is CLOSED. Open it with:  npm run open:' + net);

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${net}.json`), JSON.stringify({
    network: net, address: addr, deployer: deployer.address,
    pricePerCultistWei: price.toString(), maxSupply: maxSupply.toString(),
    team, treasury, baseURI, deployedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`\nPut this in web/index.html:`);
  console.log(`  <meta name="bloodline-address" content="${addr}" />`);
  console.log(`  <meta name="bloodline-chain-id" content="${net === 'avalanche' ? 43114 : 43113}" />`);
  console.log(`\nVerify:  npx hardhat verify --network ${net} ${addr} ${price} ${maxSupply} ${team} ${treasury} "${baseURI}"`);
}

main().catch((e) => { console.error(e); process.exit(1); });
