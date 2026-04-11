// src/model/mcp/config.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { McpConfig, McpServerConfig } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.lcli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'mcp-config.json');

export function getMcpConfigPath(): string {
  return CONFIG_PATH;
}

export async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as McpConfig;
  } catch {
    return { servers: {} };
  }
}

export async function saveMcpConfig(config: McpConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function addMcpServer(name: string, serverConfig: McpServerConfig): Promise<void> {
  const config = await loadMcpConfig();
  config.servers[name] = serverConfig;
  await saveMcpConfig(config);
}

export async function removeMcpServer(name: string): Promise<boolean> {
  const config = await loadMcpConfig();
  if (!config.servers[name]) return false;
  delete config.servers[name];
  await saveMcpConfig(config);
  return true;
}
