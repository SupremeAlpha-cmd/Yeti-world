// Onchain referee for Yeti World (testnet). Active only when CHAIN_ENABLED=1.
//
// Env:
//   CHAIN_ENABLED    '1' to enable onchain lobbies
//   ARENA_ADDRESS    YetiArena contract
//   USDG_ADDRESS     MockUSDG (informational; entries are pulled by the arena)
//   RPC_URL          default https://rpc.testnet.chain.robinhood.com
//   REFEREE_KEY_PATH path to file holding the referee private key (hex)
//   ENTRY_FEE_USDG   entry fee in 6-decimal USDG units (default 5000000 = $5)

const fs = require('fs');
const { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const CHAIN_ENABLED = process.env.CHAIN_ENABLED === '1';
const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '46630', 10);
const CHAIN_NAME = CHAIN_ID === 4663 ? 'Robinhood Chain' : 'Robinhood Testnet';
const ARENA_ADDRESS = process.env.ARENA_ADDRESS;
const ENTRY_FEE_USDG = BigInt(process.env.ENTRY_FEE_USDG || '5000000');

const arenaAbi = parseAbi([
  'function createLobby(uint256 entryFee) returns (uint256)',
  'function hasEntered(uint256 lobbyId, address player) view returns (bool)',
  'function declareWinner(uint256 lobbyId, address winner)',
  'function lobbyInfo(uint256 lobbyId) view returns (uint256 entryFee, uint256 pot, uint256 playerCount, bool resolved)',
  'event LobbyCreated(uint256 indexed lobbyId, uint256 entryFee, address indexed creator)',
]);

let publicClient = null;
let walletClient = null;
let refereeAddress = null;

function init() {
  if (!CHAIN_ENABLED) return false;
  if (!ARENA_ADDRESS) throw new Error('ARENA_ADDRESS env required for chain mode');
  const keyPath = process.env.REFEREE_KEY_PATH;
  const raw = process.env.REFEREE_KEY
    ? process.env.REFEREE_KEY.trim()
    : keyPath
      ? fs.readFileSync(keyPath, 'utf8').trim()
      : null;
  if (!raw) throw new Error('REFEREE_KEY or REFEREE_KEY_PATH env required for chain mode');
  const key = raw.startsWith('0x') ? raw : '0x' + raw;
  const account = privateKeyToAccount(key);
  refereeAddress = account.address;
  const chain = {
    id: CHAIN_ID,
    name: CHAIN_NAME,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
  publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
  console.log(`[chain] referee ${refereeAddress} on ${CHAIN_NAME}, arena ${ARENA_ADDRESS}`);
  return true;
}

async function createLobby() {
  const hash = await walletClient.writeContract({
    address: ARENA_ADDRESS, abi: arenaAbi,
    functionName: 'createLobby', args: [ENTRY_FEE_USDG],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const events = parseEventLogs({ abi: arenaAbi, logs: receipt.logs, eventName: 'LobbyCreated' });
  if (!events.length) throw new Error('LobbyCreated event not found in receipt ' + hash);
  return { lobbyId: events[0].args.lobbyId.toString(), tx: hash };
}

async function hasEntered(lobbyId, wallet) {
  return publicClient.readContract({
    address: ARENA_ADDRESS, abi: arenaAbi,
    functionName: 'hasEntered', args: [BigInt(lobbyId), wallet],
  });
}

async function declareWinner(lobbyId, winnerWallet) {
  const hash = await walletClient.writeContract({
    address: ARENA_ADDRESS, abi: arenaAbi,
    functionName: 'declareWinner', args: [BigInt(lobbyId), winnerWallet],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

module.exports = {
  CHAIN_ENABLED,
  ARENA_ADDRESS,
  ENTRY_FEE_USDG,
  init,
  createLobby,
  hasEntered,
  declareWinner,
  get refereeAddress() { return refereeAddress; },
};
