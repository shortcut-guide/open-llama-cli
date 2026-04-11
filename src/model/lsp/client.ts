// src/model/lsp/client.ts
// Manages a single LSP server instance
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs/promises';

import { LspTransport } from './transport.js';
import type {
  LspServerConfig,
  LspDiagnostic,
  LspServerStatus,
  PublishDiagnosticsParams,
  ProtocolDiagnostic,
  DiagnosticSeverity,
} from './types.js';

const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

export class LspClient {
  private transport: LspTransport | null = null;
  private pid: number | undefined;
  private error: string | undefined;
  private initialized = false;
  private diagnosticsMap = new Map<string, LspDiagnostic[]>();
  private openedUris = new Set<string>();

  constructor(
    private config: LspServerConfig,
    private workspaceRoot: string,
  ) {}

  get name(): string { return this.config.name; }
  get extensions(): string[] { return this.config.extensions; }
  get isRunning(): boolean { return this.initialized && this.transport !== null; }

  getStatus(): LspServerStatus {
    return {
      name: this.config.name,
      running: this.isRunning,
      pid: this.pid,
      extensions: this.config.extensions,
      error: this.error,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      const proc = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.pid = proc.pid;
      this.transport = new LspTransport(proc);

      this.transport.on('textDocument/publishDiagnostics', (params: unknown) => {
        const p = params as PublishDiagnosticsParams;
        const filePath = fileURLToPath(p.uri);
        const diags = p.diagnostics.map((d: ProtocolDiagnostic) =>
          this.convertDiagnostic(filePath, d)
        );
        this.diagnosticsMap.set(p.uri, diags);
      });

      this.transport.on('exit', () => {
        this.initialized = false;
        this.transport = null;
      });

      await this.initialize();
      this.initialized = true;
      this.error = undefined;
    } catch (e: unknown) {
      this.error = (e as Error).message;
      this.initialized = false;
      this.transport?.dispose();
      this.transport = null;
      throw e;
    }
  }

  private async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.workspaceRoot).toString();

    await this.transport!.sendRequest('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          publishDiagnostics: {
            relatedInformation: false,
            versionSupport: false,
          },
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: false,
          },
        },
        workspace: {
          workspaceFolders: false,
          configuration: false,
        },
      },
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.workspaceRoot) }],
    });

    this.transport!.sendNotification('initialized', {});
  }

  /**
   * Opens a file in the LSP server and waits for diagnostics (up to timeoutMs).
   * Returns cached diagnostics if the file was already opened.
   */
  async getDiagnostics(filePath: string, timeoutMs = 5000): Promise<LspDiagnostic[]> {
    if (!this.isRunning || !this.transport) return [];

    const uri = pathToFileURL(filePath).toString();

    if (!this.openedUris.has(uri)) {
      let text = '';
      try { text = await fs.readFile(filePath, 'utf-8'); } catch { return []; }

      const languageId = this.detectLanguageId(filePath);
      this.transport.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text },
      });
      this.openedUris.add(uri);

      // Wait for publishDiagnostics or timeout
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        const handler = (params: unknown) => {
          const p = params as PublishDiagnosticsParams;
          if (p.uri === uri) {
            clearTimeout(timer);
            this.transport?.removeListener('textDocument/publishDiagnostics', handler);
            resolve();
          }
        };
        this.transport!.on('textDocument/publishDiagnostics', handler);
      });
    }

    return this.diagnosticsMap.get(uri) ?? [];
  }

  async stop(): Promise<void> {
    if (!this.transport) return;
    try {
      await this.transport.sendRequest('shutdown', null, 3000);
      this.transport.sendNotification('exit', null);
    } catch {
      // ignore errors during shutdown
    }
    this.transport.dispose();
    this.transport = null;
    this.initialized = false;
    this.openedUris.clear();
    this.diagnosticsMap.clear();
  }

  private convertDiagnostic(filePath: string, d: ProtocolDiagnostic): LspDiagnostic {
    return {
      file: filePath,
      line: d.range.start.line + 1,
      character: d.range.start.character + 1,
      severity: d.severity ? (SEVERITY_MAP[d.severity] ?? 'info') : 'info',
      message: d.message,
      source: d.source,
    };
  }

  private detectLanguageId(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescriptreact',
      '.js': 'javascript', '.jsx': 'javascriptreact',
      '.py': 'python', '.rb': 'ruby', '.go': 'go',
      '.rs': 'rust', '.java': 'java', '.cs': 'csharp',
      '.cpp': 'cpp', '.c': 'c', '.h': 'c', '.hpp': 'cpp',
      '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
      '.md': 'markdown', '.sh': 'shellscript',
    };
    return map[ext] ?? 'plaintext';
  }
}

/** fileURLToPath polyfill (Node.js built-in URL already has fileURLToPath) */
function fileURLToPath(uri: string): string {
  return new URL(uri).pathname;
}
