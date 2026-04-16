/**
 * Minimal JSON-RPC client used for read-only calls (balance, block, logs, etc.)
 * and for broadcasting signed transactions via eth_sendRawTransaction.
 *
 * Security-reviewed: validates URL, uses unpredictable request IDs,
 * enforces HTTP status, and supports a fetch timeout.
 */
export class JsonRpcClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;

  constructor(rpcUrl: string, opts: { timeoutMs?: number } = {}) {
    if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
      throw new Error('JsonRpcClient: rpcUrl is required');
    }
    // Allow only http(s) URLs. javascript:, data:, file: etc. are rejected.
    let parsed: URL;
    try {
      parsed = new URL(rpcUrl);
    } catch {
      throw new Error(`JsonRpcClient: invalid URL: ${rpcUrl}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(
        `JsonRpcClient: unsupported protocol ${parsed.protocol} (use https:// or http://)`
      );
    }

    this.rpcUrl = rpcUrl;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private nextId(): string {
    // Prefer crypto.randomUUID (cryptographically strong) over Date.now.
    // Falls back to a random string for older environments.
    const c: any = (typeof globalThis !== 'undefined' ? (globalThis as any).crypto : null);
    if (c?.randomUUID) return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async call<T = any>(method: string, params: any[] = []): Promise<T> {
    const controller: AbortController | null =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId(),
          method,
          params,
        }),
        signal: controller?.signal,
      });

      if (!res.ok) {
        throw new Error(
          `RPC HTTP ${res.status} ${res.statusText} for ${method}`
        );
      }

      const json = await res.json();
      if (json.error) {
        const { code, message, data } = json.error;
        const err: any = new Error(message || 'RPC Error');
        err.code = code;
        err.reason = message;
        if (data) err.data = data;
        throw err;
      }
      return json.result as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
