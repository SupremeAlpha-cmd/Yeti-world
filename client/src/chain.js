// Onchain layer (testnet). Active only when VITE_CHAIN_ENABLED=1.
import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi,
} from 'viem';

export const CHAIN_ENABLED = import.meta.env.VITE_CHAIN_ENABLED === '1';
export const ARENA_ADDRESS = import.meta.env.VITE_ARENA_ADDRESS;
export const USDG_ADDRESS = import.meta.env.VITE_USDG_ADDRESS;

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  testnet: true,
});

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
]);

let walletClient = null;
let publicClient = null;
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
  // switch to Robinhood testnet, adding it if missing
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xb65e' }], // 46630
    });
  } catch (e) {
    if (e && e.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xb65e',
          chainName: 'Robinhood Testnet',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
        }],
      });
    } else {
      throw e;
    }
  }
  walletClient = createWalletClient({
    account, chain: robinhoodTestnet, transport: custom(provider),
  });
  publicClient = createPublicClient({
    chain: robinhoodTestnet, transport: http(),
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
