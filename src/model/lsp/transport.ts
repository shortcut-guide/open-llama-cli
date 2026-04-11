// src/model/lsp/transport.ts
// JSON-RPC 2.0 transport over a child process stdio (LSP wire format)
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LspTransport extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private proc: ChildProcess) {
    super();
    proc.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) this.emit('stderr', text);
    });
    proc.on('exit', (code) => this.emit('exit', code));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Malformed header — skip past it
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength).toString('utf8');
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        this.dispatch(msg);
      } catch {
        // ignore parse errors
      }
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      // It's a response
      const res = msg as JsonRpcResponse;
      const pending = this.pending.get(res.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(res.id);
        if (res.error) {
          pending.reject(new Error(`LSP error ${res.error.code}: ${res.error.message}`));
        } else {
          pending.resolve(res.result);
        }
      }
    } else if ('method' in msg) {
      // Notification or server-initiated request
      const notif = msg as JsonRpcNotification;
      this.emit(notif.method, notif.params);
    }
  }

  sendRequest(method: string, params: unknown, timeoutMs = 10000): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.write(payload);
    });
  }

  sendNotification(method: string, params: unknown): void {
    const payload: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.write(payload);
  }

  private write(msg: JsonRpcRequest | JsonRpcNotification): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
    this.proc.stdin?.write(header + body, 'utf8');
  }

  dispose(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('LSP transport disposed'));
    }
    this.pending.clear();
    this.removeAllListeners();
  }
}
