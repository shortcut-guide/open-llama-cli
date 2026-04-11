// src/model/lsp/config.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type { LspConfig } from './types.js';

const DEFAULT_CONFIG: LspConfig = { servers: [] };

async function readJsonFile(filePath: string): Promise<LspConfig | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'servers' in parsed) {
      return parsed as LspConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads LSP configuration by merging:
 * 1. ~/.lcli/lsp-config.json (user-level)
 * 2. .github/lsp.json (repository-level, takes precedence)
 */
export async function loadLspConfig(workspaceRoot: string): Promise<LspConfig> {
  const userConfigPath = path.join(os.homedir(), '.lcli', 'lsp-config.json');
  const repoConfigPath = path.join(workspaceRoot, '.github', 'lsp.json');

  const userConfig = await readJsonFile(userConfigPath);
  const repoConfig = await readJsonFile(repoConfigPath);

  if (!userConfig && !repoConfig) return DEFAULT_CONFIG;

  // Repo-level config overrides user-level: merge server lists, repo wins on name collision
  const userServers = userConfig?.servers ?? [];
  const repoServers = repoConfig?.servers ?? [];
  const repoNames = new Set(repoServers.map(s => s.name));
  const merged = [
    ...userServers.filter(s => !repoNames.has(s.name)),
    ...repoServers,
  ];

  return { servers: merged };
}
