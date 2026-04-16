# xo-connect

EIP-1193 wallet provider for [Bexo](https://bfrens.io) — connect your dApp to Bexo Wallet via WebView/iframe.

## Install

```bash
npm install xo-connect
```

## Quick Start (ethers.js v6)

```typescript
import { XOConnect, XOConnectProvider } from "xo-connect"
import { BrowserProvider, Contract, formatUnits } from "ethers"

// 1. Create EIP-1193 provider with RPCs
const xo = new XOConnectProvider({
  rpcs: { "0x89": "https://polygon-bor-rpc.publicnode.com" },
  defaultChainId: "0x89",
})

// 2. Connect to wallet
const { client } = await XOConnect.connect()
console.log(client.alias)       // "juanipodesta"
console.log(client.currencies)  // [{ id, address, chainId, symbol, image }, ...]

// 3. Read USDC balance via ethers
const ethersProvider = new BrowserProvider(xo)
const usdc = new Contract("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  ["function balanceOf(address) view returns (uint256)"],
  ethersProvider)
const balance = await usdc.balanceOf(client.currencies[0].address)
console.log("USDC:", formatUnits(balance, 6))

// 4. Transfer USDC
const signer = await ethersProvider.getSigner(0)
const usdcSigner = new Contract("0x3c499c...", [
  "function transfer(address,uint256) returns (bool)"
], signer)
await usdcSigner.transfer("0xRECIPIENT", 10_000_000n) // 10 USDC
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| `XOConnect` | Singleton for wallet connection and signing requests |
| `XOConnectProvider` | EIP-1193 provider — wrap with `ethers.BrowserProvider` |
| `currency.address` | **User's wallet address** (NOT the token contract!) |
| `currency.chainId` | Hex chain ID — **missing** for fiat currencies (ARS) |
| Fiat payments | Use `XOConnect.sendRequest()` directly, not EIP-1193 |

## Currency Types

```typescript
// Detect type from the currency object:
if (!currency.chainId)                    → fiat (ARS, etc.)
if (currency.id.includes('.native.'))     → native token (ETH, POL, BNB)
otherwise                                 → ERC20 token (USDC, USDT, DAI)
```

## Documentation

- **[Integration Guide](docs/integration.md)** — Complete reference with:
  - Currency ID format table
  - Known token contracts per chain (Polygon, Ethereum, Arbitrum, Base)
  - Balance reading patterns
  - Transaction signing for crypto and fiat
  - React/Next.js context + checkout example
  - Troubleshooting guide
  - **Copy-paste prompt for AI assistants**

- **[Examples](docs/examples/)** — Production-ready code:
  - [Next.js Checkout Component](docs/examples/next-checkout.tsx)

- **[API Reference](XO-CONNECT.md)** — Full method reference

## AI Integration

Give any AI assistant this URL and it can integrate xo-connect:

```
https://github.com/latamxo/xo-connect/blob/main/docs/integration.md
```

Or copy the prompt from the [Copy-Paste Prompt section](docs/integration.md#copy-paste-prompt-for-ai) in the integration guide.

## Reference Implementation

See [sami](https://github.com/fabian416/sami/tree/main/packages/frontend/src/providers) for a complete working integration using xo-connect + ethers.js + React.

## License

MIT
