import { Method, XOConnect } from "./";
import { JsonRpcClient } from "./rpc-client";
import { DebugPanel } from "./debug-panel";

type Listener = (...args: any[]) => void;
type RpcMap = Record<string /* hex chainId like "0x1" */, string /* rpc url */>;

export class XOConnectProvider {
  isXOConnect = true;

  private listeners: Map<string, Set<Listener>> = new Map();
  private client: any;

  private rpcMap: RpcMap | null = null;
  private rpc: JsonRpcClient | null = null;
  private chainIdHex: string = "0x1";
  private debugPanel: DebugPanel | null = null;

  constructor(opts?: { rpcs?: RpcMap; defaultChainId?: string; debug?: boolean }) {
    if (opts?.defaultChainId) {
      const id = opts.defaultChainId.toLowerCase();
      if (!/^0x[0-9a-f]+$/i.test(id)) {
        throw new Error(
          "XOConnectProvider: chainId must be hex (e.g., 0x1, 0x89)"
        );
      }
      this.chainIdHex = id;
    }

    if (opts?.rpcs) {
      this.rpcMap = opts.rpcs;
      if (this.rpcMap[this.chainIdHex]) {
        this.rpc = new JsonRpcClient(this.rpcMap[this.chainIdHex]);
      }
    }

    // Debug panel is ON by default so integrators see errors immediately.
    // Pass `debug: false` explicitly to disable it for production builds.
    // See docs/integration.md → "Disabling the debug panel" for details.
    const debugEnabled = opts?.debug !== false;
    if (debugEnabled) {
      this.debugPanel = new DebugPanel({
        rpcMap: this.rpcMap,
        currentChainId: this.chainIdHex,
        onRpcChange: (chainId, url) => this.setRpc(chainId, url),
      });
      this.debugPanel.info('init', {
        chainId: this.chainIdHex,
        rpcs: this.rpcMap ? Object.keys(this.rpcMap) : [],
      });
      // Share the panel with the core XOConnect singleton
      XOConnect.debugPanel = this.debugPanel;
    }
  }

  /**
   * Update the RPC URL for a given chain at runtime.
   * Useful for debugging against different providers without rebuilding.
   */
  setRpc(chainId: string, url: string): void {
    const id = chainId.toLowerCase();
    if (!this.rpcMap) this.rpcMap = {};
    this.rpcMap[id] = url;
    if (id === this.chainIdHex) {
      this.rpc = new JsonRpcClient(url);
    }
    this.debugPanel?.info('rpc-updated', { chainId: id, url });
  }

  private requireRpc(method: string): JsonRpcClient {
    if (!this.rpc) {
      throw new Error(
        `XOConnectProvider: RPC not configured. The method "${method}" requires an RPC endpoint. ` +
        `Initialize the provider with rpcs option: new XOConnectProvider({ rpcs: { "0x1": "https://..." }, defaultChainId: "0x1" })`
      );
    }
    return this.rpc;
  }

  // ---- Events
  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  removeListener(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  private emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((l) => l(...args));
  }

  // ---- Client & accounts
  async getClient() {
    if (!this.client) {
      this.client = await XOConnect.getClient();
      const accounts = await this.getAccounts();
      if (accounts.length) this.emit("connect", { chainId: this.chainIdHex });
    }
    return this.client;
  }

  // Filtrar currencies con chainId válido (hex como "0x1", "0x89", etc.)
  private filterValidCurrencies(currencies: any[]): any[] {
    return (currencies || []).filter((c: any) => {
      if (!c.chainId) return false;
      const raw = String(c.chainId).toLowerCase();
      const num = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
      return !isNaN(num) && num > 0;
    });
  }

  async getAvailableCurrencies() {
    const client = await this.getClient();
    return this.filterValidCurrencies(client.currencies);
  }

  private async getAccounts(): Promise<string[]> {
    const client = await this.getClient();
    const validCurrencies = this.filterValidCurrencies(client.currencies);
    const cur = validCurrencies.find(
      (c: any) => (c.chainId?.toLowerCase?.() ?? "") === this.chainIdHex
    );
    return cur?.address ? [cur.address] : [];
  }

  // ---- Helpers
  private withLatest(params?: any[], minLen = 2): any[] {
    const p = Array.isArray(params) ? [...params] : [];
    // Ensure blockTag exists for methods like eth_call, eth_getCode
    if (p.length < minLen) p[minLen - 1] = "latest";
    return p;
  }

  // ---- Signing
  private async personalSign(params: any[]): Promise<string> {
    const a = params ?? [];
    // Handle both [msg, addr] and [addr, msg]
    let msg =
      typeof a[0] === "string" && !a[0].startsWith("0x") && a[1] ? a[1] : a[0];

    // Convertir mensaje a hex si no lo es (la wallet espera hex para toUtf8String)
    if (typeof msg === "string" && !msg.startsWith("0x")) {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(msg);
      msg = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    return new Promise((resolve, reject) => {
      XOConnect.sendRequest({
        method: Method.personalSign,
        data: msg,
        onSuccess: (res) => resolve(res.data?.signature ?? res.data?.txs),
        onCancel: () => reject(new Error("User rejected signature")),
      });
    });
  }

  // XOConnectProvider: inside signTransaction
  private async signTransaction(tx: any): Promise<string> {
    const client = await this.getClient();
    const validCurrencies = this.filterValidCurrencies(client.currencies);
    const currencyId =
      tx?.currency ||
      validCurrencies.find(
        (c: any) => c.chainId?.toLowerCase() === this.chainIdHex
      )?.id;

    if (!currencyId)
      throw new Error("Currency could not be resolved for transaction");

    const [from] = await this.getAccounts();

    // Convertir value a string decimal para la wallet. BigInt throws on
    // invalid input (non-hex strings, Symbols, objects) — guard against it.
    let valueForWallet: string = "0";
    try {
      if (typeof tx.value === "object" && tx.value?.hex) {
        valueForWallet = BigInt(tx.value.hex).toString();
      } else if (typeof tx.value === "string" && tx.value.startsWith("0x")) {
        valueForWallet = BigInt(tx.value).toString();
      } else if (tx.value) {
        valueForWallet = String(tx.value);
      }
    } catch (err: any) {
      throw new Error(
        `signTransaction: invalid value ${JSON.stringify(tx.value)}: ${err?.message || err}`
      );
    }

    // Asegurar que data tenga formato hex o sea undefined
    let dataForWallet = tx.data;
    if (dataForWallet === "0" || dataForWallet === "") {
      dataForWallet = undefined;
    }
    if (dataForWallet && typeof dataForWallet === "string" && !dataForWallet.startsWith("0x")) {
      dataForWallet = "0x" + dataForWallet;
    }

    const txForSigning = { from, ...tx, value: valueForWallet, data: dataForWallet };

    return new Promise((resolve, reject) => {
      XOConnect.sendRequest({
        method: Method.transactionSign,
        data: txForSigning,
        currency: currencyId,
        onSuccess: async (res) => {
          try {
            const d = res?.data ?? {};

            if (typeof d.signedTx === "string" && d.signedTx.startsWith("0x")) {
              // This requires RPC to broadcast the signed transaction
              const rpc = this.requireRpc("eth_sendRawTransaction");
              const hash = await rpc.call<string>(
                "eth_sendRawTransaction",
                [d.signedTx]
              );
              return resolve(hash);
            }

            const hash = d.result;
            // Strict: exactly 32 bytes hex after 0x (66 total), only [0-9a-f]
            if (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
              return resolve(hash);
            }

            return reject(
              new Error("Wallet returned neither signedTx nor transaction hash")
            );
          } catch (e) {
            return reject(e);
          }
        },
        onCancel: () => reject(new Error("User rejected transaction")),
      });
    });
  }

  private async signTypedData(params: any[]): Promise<string> {
    const typed = this.normalizeTypedParams(params); // devuelve el typed listo
    return new Promise((resolve, reject) => {
      XOConnect.sendRequest({
        method: Method.typedDataSign,
        data: typed, // solo el typed (string u objeto), como espera tu wallet hoy
        onSuccess: (res) => resolve(res.data?.result),
        onCancel: () => reject(new Error("User rejected typed data signature")),
      });
    });
  }

  private normalizeTypedParams(params: any[]): any {
    const isAddr = (v: any) =>
      typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);

    const tryParse = (v: any) => {
      if (typeof v === "string") {
        try {
          return JSON.parse(v);
        } catch {
          /* noop */
        }
      }
      return v;
    };

    // MetaMask eth_signTypedData_v4 común: [address, jsonString]
    let payload: any;
    if (isAddr(params?.[0])) {
      payload = params?.[1];
    } else if (isAddr(params?.[1])) {
      payload = params?.[0];
    } else {
      payload = params?.find(
        (x: any) => x && (typeof x === "object" || typeof x === "string")
      );
    }

    const obj = tryParse(payload);

    if (!obj || !obj.types || !obj.primaryType || !obj.message) {
      throw new Error("Invalid EIP-712 payload");
    }

    // Si tu wallet prefiere string, devolvelo stringificado; si acepta objeto, podés devolver obj directo.
    return typeof payload === "string" ? JSON.stringify(obj) : obj;
  }

  // ---- EIP-1193 request entrypoint
  async request({
    method,
    params,
  }: {
    method: string;
    params?: any[];
  }): Promise<any> {
    this.debugPanel?.request(method, params);

    try {
      const result = await this._handleRequest(method, params);
      this.debugPanel?.response(method, result);
      return result;
    } catch (err: any) {
      this.debugPanel?.error(method, err?.message || err);
      throw err;
    }
  }

  private async _handleRequest(method: string, params?: any[]): Promise<any> {
    switch (method) {
      // accounts & signing (no RPC required)
      case "eth_requestAccounts":
      case "eth_accounts":
        return this.getAccounts();
      case "personal_sign":
        return this.personalSign(params ?? []);
      case "eth_sendTransaction":
        return this.signTransaction(params?.[0]);
      case "eth_signTypedData":
      case "eth_signTypedData_v4":
        return this.signTypedData(params ?? []);

      // chain mgmt
      case "eth_chainId":
        return this.chainIdHex;
      case "net_version":
        return parseInt(this.chainIdHex, 16).toString();
      case "wallet_switchEthereumChain": {
        const next = (params?.[0]?.chainId ?? "").toLowerCase();
        if (!next)
          throw new Error("wallet_switchEthereumChain: chainId required");

        this.chainIdHex = next;

        // Update RPC if available for new chain
        if (this.rpcMap && this.rpcMap[next]) {
          this.rpc = new JsonRpcClient(this.rpcMap[next]);
        } else {
          this.rpc = null;
        }

        // Keep the debug panel in sync (highlights the active chain)
        this.debugPanel?.setCurrentChain?.(next);

        this.emit("chainChanged", next);
        // Optional: also emit accountsChanged if your account is chain-specific
        const accs = await this.getAccounts();
        if (accs) this.emit("accountsChanged", accs);
        return null;
      }

      // reads (proxied to current rpc - requires RPC)
      case "eth_blockNumber":
        return this.requireRpc(method).call("eth_blockNumber");
      case "eth_gasPrice":
        return this.requireRpc(method).call("eth_gasPrice");
      case "eth_getBalance":
        return this.requireRpc(method).call(
          "eth_getBalance",
          params ?? [(await this.getAccounts())[0], "latest"]
        );
      case "eth_getTransactionCount":
        return this.requireRpc(method).call(
          "eth_getTransactionCount",
          params ?? [(await this.getAccounts())[0], "latest"]
        );
      case "eth_getCode":
        return this.requireRpc(method).call("eth_getCode", this.withLatest(params, 2));
      case "eth_call":
        return this.requireRpc(method).call("eth_call", this.withLatest(params, 2));
      case "eth_estimateGas":
        return this.requireRpc(method).call("eth_estimateGas", params ?? [{}]);
      case "eth_getLogs":
        return this.requireRpc(method).call("eth_getLogs", params ?? []);
      case "eth_getBlockByNumber":
      case "eth_getBlockByHash":
      case "eth_getTransactionByHash":
      case "eth_getTransactionReceipt":
        return this.requireRpc(method).call(method, params ?? []);

      // fallback: proxy unknowns (requires RPC)
      default:
        return this.requireRpc(method).call(method, params ?? []);
    }
  }
}
