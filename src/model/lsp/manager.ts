// src/model/lsp/manager.ts
// Singleton manager for all LSP server clients
import * as path from 'node:path';

import { loadLspConfig } from './config.js';
import { LspClient } from './client.js';
import type { LspDiagnostic, LspServerStatus } from './types.js';

let clients: LspClient[] = [];
let workspaceRoot = process.cwd();
let initialized = false;

export function setLspWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

/**
 * Loads LSP config and starts any configured servers.
 * Safe to call multiple times — only initializes once.
 */
export async function initLsp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const config = await loadLspConfig(workspaceRoot);
  clients = config.servers.map(s => new LspClient(s, workspaceRoot));

  // Start servers eagerly but don't block startup on failures
  await Promise.all(
    clients.map(c =>
      c.start().catch((e: unknown) => {
        // Errors are stored in client status; don't crash the app
        void e;
      })
    )
  );
}

/** Returns status of all configured LSP servers */
export function getLspStatus(): LspServerStatus[] {
  return clients.map(c => c.getStatus());
}

/**
 * Returns LSP diagnostics for a file.
 * Finds the matching server by file extension.
 * Returns empty array if no server handles the file or LSP is not configured.
 */
export async function getLspDiagnosticsForFile(filePath: string): Promise<LspDiagnostic[]> {
  if (clients.length === 0) return [];

  const ext = path.extname(filePath).toLowerCase();
  const client = clients.find(c => c.isRunning && c.extensions.includes(ext));
  if (!client) return [];

  try {
    return await client.getDiagnostics(filePath);
  } catch {
    return [];
  }
}

/** Stops all LSP clients gracefully */
export async function stopAllLsp(): Promise<void> {
  await Promise.all(clients.map(c => c.stop().catch(() => {})));
  clients = [];
  initialized = false;
}

/** Returns true if at least one LSP server is configured */
export function hasLspConfig(): boolean {
  return clients.length > 0;
}
