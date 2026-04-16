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
            const client = res.data.client;
            this.debugPanel?.info('connect', `Client: ${client?.alias || 'sin alias'}`);

            const message = `xoConnect-${res.id}`;
            const signature = client.signature;
            this.debugPanel?.info('connect', `Signature: ${signature?.slice(0, 20)}...`);

            const address = ethers.utils.verifyMessage(message, signature);
            this.debugPanel?.info('connect', `Recovered address: ${address}`);

            // Log todas las currencies recibidas
            this.debugPanel?.info('connect', `Currencies recibidas: ${client.currencies?.length || 0}`);
            client.currencies?.forEach((c: any, i: number) => {
              this.debugPanel?.info('currency', `${i}: ${c.id} chainId=${c.chainId}`);
            });

            const eth = client.currencies.find(
              (c: any) => c.id == "ethereum.mainnet.native.eth"
            );
            this.debugPanel?.info('connect', `ETH address: ${eth?.address}`);

            if (eth.address !== address) {
              this.debugPanel?.error('connect', `Address mismatch: ${eth.address} vs ${address}`);
              throw new Error("Invalid signature");
            }

            this.setClient(client);
            this.debugPanel?.response('connect', { address: eth.address, alias: client.alias });

            resolve({
              id: res.id,
              client: res.data.client,
            });
          } catch (e: any) {
            this.debugPanel?.error('connect', `Error: ${e.message}`);
            reject(e);
          }
        },
        onCancel: () => {
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

    window.postMessage(
      JSON.stringify({
        id,
        type: "send",
        method: request.method,
        data: request.data,
        currency: request.currency || "eth",
      })
    );
    return id;
  }

  cancelRequest(id: string): void {
    const request = this.pendingRequests.get(id);
    postMessage(
      JSON.stringify({
        id,
        type: "cancel",
        method: request.method,
      })
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

  private messageHandler = (event: MessageEvent) => {
    if (event.data?.length) {
      const res: Response = JSON.parse(event.data);
      if (res.type != "send") this.processResponse(res);
    }
  };
}

export const XOConnect = new _XOConnect();

export { XOConnectProvider } from "./xo-connect-provider";