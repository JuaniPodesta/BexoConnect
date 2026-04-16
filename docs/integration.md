# xo-connect Integration Guide

> Complete guide for integrating Bexo Wallet into any web application.
> This document is designed to be readable by both humans and AI assistants.

## Table of Contents

1. [Overview](#overview)
2. [Currency Data Model](#currency-data-model)
3. [Detecting Currency Types](#detecting-currency-types)
4. [Known Token Contracts](#known-token-contracts)
5. [Reading Balances](#reading-balances)
6. [Sending Transactions](#sending-transactions)
7. [Fiat Payments (ARS)](#fiat-payments-ars)
8. [React/Next.js Integration](#reactnextjs-integration)
9. [Troubleshooting](#troubleshooting)
10. [Copy-Paste Prompt for AI](#copy-paste-prompt-for-ai)

---

## Overview

xo-connect is a wallet SDK for [Bexo](https://bfrens.io) — an Argentine crypto wallet. It provides:

- **`XOConnect`** — singleton to connect to the wallet and send signing requests
- **`XOConnectProvider`** — standard EIP-1193 provider, compatible with ethers.js/viem/wagmi

The provider runs inside Bexo's mobile WebView. It communicates with the native wallet via `window.postMessage`.

### Architecture

```
Your Web App (inside Bexo WebView)
  └─ XOConnectProvider (EIP-1193)
       ├─ ethers.BrowserProvider (for contract calls)
       │    ├─ .getBalance()       → native token balance
       │    ├─ contract.balanceOf() → ERC20 balance
       │    └─ contract.transfer()  → ERC20 transfer
       └─ XOConnect.sendRequest()  → signing & fiat payments
            └─ window.postMessage ↔ Bexo native wallet
```

---

## Currency Data Model

When a user connects, `client.currencies` contains ALL their wallet assets:

```typescript
interface Currency {
  id: string        // "polygon.mainnet.erc20.usdc"
  address: string   // User's wallet address (NOT token contract!)
  chainId?: string  // "0x89" — undefined for fiat (ARS)
  symbol?: string   // "USDC"
  image?: string    // Icon URL
}
```

### Currency ID Format

Pattern: `{chain}.{network}.{type}.{symbol}`

| Example ID | Type | ChainId | Description |
|------------|------|---------|-------------|
| `polygon.mainnet.native.pol` | Native | `0x89` | POL (ex-MATIC) on Polygon |
| `polygon.mainnet.erc20.usdc` | ERC20 | `0x89` | USDC on Polygon |
| `ethereum.mainnet.native.eth` | Native | `0x1` | ETH on Ethereum |
| `ethereum.mainnet.erc20.usdc` | ERC20 | `0x1` | USDC on Ethereum |
| `bsc.mainnet.native.bnb` | Native | `0x38` | BNB on BSC |
| `base.mainnet.native.eth` | Native | `0x2105` | ETH on Base |
| `base.mainnet.erc20.usdc` | ERC20 | `0x2105` | USDC on Base |
| `rootstock.mainnet.native.rbtc` | Native | `0x1e` | RBTC on Rootstock |
| `bitcoin.mainnet.native.btc` | Non-EVM | — | Bitcoin (no EVM support) |
| `argentina.fiat.ars` | Fiat | (none) | Argentine Peso |

### Critical: `address` is NOT the token contract

The `address` field on each currency is the **user's wallet address** on that chain. It is the same address across all EVM currencies (same private key).

To interact with ERC20 tokens, you must maintain your own mapping of `chainId + symbol → contract address` (see [Known Token Contracts](#known-token-contracts)).

---

## Detecting Currency Types

```typescript
function getCurrencyType(currency: Currency): "fiat" | "native" | "erc20" {
  if (!currency.chainId) return "fiat"
  if (currency.id.toLowerCase().includes(".native.")) return "native"
  return "erc20"
}
```

| Type | Has chainId | ID contains `.native.` | Balance method |
|------|-------------|----------------------|----------------|
| Fiat | No | N/A | Not on-chain (wallet-managed) |
| Native | Yes | Yes | `ethersProvider.getBalance(address)` |
| ERC20 | Yes | No | `contract.balanceOf(address)` |

---

## Known Token Contracts

These are the most common token contracts on chains supported by Bexo.
USDC has multiple variants on some chains (Circle native + bridged USDC.e).

### Polygon (chainId: `0x89`)

| Token | Contract Address | Decimals | Note |
|-------|-----------------|----------|------|
| USDC (Circle) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 | Native Circle USDC |
| USDC.e (Bridged) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | 6 | Legacy bridged — still widely held |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 | |
| DAI | `0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063` | 18 | |

### Ethereum (chainId: `0x1`)

| Token | Contract Address | Decimals |
|-------|-----------------|----------|
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| DAI | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | 18 |

### Arbitrum One (chainId: `0xa4b1`)

| Token | Contract Address | Decimals | Note |
|-------|-----------------|----------|------|
| USDC (Circle) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | |
| USDC.e (Bridged) | `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` | 6 | |
| USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | |

### Base (chainId: `0x2105`)

| Token | Contract Address | Decimals |
|-------|-----------------|----------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |

### Optimism (chainId: `0xa`)

| Token | Contract Address | Decimals |
|-------|-----------------|----------|
| USDC (Circle) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| USDC.e (Bridged) | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | 6 |
| USDT | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 |

### BSC (chainId: `0x38`)

| Token | Contract Address | Decimals |
|-------|-----------------|----------|
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |

> **Tip:** When USDC has two variants, probe both `balanceOf` and use the one with a non-zero balance.

### Recommended Public RPCs

```typescript
const RPC_MAP = {
  "0x1":    "https://ethereum-rpc.publicnode.com",
  "0x89":   "https://polygon-bor-rpc.publicnode.com",
  "0xa4b1": "https://arbitrum-one-rpc.publicnode.com",
  "0xa":    "https://optimism-rpc.publicnode.com",
  "0x38":   "https://bsc-rpc.publicnode.com",
  "0x2105": "https://base-rpc.publicnode.com",
  "0x1e":   "https://public-node.rsk.co",
}
```

---

## Reading Balances

### Recommended: ethers.js BrowserProvider pattern

This is the same pattern used in the [sami reference implementation](https://github.com/fabian416/sami/tree/main/packages/frontend/src/providers).

```typescript
import { XOConnect, XOConnectProvider } from "xo-connect"
import { BrowserProvider, Contract, formatUnits } from "ethers"

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
]

// Initialize provider with RPCs for all chains you want to support
const xo = new XOConnectProvider({
  rpcs: {
    "0x89": "https://polygon-bor-rpc.publicnode.com",
    "0x1":  "https://ethereum-rpc.publicnode.com",
  },
  defaultChainId: "0x89",
})

// Connect and get currencies
const { client } = await XOConnect.connect()

// Read balance for each currency
for (const currency of client.currencies) {
  if (!currency.chainId) {
    console.log(`${currency.id}: fiat — skip RPC`)
    continue
  }

  // Switch to the currency's chain
  await xo.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: currency.chainId }],
  })

  const ethersProvider = new BrowserProvider(xo)
  const isNative = currency.id.includes(".native.")

  if (isNative) {
    const balance = await ethersProvider.getBalance(currency.address)
    console.log(`${currency.id}: ${formatUnits(balance, 18)}`)
  } else {
    // Look up token contract(s) by chainId + symbol
    const label = getCurrencyLabel(currency.id)
    const contracts = TOKEN_CONTRACTS[currency.chainId]?.[label] ?? []

    for (const addr of contracts) {
      const contract = new Contract(addr, ERC20_ABI, ethersProvider)
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(currency.address),
        contract.decimals().catch(() => 6),
      ])
      if (balance > 0n) {
        console.log(`${currency.id} @ ${addr}: ${formatUnits(balance, decimals)}`)
        break // found the right variant
      }
    }
  }
}
```

---

## Sending Transactions

### ERC20 transfer (e.g., pay with USDC)

```typescript
const ethersProvider = new BrowserProvider(xo)
const signer = await ethersProvider.getSigner(0)

// Switch to Polygon
await xo.request({
  method: "wallet_switchEthereumChain",
  params: [{ chainId: "0x89" }],
})

const usdc = new Contract(
  "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC on Polygon
  ERC20_ABI,
  signer
)

// Transfer 10 USDC (6 decimals → 10_000_000)
const tx = await usdc.transfer("0xRECIPIENT_ADDRESS", 10_000_000n)
const receipt = await tx.wait()
console.log("tx hash:", receipt.hash)
```

### Native token transfer (e.g., pay with ETH/POL)

```typescript
const signer = await ethersProvider.getSigner(0)
const tx = await signer.sendTransaction({
  to: "0xRECIPIENT_ADDRESS",
  value: parseEther("0.01"),
})
await tx.wait()
```

---

## Fiat Payments (ARS)

Fiat currencies have no `chainId` and cannot be read or transferred on-chain. Use `XOConnect.sendRequest` directly — the Bexo wallet handles the internal transfer.

```typescript
import { XOConnect } from "xo-connect"

// Find the ARS currency in the user's wallet
const arsCurrency = client.currencies.find(c => !c.chainId && c.id.includes("ars"))

if (arsCurrency) {
  XOConnect.sendRequest({
    method: "transactionSign" as any,
    currency: arsCurrency.id,
    data: {
      to: "recipient_alias_or_address",
      value: "22950",  // ARS amount as string
      description: "Compra en Altibajos — 3x Malbec",
    },
    onSuccess: (res) => {
      console.log("Fiat payment completed:", res)
    },
    onCancel: () => {
      console.log("User cancelled payment")
    },
  })
}
```

---

## React/Next.js Integration

### Context Provider (bexo-context.tsx)

```tsx
"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import type { Currency } from "xo-connect"

const RPC_MAP: Record<string, string> = {
  "0x1":    "https://ethereum-rpc.publicnode.com",
  "0x89":   "https://polygon-bor-rpc.publicnode.com",
  "0xa4b1": "https://arbitrum-one-rpc.publicnode.com",
  "0x2105": "https://base-rpc.publicnode.com",
  "0x1e":   "https://public-node.rsk.co",
}

interface BexoContextType {
  isEmbedded: boolean
  client: { _id: string; alias: string; image: string; currencies: Currency[] } | null
  connected: boolean
  currencies: Currency[]
  provider: any | null
}

const BexoContext = createContext<BexoContextType | null>(null)

export function BexoProvider({ children }: { children: ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false)
  const [client, setClient] = useState<BexoContextType["client"]>(null)
  const [connected, setConnected] = useState(false)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [provider, setProvider] = useState<any>(null)

  useEffect(() => {
    const init = async () => {
      try {
        const { XOConnect, XOConnectProvider } = await import("xo-connect")

        const xoProvider = new XOConnectProvider({
          rpcs: RPC_MAP,
          defaultChainId: "0x89",
        })
        setProvider(xoProvider)

        const result = await Promise.race([
          XOConnect.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]) as { client: BexoContextType["client"] }

        if (result?.client) {
          setClient(result.client)
          setConnected(true)
          setIsEmbedded(true)
          setCurrencies(result.client.currencies || [])
        }
      } catch {
        // Not inside Bexo WebView
      }
    }
    init()
  }, [])

  return (
    <BexoContext.Provider value={{ isEmbedded, client, connected, currencies, provider }}>
      {children}
    </BexoContext.Provider>
  )
}

export function useBexo() {
  const ctx = useContext(BexoContext)
  if (!ctx) throw new Error("useBexo must be used within BexoProvider")
  return ctx
}
```

### Checkout Component (crypto-checkout.tsx)

See `docs/examples/next-checkout.tsx` for a complete production-ready checkout component.

---

## Troubleshooting

### "No connection available"
The app is not running inside Bexo's WebView. `window.XOConnect` is only injected by the native Bexo app.

### Balance returns 0 for USDC
Check both USDC contract variants (Circle native + USDC.e bridged). See [Known Token Contracts](#known-token-contracts).

### "RPC not configured"
You called `eth_getBalance`, `eth_call`, or other read methods without providing RPCs:
```typescript
new XOConnectProvider({
  rpcs: { "0x89": "https://polygon-bor-rpc.publicnode.com" },
  defaultChainId: "0x89",
})
```

### Balance reads fail after chain switch
After `wallet_switchEthereumChain`, recreate `BrowserProvider`:
```typescript
await xo.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })
const ethersProvider = new BrowserProvider(xo) // new instance after switch
```

### Transaction rejected with "Currency could not be resolved"
The provider couldn't find a currency matching the current chain. Make sure `wallet_switchEthereumChain` was called before `eth_sendTransaction`.

### ethers.js v5 vs v6
- **v5**: `new ethers.providers.Web3Provider(xoProvider, "any")`
- **v6**: `new BrowserProvider(xoProvider)` — recommended

---

## Copy-Paste Prompt for AI

Use this prompt to give any AI assistant (Claude, ChatGPT, Cursor, etc.) everything it needs to integrate xo-connect:

---

```
Integrate Bexo Wallet payments into my web app using the xo-connect SDK.

## What xo-connect is
EIP-1193 wallet provider for Bexo. Runs inside Bexo's mobile WebView.
npm: `xo-connect` — exports `XOConnect` (singleton) and `XOConnectProvider` (EIP-1193).

## How to use
1. Create provider: `new XOConnectProvider({ rpcs: { "0x89": "https://polygon-bor-rpc.publicnode.com" }, defaultChainId: "0x89" })`
2. Connect: `const { client } = await XOConnect.connect()` → returns `{ alias, currencies: [...] }`
3. Wrap in ethers: `new BrowserProvider(xoProvider)` → use ethers Contract for balance reads and transfers

## Currency model
Each `client.currencies[i]` has: `{ id, address, chainId?, symbol?, image? }`
- `address` = user's wallet address (NOT token contract!)
- No `chainId` = fiat (ARS). Use `XOConnect.sendRequest({ method: "transactionSign", currency: id, data: { to, value } })` for fiat.
- `id.includes('.native.')` = native token → `ethersProvider.getBalance(address)`
- Otherwise = ERC20 → `new Contract(tokenContractAddr, ABI, ethersProvider).balanceOf(address)`

## USDC contracts (probe both for bridged variants)
- Polygon 0x89: Circle `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` / USDC.e `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (6 decimals)
- Ethereum 0x1: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (6 decimals)
- Arbitrum 0xa4b1: Circle `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` / USDC.e `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` (6 decimals)
- Base 0x2105: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals)

## ERC20 transfer pattern
```ts
const signer = await new BrowserProvider(xoProvider).getSigner(0)
const usdc = new Contract(usdcAddr, ["function transfer(address,uint256) returns (bool)"], signer)
await usdc.transfer(recipient, amount)
```

## Fiat (ARS) payment pattern
```ts
XOConnect.sendRequest({
  method: "transactionSign",
  currency: "argentina.fiat.ars",
  data: { to: recipientAlias, value: "22950", description: "Compra" },
  onSuccess: () => {},
  onCancel: () => {},
})
```

## RPCs (free, public)
"0x1": "https://ethereum-rpc.publicnode.com"
"0x89": "https://polygon-bor-rpc.publicnode.com"
"0xa4b1": "https://arbitrum-one-rpc.publicnode.com"
"0x2105": "https://base-rpc.publicnode.com"
"0x1e": "https://public-node.rsk.co"

## Reference implementation
https://github.com/fabian416/sami/tree/main/packages/frontend/src/providers
```

---

*This document is part of the xo-connect npm package. Version: 2.2.0*
