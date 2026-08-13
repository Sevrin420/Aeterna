// One command, one deploy. Everything it needs comes from contracts/.env, and
// it refuses rather than guesses: a missing address or a zero price stops the
// run before a transaction is signed, because every one of these values is
// immutable once the contract is out.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

const ZERO = '0x0000000000000000000000000000000000000000';

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

  // ---- THE SECOND DOOR: paying in an ERC-20 --------------------------------
  //
  // PAY_TOKEN_PER_CULTIST is written the way a person says it — 30000, not
  // 30000000000000000000000 — and turned into smallest units here using the
  // token's OWN decimals(), read off the chain. Counting zeros by hand is how a
  // mint ends up costing a thousandth of what it should, and the number is
  // immutable, so there is no correcting it afterwards.
  //
  // Both blank leaves the token door shut, which is what a chain without the
  // token wants.
  const payTokenAddr = (process.env.PAY_TOKEN || '').trim();
  const payTokenHuman = (process.env.PAY_TOKEN_PER_CULTIST || '').trim();
  let payToken = ZERO;
  let tokenPrice = 0n;
  let tokenSymbol = null;
  let tokenDecimals = null;

  if (payTokenAddr || payTokenHuman) {
    if (!payTokenAddr || !payTokenHuman) {
      throw new Error('PAY_TOKEN and PAY_TOKEN_PER_CULTIST must be set together, or neither.');
    }
    if (!hre.ethers.isAddress(payTokenAddr)) throw new Error(`PAY_TOKEN is not an address: ${payTokenAddr}`);

    const erc20 = new hre.ethers.Contract(payTokenAddr, [
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
    ], hre.ethers.provider);

    // If this throws, the address is not an ERC-20 on this chain — which is a
    // far better thing to learn here than after the constructor has run.
    try {
      tokenDecimals = Number(await erc20.decimals());
      tokenSymbol = await erc20.symbol();
      await erc20.totalSupply();
    } catch (e) {
      throw new Error(
        `PAY_TOKEN ${payTokenAddr} does not answer decimals()/symbol()/totalSupply() on ${net}. `
        + 'Wrong address, or wrong chain. Nothing was deployed.',
      );
    }

    payToken = payTokenAddr;
    tokenPrice = hre.ethers.parseUnits(payTokenHuman, tokenDecimals);
    if (tokenPrice === 0n) throw new Error('PAY_TOKEN_PER_CULTIST works out to zero');
  }

  // The gas token differs by chain — ETH on Robinhood, AVAX on Avalanche — and
  // a price printed in the wrong unit is exactly the mistake this whole
  // print-then-pause block exists to catch.
  const GAS = { robinhood: 'ETH', robinhoodTestnet: 'ETH', avalanche: 'AVAX', fuji: 'AVAX' };
  const coin = GAS[net] || 'ETH';
  const chainId = hre.network.config.chainId;
  // A testnet is the one place these values can be got wrong for free, so it
  // is the only place the deploy does not stop to be read.
  const isTestnet = net === 'robinhoodTestnet' || net === 'fuji' || net === 'hardhat' || net === 'localhost';

  console.log(`\nnetwork          ${net}  (chain ${chainId})`);
  console.log(`deployer         ${deployer.address}`);
  console.log(`balance          ${hre.ethers.formatEther(bal)} ${coin}`);
  console.log(`price / cultist  ${hre.ethers.formatEther(price)} ${coin}`);
  console.log(`a full Bloodline ${hre.ethers.formatEther(price * 20n)} ${coin}  (20 cultists)`);
  const UNCAPPED = 2n ** 256n - 1n;
  console.log(`max supply       ${maxSupply === UNCAPPED ? 'uncapped' : maxSupply}`);
  console.log(`team    (20%)    ${team}`);
  console.log(`treasury (80%)   ${treasury}`);
  console.log(`base URI         ${baseURI}`);
  if (payToken === ZERO) {
    console.log(`token mint       OFF  (no PAY_TOKEN set — coin only)`);
  } else {
    console.log(`token            ${tokenSymbol}  ${payToken}  (${tokenDecimals} decimals)`);
    console.log(`price / cultist  ${payTokenHuman} ${tokenSymbol}`);
    console.log(`a full Bloodline ${Number(payTokenHuman) * 20} ${tokenSymbol}  (20 cultists)`);
    console.log(`  in raw units   ${tokenPrice}`);
  }

  if (!isTestnet) {
    console.log(`\n*** ${net.toUpperCase()} MAINNET. Every value above is immutable. ***`);
    console.log('Ctrl-C now if any of it is wrong. Continuing in 15s…\n');
    await new Promise((r) => setTimeout(r, 15000));
  }

  const F = await hre.ethers.getContractFactory('ThrobbinAbbeyBloodline');
  const c = await F.deploy(price, maxSupply, team, treasury, baseURI, payToken, tokenPrice);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`\ndeployed         ${addr}`);
  console.log('mint is CLOSED, and the OLD collection may still be open — close that first.');
  console.log('Open this one with:  npm run open:' + net);

  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${net}.json`), JSON.stringify({
    network: net, address: addr, deployer: deployer.address,
    pricePerCultistWei: price.toString(), maxSupply: maxSupply.toString(),
    team, treasury, baseURI, chainId,
    payToken, tokenPricePerCultist: tokenPrice.toString(), tokenSymbol, tokenDecimals,
    deployedAt: new Date().toISOString(),
  }, null, 2));

  console.log(`\nPut this in web/index.html:`);
  console.log(`  <meta name="bloodline-address" content="${addr}" />`);
  console.log(`  <meta name="bloodline-chain-id" content="${chainId}" />`);
  if (payToken !== ZERO) {
    console.log(`  <meta name="pay-token" content="${payToken}" />`);
    console.log(`  <meta name="pay-token-symbol" content="${tokenSymbol}" />`);
  }
  console.log(`\nVerify:  npx hardhat verify --network ${net} ${addr} ${price} ${maxSupply} ${team} ${treasury} "${baseURI}" ${payToken} ${tokenPrice}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
