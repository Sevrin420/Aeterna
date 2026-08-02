require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

// The deployer key. Kept only in contracts/.env, which is gitignored — it is
// never read from the game's server env, so a compromised web host cannot
// reach the key that owns the collection.
const KEY = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
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
