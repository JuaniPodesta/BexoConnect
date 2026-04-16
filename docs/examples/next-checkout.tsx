/**
 * Complete production-ready checkout component for Next.js App Router.
 * Uses xo-connect + ethers.js v6 BrowserProvider pattern.
 *
 * Prerequisites:
 *   npm install xo-connect ethers
 *
 * Usage:
 *   <BexoProvider>           {/* in layout.tsx */}
 *     <CryptoCheckout
 *       amountUSD="17.65"
 *       recipient="0x8a24a8..."
 *       onSuccess={() => clearCart()}
 *     />
 *   </BexoProvider>
 */

"use client"

import { useState, useEffect } from "react"
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers"

// -- Minimal ERC20 ABI ---------------------------------------------------
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
]

// -- Known token contracts (probe all variants for bridged tokens) --------
const TOKEN_CONTRACTS: Record<string, Record<string, string[]>> = {
  "0x89": {
    USDC: [
      "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Circle native
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC.e
    ],
    USDT: ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F"],
  },
  "0x1": {
    USDC: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    USDT: ["0xdAC17F958D2ee523a2206206994597C13D831ec7"],
  },
  "0xa4b1": {
    USDC: [
      "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    ],
  },
  "0x2105": {
    USDC: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  },
}

// -- Helpers --------------------------------------------------------------

function getCurrencyLabel(id: string): string {
  const l = id.toLowerCase()
  if (l.includes("usdc")) return "USDC"
  if (l.includes("usdt")) return "USDT"
  if (l.includes("dai")) return "DAI"
  if (l.includes(".pol") || l.includes("polygon.mainnet.native")) return "POL"
  if (l.includes("bnb") || l.includes("bsc.mainnet.native")) return "BNB"
  if (l.includes("rbtc") || l.includes("rootstock.mainnet.native")) return "RBTC"
  if (l.includes("btc") || l.includes("bitcoin")) return "BTC"
  if (l.includes("eth")) return "ETH"
  if (l.includes("matic")) return "POL"
  if (l.includes("ars") || l.includes("peso")) return "ARS"
  return id.split(".").pop()?.toUpperCase() || id
}

function getNetworkLabel(id: string): string {
  const l = id.toLowerCase()
  if (l.includes("polygon")) return "Polygon"
  if (l.includes("ethereum")) return "Ethereum"
  if (l.includes("arbitrum")) return "Arbitrum"
  if (l.includes("base")) return "Base"
  if (l.includes("bsc")) return "BSC"
  if (l.includes("rootstock")) return "Rootstock"
  if (l.includes("bitcoin")) return "Bitcoin"
  return ""
}

// -- Types ----------------------------------------------------------------

interface WalletCurrency {
  id: string
  label: string
  network: string
  balance: string
  isFiat: boolean
  // internal
  address: string
  chainId?: string
  contractAddress?: string
  decimals: number
}

interface Props {
  amountUSD: string
  recipient: string
  onSuccess: () => void
  onCancel?: () => void
}

// -- Component ------------------------------------------------------------

export function CryptoCheckout({ amountUSD, recipient, onSuccess, onCancel }: Props) {
  // These would come from your BexoProvider context:
  // const { client, connected, currencies, provider } = useBexo()
  //
  // For this example we inline the xo-connect setup:

  const [currencies, setCurrencies] = useState<WalletCurrency[]>([])
  const [selected, setSelected] = useState<WalletCurrency | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [provider, setProvider] = useState<any>(null)

  // 1. Connect + read balances
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { XOConnect, XOConnectProvider } = await import("xo-connect")

      const xo = new XOConnectProvider({
        rpcs: {
          "0x89": "https://polygon-bor-rpc.publicnode.com",
          "0x1": "https://ethereum-rpc.publicnode.com",
          "0xa4b1": "https://arbitrum-one-rpc.publicnode.com",
          "0x2105": "https://base-rpc.publicnode.com",
        },
        defaultChainId: "0x89",
      })
      setProvider(xo)

      const { client } = await XOConnect.connect()
      const results: WalletCurrency[] = []

      for (const c of client.currencies) {
        if (cancelled) return

        const label = getCurrencyLabel(c.id)
        const network = getNetworkLabel(c.id)
        const isFiat = !c.chainId

        // Fiat (ARS)
        if (isFiat) {
          results.push({
            id: c.id, label, network, balance: "disponible",
            isFiat: true, address: c.address, decimals: 0,
          })
          continue
        }

        const isNative = c.id.includes(".native.")

        try {
          // Switch chain, then create fresh BrowserProvider
          await xo.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: c.chainId }],
          }).catch(() => {})

          const ep = new BrowserProvider(xo)

          if (isNative) {
            const bal = await ep.getBalance(c.address)
            if (bal > 0n) {
              results.push({
                id: c.id, label, network, isFiat: false,
                balance: parseFloat(formatUnits(bal, 18)).toFixed(6),
                address: c.address, chainId: c.chainId, decimals: 18,
              })
            }
            continue
          }

          // ERC20: probe known contracts
          const addrs = TOKEN_CONTRACTS[c.chainId!]?.[label] ?? []
          for (const addr of addrs) {
            try {
              const contract = new Contract(addr, ERC20_ABI, ep)
              const [bal, dec] = await Promise.all([
                contract.balanceOf(c.address) as Promise<bigint>,
                contract.decimals().catch(() => 6) as Promise<number>,
              ])
              if (bal > 0n) {
                results.push({
                  id: c.id, label, network, isFiat: false,
                  balance: parseFloat(formatUnits(bal, Number(dec))).toFixed(Number(dec) <= 8 ? Number(dec) : 4),
                  address: c.address, chainId: c.chainId,
                  contractAddress: addr, decimals: Number(dec),
                })
                break
              }
            } catch { /* skip variant */ }
          }
        } catch {
          // chain not supported — skip
        }
      }

      // Sort: fiat first, then stablecoins, then rest
      const prio: Record<string, number> = { ARS: 200, USDC: 100, USDT: 95, DAI: 90 }
      results.sort((a, b) => (prio[b.label] ?? 0) - (prio[a.label] ?? 0))

      if (!cancelled) {
        setCurrencies(results)
        setSelected(results[0] ?? null)
        setLoading(false)
      }
    }

    run().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  // 2. Pay
  const handlePay = async () => {
    if (!selected || !provider) return
    setPaying(true)

    try {
      if (selected.isFiat) {
        const { XOConnect } = await import("xo-connect")
        await new Promise<void>((resolve, reject) => {
          XOConnect.sendRequest({
            method: "transactionSign" as any,
            currency: selected.id,
            data: { to: recipient, value: amountUSD, description: "Payment" },
            onSuccess: () => resolve(),
            onCancel: () => reject(new Error("cancelled")),
          })
        })
      } else {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: selected.chainId }],
        }).catch(() => {})

        const ep = new BrowserProvider(provider)
        const signer = await ep.getSigner(0)

        if (!selected.contractAddress) {
          // Native transfer
          await (await signer.sendTransaction({
            to: recipient,
            value: parseUnits(amountUSD, 18),
          })).wait()
        } else {
          // ERC20 transfer
          const contract = new Contract(selected.contractAddress, ERC20_ABI, signer)
          const amount = parseUnits(amountUSD, selected.decimals)
          await (await contract.transfer(recipient, amount)).wait()
        }
      }

      onSuccess()
    } catch (err: any) {
      if (err?.message?.includes("cancel")) {
        onCancel?.()
      } else {
        console.error("Payment failed:", err)
      }
    } finally {
      setPaying(false)
    }
  }

  if (loading) return <p>Connecting to Bexo Wallet...</p>
  if (currencies.length === 0) return <p>No currencies with balance found.</p>

  return (
    <div>
      <h3>Pay ${amountUSD} USD</h3>

      {currencies.map((c) => (
        <button
          key={c.id}
          onClick={() => setSelected(c)}
          style={{
            display: "block",
            padding: "8px 16px",
            margin: "4px 0",
            border: selected?.id === c.id ? "2px solid blue" : "1px solid gray",
          }}
        >
          {c.label} {c.network && `(${c.network})`} — {c.isFiat ? "ARS" : c.balance}
        </button>
      ))}

      <button onClick={handlePay} disabled={paying || !selected}>
        {paying ? "Confirming..." : `Pay with ${selected?.label ?? "..."}`}
      </button>
    </div>
  )
}
