// Onchain layer. Active only when VITE_CHAIN_ENABLED=1.
// Chain selected by VITE_MAINNET=1 (mainnet 4663) vs default testnet (46630).
import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi,
} from 'viem';

export const CHAIN_ENABLED = import.meta.env.VITE_CHAIN_ENABLED === '1';
export const ARENA_ADDRESS = import.meta.env.VITE_ARENA_ADDRESS;
export const USDG_ADDRESS = import.meta.env.VITE_USDG_ADDRESS;

const IS_MAINNET = import.meta.env.VITE_MAINNET === '1';

export const activeChain = IS_MAINNET
  ? defineChain({
      id: 4663,
      name: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
    })
  : defineChain({
      id: 46630,
      name: 'Robinhood Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
      testnet: true,
    });

const CHAIN_ID_HEX = '0x' + activeChain.id.toString(16);

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const arenaAbi = parseAbi([
  'function join(uint256 lobbyId)',
  'function hasEntered(uint256 lobbyId, address player) view returns (bool)',
  'function lobbyInfo(uint256 lobbyId) view returns (uint256 entryFee, uint256 pot, uint256 playerCount, bool resolved)',
  'function bonusPerWin() view returns (uint256)',
  'function nextLobbyId() view returns (uint256)',
  'event WinnerDeclared(uint256 indexed lobbyId, address indexed winner, uint256 prize, uint256 fee)',
]);

let walletClient = null;
let publicClient = null;

// ---------- WalletConnect (mobile wallets, no extension needed) ----------
import EthereumProvider from '@walletconnect/ethereum-provider';

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID;
let wcProvider = null;

export function walletConnectAvailable() {
  return !!WC_PROJECT_ID;
}

export async function connectWalletConnect() {
  if (!WC_PROJECT_ID) throw new Error('WalletConnect is not configured yet.');
  if (!wcProvider) {
    wcProvider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      chains: [activeChain.id],
      showQrModal: true,
      metadata: {
        name: 'Yeti World',
        description: 'The onchain survival arena. Last one standing takes the pot.',
        url: 'https://yeti-world.site',
        icons: ['https://yeti-world.site/logo.png'],
      },
    });
  }
  if (!wcProvider.connected) await wcProvider.connect();
  const [addr] = wcProvider.accounts;
  if (!addr) throw new Error('No account returned from wallet.');
  account = addr;
  walletClient = createWalletClient({
    account, chain: activeChain, transport: custom(wcProvider),
  });
  publicClient = createPublicClient({
    chain: activeChain, transport: http(),
  });
  return account;
}

export async function disconnectWallet() {
  if (wcProvider && wcProvider.connected) {
    await wcProvider.disconnect();
    wcProvider = null;
  }
  account = null;
  walletClient = null;
}
let account = null;

function getProvider() {
  if (typeof window === 'undefined') return null;
  return window.ethereum || null;
}

export function hasWallet() {
  return !!getProvider();
}

export async function connectWallet() {
  const provider = getProvider();
  if (!provider) throw new Error('No wallet found. Install a wallet with an injected provider.');
  const [addr] = await provider.request({ method: 'eth_requestAccounts' });
  account = addr;
  // switch to the active chain, adding it if the wallet doesn't know it
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (e) {
    if (e && e.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: activeChain.name,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [activeChain.rpcUrls.default.http[0]],
        }],
      });
    } else {
      throw e;
    }
  }
  walletClient = createWalletClient({
    account, chain: activeChain, transport: custom(provider),
  });
  publicClient = createPublicClient({
    chain: activeChain, transport: http(),
  });
  return account;
}

export function getAccount() { return account; }

export function fmtUsdg(raw) {
  // 6 decimals
  const n = Number(raw) / 1e6;
  return '$' + (Number.isInteger(n) ? n.toString() : n.toFixed(2));
}

export async function getAllowance() {
  return publicClient.readContract({
    address: USDG_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: [account, ARENA_ADDRESS],
  });
}

export async function approveUsdg(amount) {
  const hash = await walletClient.writeContract({
    address: USDG_ADDRESS, abi: erc20Abi, functionName: 'approve',
    args: [ARENA_ADDRESS, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function joinOnchain(lobbyId) {
  const hash = await walletClient.writeContract({
    address: ARENA_ADDRESS, abi: arenaAbi, functionName: 'join',
    args: [BigInt(lobbyId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function hasEnteredOnchain(lobbyId, addr) {
  return publicClient.readContract({
    address: ARENA_ADDRESS, abi: arenaAbi, functionName: 'hasEntered',
    args: [BigInt(lobbyId), addr],
  });
}

// read-only client for public data (no wallet needed)
let roClient = null;
function ro() {
  if (!roClient) roClient = createPublicClient({ chain: activeChain, transport: http() });
  return roClient;
}

export async function getArenaFacts() {
  if (!ARENA_ADDRESS) return null;
  const c = ro();
  try {
    const bonus = await c.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: 'bonusPerWin' }).catch(() => null);
    // entry fee lives per-lobby; use the most recent lobby as the reference
    let fee = null;
    const nextId = await c.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: 'nextLobbyId' }).catch(() => 0n);
    if (nextId > 0n) {
      const info = await c.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: 'lobbyInfo', args: [nextId - 1n] }).catch(() => null);
      if (info) fee = info[0];
    }
    return { fee, bonus };
  } catch { return null; }
}

export async function getWinners(limit = 20) {
  if (!ARENA_ADDRESS) return [];
  const c = ro();
  const logs = await c.getContractEvents({
    address: ARENA_ADDRESS, abi: arenaAbi, eventName: 'WinnerDeclared',
    fromBlock: 0n, toBlock: 'latest',
  }).catch(() => []);
  return logs.slice(-limit).reverse().map((l) => ({
    lobbyId: l.args.lobbyId.toString(),
    winner: l.args.winner,
    prize: l.args.prize,
    tx: l.transactionHash,
  }));
}
