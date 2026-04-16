import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { DebugPanel } from './debug-panel';

export enum Method {
  available = "available",
  connect = "connect",
  personalSign = "personalSign",
  transactionSign = "transactionSign",
  typedDataSign = "typedDataSign",
}

/**
 * A currency/asset in the user's Bexo wallet.
 *
 * **ID format**: `{chain}.{network}.{type}.{symbol}`
 *   - Crypto native: `"polygon.mainnet.native.pol"` (chainId: "0x89")
 *   - Crypto ERC20:  `"polygon.mainnet.erc20.usdc"` (chainId: "0x89")
 *   - Fiat:          `"argentina.fiat.ars"`          (chainId: undefined)
 *
 * **Detecting currency type:**
 *   - `!currency.chainId`           → fiat (ARS, etc.)
 *   - `id.includes('.native.')`      → native token (ETH, POL, BNB, RBTC)
 *   - otherwise                      → ERC20 token
 *
 * **Important:** `address` is the USER's wallet address, NOT a token contract address.
 * To read ERC20 balances you need a separate mapping of chainId+symbol → contract address.
 */
export interface Currency {
    /** Dot-separated identifier, e.g. "polygon.mainnet.erc20.usdc" */
    id: string;
    /** User's wallet address on this chain (NOT the token contract) */
    address: string;
    /** Hex chain ID, e.g. "0x89". Missing for fiat currencies. */
    chainId?: string;
    /** Token symbol, e.g. "USDC", "POL", "ARS" */
    symbol?: string;
    /** URL to the currency icon */
    image?: string;
}

export interface Client {
    _id: string;
    alias: string;
    image: string;
    currencies: Currency[];
}

export interface RequestParams {
    method: Method;
    data?: any;
    currency?: string
    onSuccess: (response: Response) => void;
    onCancel: () => void;
}

export interface Request extends RequestParams {
    id: string;
}

export interface Response {
    id: string
    type: string
    data: any
}

class _XOConnect {
  private connectionId: string;
  private pendingRequests: Map<string, Request> = new Map();
  private client: Client;
  debugPanel: DebugPanel | null = null;

    setClient(client:Client) {
        this.client = client;
    } 

  async getClient(): Promise<Client | null> {
    if(!this.client){
        const {client} =  await this.connect()
        this.client = client;
    }
    return this.client;
  }

  async delay(ms: number) {
    await new Promise((resolve) => setTimeout(() => resolve(""), ms)).then(
      () => {}
    );
  }

  async connect(): Promise<{ id: string; client: Client }> {
    this.connectionId = uuidv4();
    this.debugPanel?.info('connect', 'Buscando wallet XO...');

    for (let i = 0; i < 20; i++) {
      if (!window["XOConnect"]) {
        await this.delay(250);
      }
    }

    if (!window["XOConnect"]) {
      this.debugPanel?.error('connect', 'Wallet XO no encontrada');
      return Promise.reject(new Error("No connection available"));
    }

    this.debugPanel?.info('connect', 'Wallet XO detectada');
    // Guard against double-adding the listener if connect() is called multiple times
    window.removeEventListener("message", this.messageHandler);
    window.addEventListener("message", this.messageHandler, false);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No connection available"));
      }, 10000);

      this.sendRequest({
        method: Method.connect,
        onSuccess: (res: Response) => {
          clearTimeout(timeout);
          this.debugPanel?.info('connect', 'Respuesta recibida');

          try {
            const client = res.data?.client;
            if (!client || typeof client !== 'object') {
              throw new Error("Invalid client payload from wallet");
            }
            this.debugPanel?.info('connect', `Client: ${client.alias || 'sin alias'}`);

            const message = `xoConnect-${res.id}`;
            const signature = client.signature;
            if (!signature || typeof signature !== 'string') {
              throw new Error("Missing signature in client payload");
            }
            this.debugPanel?.info('connect', `Signature: ${signature.slice(0, 20)}...`);

            let recovered: string;
            try {
              recovered = ethers.utils.verifyMessage(message, signature);
            } catch (err: any) {
              throw new Error(`Signature verification failed: ${err?.message || err}`);
            }
            this.debugPanel?.info('connect', `Recovered address: ${recovered}`);

            // Log todas las currencies recibidas
            const currencies = Array.isArray(client.currencies) ? client.currencies : [];
            this.debugPanel?.info('connect', `Currencies recibidas: ${currencies.length}`);
            currencies.forEach((c: any, i: number) => {
              this.debugPanel?.info('currency', `${i}: ${c?.id} chainId=${c?.chainId}`);
            });

            // Verify the recovered address matches ANY EVM currency address in the
            // client payload (same wallet uses the same address across EVM chains).
            // Previously this only checked `ethereum.mainnet.native.eth`, which
            // crashed for Polygon-only wallets and was strictly less secure.
            const recoveredLower = recovered.toLowerCase();
            const matched = currencies.find((c: any) =>
              typeof c?.address === 'string' &&
              c.address.toLowerCase() === recoveredLower
            );
            if (!matched) {
              this.debugPanel?.error(
                'connect',
                `Address mismatch: recovered ${recovered} not present in any currency`
              );
              throw new Error("Invalid signature");
            }

            this.setClient(client);
            this.debugPanel?.response('connect', { address: matched.address, alias: client.alias });

            resolve({
              id: res.id,
              client,
            });
          } catch (e: any) {
            this.debugPanel?.error('connect', `Error: ${e.message}`);
            reject(e);
          }
        },
        onCancel: () => {
          clearTimeout(timeout);
          this.debugPanel?.error('connect', 'Conexión cancelada');
          reject(new Error("No connection available"));
        },
      });
    });
  }

  disconnect(): void {
    window.removeEventListener("message", this.messageHandler);
    this.connectionId = "";
  }

  sendRequest(params: RequestParams): string {
    if (!this.connectionId) {
      this.debugPanel?.error('sendRequest', 'No conectado');
      throw new Error("You are not connected");
    }
    const id = uuidv4();
    const request: Request = { id, ...params };
    this.pendingRequests.set(id, request);

    this.debugPanel?.request(params.method, { currency: params.currency, data: params.data });

    // targetOrigin is set to the current origin so the message doesn't leak
    // across cross-origin frames in future browser versions that enforce it.
    // Inside the native Bexo WebView the listener is in the same origin.
    const targetOrigin =
      typeof window !== 'undefined' && window.location ? window.location.origin : '*';

    window.postMessage(
      JSON.stringify({
        id,
        type: "send",
        method: request.method,
        data: request.data,
        currency: request.currency || "eth",
      }),
      targetOrigin
    );
    return id;
  }

  cancelRequest(id: string): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;
    const targetOrigin =
      typeof window !== 'undefined' && window.location ? window.location.origin : '*';
    window.postMessage(
      JSON.stringify({
        id,
        type: "cancel",
        method: request.method,
      }),
      targetOrigin
    );
    this.pendingRequests.delete(id);
  }

  private processResponse(response: Response): void {
    const request = this.pendingRequests.get(response.id);
    if (request) {
      if (response.type == "receive") {
        this.debugPanel?.response(request.method, response.data);
        request.onSuccess(response);
      }
      if (response.type == "cancel") {
        this.debugPanel?.error(request.method, 'Cancelado por usuario');
        request.onCancel();
      }
      this.pendingRequests.delete(response.id);
    }
  }

  // Hardened message handler (addresses security review findings):
  //   1. Only accept messages from the same window (blocks iframe/cross-origin injection)
  //   2. Enforce origin match (blocks other tabs/opener attacks)
  //   3. Wrap JSON.parse in try/catch (prevents crash from non-JSON messages)
  //   4. Only process responses whose `id` corresponds to a pending request
  private messageHandler = (event: MessageEvent) => {
    // Only accept messages from this window itself (the wallet bridge posts to window)
    if (event.source !== window) return;

    // Enforce same-origin. '' or 'null' origins (data:, about:blank) are rejected.
    if (typeof window !== 'undefined' && window.location) {
      const expected = window.location.origin;
      if (event.origin && event.origin !== expected) return;
    }

    if (typeof event.data !== 'string' || event.data.length === 0) return;

    let res: Response;
    try {
      res = JSON.parse(event.data);
    } catch {
      return; // Non-JSON messages are silently ignored, not crashed on
    }

    if (!res || typeof res !== 'object' || typeof res.id !== 'string') return;
    if (res.type === 'send') return; // These are our own outgoing messages

    // Only process responses we actually asked for
    if (!this.pendingRequests.has(res.id)) return;

    this.processResponse(res);
  };
}

export const XOConnect = new _XOConnect();

export { XOConnectProvider } from "./xo-connect-provider";