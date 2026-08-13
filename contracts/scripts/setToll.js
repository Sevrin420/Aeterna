// Name a toll and price it. This is the whole of "adding a new thing that
// costs money" — one transaction, no deploy, nothing rebuilt.
//
//   TOLL=dice COIN=0.001 TOKEN=5000 npm run toll:robinhood
//
//   TOLL   the name. Hashed to a bytes32 id, so it can be any length and it
//          reads as itself everywhere it is printed. REQUIRED.
//   COIN   price in the chain's coin, written plainly: 0.001. 0 or blank shuts
//          the coin door for this toll.
//   TOKEN  price in whole tokens, written plainly: 5000. 0 or blank shuts the
//          token door for this toll.
//   OPEN   'false' to park it. Defaults to true.
//
// At least one price is needed to open one. Both blank closes it, which is how
// a toll is retired without losing its name or its history.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const ZERO = '0x0000000000000000000000000000000000000000';

async function main() {
  const net = hre.network.name;
  const name = (process.env.TOLL || '').trim();
  if (!name) throw new Error('TOLL is required — the name of the thing being priced.');

  const recFile = path.join(__dirname, '..', 'deployments', `${net}.json`);
  const rec = fs.existsSync(recFile) ? JSON.parse(fs.readFileSync(recFile, 'utf8')) : {};
  const address = process.env.TOLLS_ADDRESS || rec.tolls;
  if (!address || !hre.ethers.isAddress(address)) {
    throw new Error(`No tolls contract recorded for ${net}. Deploy it first, or pass TOLLS_ADDRESS.`);
  }

  const t = await hre.ethers.getContractAt('ThrobbinAbbeyTolls', address);
  const id = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(name));
  const open = String(process.env.OPEN ?? 'true').toLowerCase() !== 'false';

  const coin = hre.ethers.parseEther(String(process.env.COIN || '0'));

  // The token price is written in whole tokens and converted with the token's
  // OWN decimals, read off the chain — the same rule as the mint price, for the
  // same reason: nobody should be counting zeros.
  let token = 0n;
  const tokenHuman = String(process.env.TOKEN || '0');
  const payToken = await t.payToken();
  if (tokenHuman !== '0' && tokenHuman !== '') {
    if (payToken === ZERO) throw new Error('This tolls contract was deployed with no token.');
    const erc20 = new hre.ethers.Contract(payToken, [
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ], hre.ethers.provider);
    const dp = Number(await erc20.decimals());
    token = hre.ethers.parseUnits(tokenHuman, dp);
    console.log(`token            ${tokenHuman} ${await erc20.symbol()}  (${token} raw, ${dp} decimals)`);
  }

  console.log(`tolls            ${address}`);
  console.log(`toll             "${name}"`);
  console.log(`  id             ${id}`);
  console.log(`  coin           ${hre.ethers.formatEther(coin)}`);
  console.log(`  open           ${open}`);

  const was = await t.tolls(id);
  if (was.coin !== 0n || was.token !== 0n) {
    console.log(`\nalready priced   ${hre.ethers.formatEther(was.coin)} coin / ${was.token} raw token, open=${was.open}`);
    console.log('This REPLACES those. Anyone mid-signature at the old price gets a revert,');
    console.log('not a surprise charge.');
  }

  const tx = await t.setToll(id, coin, token, open);
  console.log(`\ntx               ${tx.hash}`);
  await tx.wait();
  console.log('set.');
  console.log(`\nThe server matches this toll by its id: ${id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
