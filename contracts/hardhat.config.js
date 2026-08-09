require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Compile against a solc installed from npm instead of one downloaded from
// binaries.soliditylang.org. Only used when SOLCJS_PATH is set, so CI and a
// normal developer machine are untouched — it exists for sandboxes whose
// network policy allows the npm registry and nothing else, where hardhat
// otherwise cannot compile at all and the tests cannot be run before a deploy.
//
//   npm i --no-save solc@0.8.24
//   SOLCJS_PATH=$PWD/node_modules/solc/soljson.js npx hardhat test
if (process.env.SOLCJS_PATH) {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion === '0.8.24') {
      return {
        compilerPath: process.env.SOLCJS_PATH,
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: `solc-js-${args.solcVersion}`,
      };
    }
    return runSuper();
  });
}

// The deployer key. Kept only in contracts/.env, which is gitignored — it is
// never read from the game's server env, so a compromised web host cannot
// reach the key that owns the collection.
const KEY = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    // Avalanche C-Chain.
    avalanche: {
      url: process.env.AVAX_RPC || 'https://api.avax.network/ext/bc/C/rpc',
      chainId: 43114,
      accounts: KEY,
    },
    // Fuji testnet. Same contract, free AVAX from the faucet — deploy here
    // first and mint once against it before spending real money on a set of
    // constructor arguments that can never be changed.
    fuji: {
      url: process.env.FUJI_RPC || 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: KEY,
    },
  },
  etherscan: {
    apiKey: { avalanche: process.env.SNOWTRACE_KEY || '', avalancheFujiTestnet: process.env.SNOWTRACE_KEY || '' },
  },
};
