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
    // Robinhood Chain. Gas is ETH, not AVAX — an Arbitrum Orbit chain, so the
    // contract itself needs no change, only where it is sent.
    //
    // Every value is overridable from the environment. The public RPC is
    // documented as rate-limited, so a launch that starts failing mid-flight
    // can be pointed at a private endpoint without a code change.
    robinhood: {
      url: process.env.CHAIN_RPC || 'https://rpc.mainnet.chain.robinhood.com/',
      chainId: Number(process.env.CHAIN_ID || 4663),
      accounts: KEY,
    },
    // Robinhood's testnet. Free ETH from faucet.testnet.chain.robinhood.com.
    // Launch here first: the price and the payout addresses are immutable, and
    // this is the only place they can be got wrong for free.
    robinhoodTestnet: {
      url: process.env.CHAIN_TESTNET_RPC || 'https://rpc.testnet.chain.robinhood.com/',
      chainId: Number(process.env.CHAIN_TESTNET_ID || 46630),
      accounts: KEY,
    },
    // Avalanche C-Chain — where the first run was held. Kept so the old
    // collection can still be closed and swept when the game moves.
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
    // Blockscout takes any non-empty key, which is why these are not blank.
    apiKey: {
      robinhood: process.env.EXPLORER_KEY || 'blockscout',
      robinhoodTestnet: process.env.EXPLORER_KEY || 'blockscout',
      avalanche: process.env.SNOWTRACE_KEY || '',
      avalancheFujiTestnet: process.env.SNOWTRACE_KEY || '',
    },
    customChains: [
      {
        network: 'robinhood',
        chainId: Number(process.env.CHAIN_ID || 4663),
        urls: {
          apiURL: process.env.EXPLORER_API || 'https://robinhoodchain.blockscout.com/api',
          browserURL: process.env.EXPLORER_URL || 'https://robinhoodchain.blockscout.com',
        },
      },
      {
        network: 'robinhoodTestnet',
        chainId: Number(process.env.CHAIN_TESTNET_ID || 46630),
        urls: {
          apiURL: process.env.EXPLORER_TESTNET_API || 'https://explorer.testnet.chain.robinhood.com/api',
          browserURL: process.env.EXPLORER_TESTNET_URL || 'https://explorer.testnet.chain.robinhood.com',
        },
      },
    ],
  },
};
