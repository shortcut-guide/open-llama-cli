// src/model/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpConfig } from './config.js';
import type { McpServerState, McpToolInfo } from './types.js';

// Runtime state: name -> { client, state }
const serverStates = new Map<string, { client: Client; transport: StdioClientTransport; state: McpServerState }>();

export function getServerStates(): McpServerState[] {
  return Array.from(serverStates.values()).map(e => e.state);
}

export function getServerState(name: string): McpServerState | undefined {
  return serverStates.get(name)?.state;
}

export async function connectServer(name: string): Promise<McpServerState> {
  const config = await loadMcpConfig();
  const serverConfig = config.servers[name];
  if (!serverConfig) throw new Error(`MCP server "${name}" not found in config`);

  // Disconnect if already connected
  if (serverStates.has(name)) await disconnectServer(name);

  const state: McpServerState = {
    name,
    config: serverConfig,
    status: 'connecting',
    tools: [],
  };
  serverStates.set(name, { client: null as unknown as Client, transport: null as unknown as StdioClientTransport, state });

  try {
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env ? { ...process.env, ...serverConfig.env } as Record<string, string> : undefined,
      stderr: 'pipe',
    });

    const client = new Client({ name: 'open-llama-cli', version: '1.0.0' });
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools: McpToolInfo[] = toolsResult.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    state.status = 'connected';
    state.tools = tools;
    serverStates.set(name, { client, transport, state });
  } catch (err) {
    state.status = 'error';
    state.error = (err as Error).message;
    serverStates.set(name, { client: null as unknown as Client, transport: null as unknown as StdioClientTransport, state });
  }

  return state;
}

export async function disconnectServer(name: string): Promise<void> {
  const entry = serverStates.get(name);
  if (!entry) return;
  try {
    if (entry.state.status === 'connected') {
      await entry.client.close();
    }
  } catch {
    // ignore close errors
  }
  serverStates.delete(name);
}

export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const entry = serverStates.get(serverName);
  if (!entry || entry.state.status !== 'connected') {
    throw new Error(`MCP server "${serverName}" is not connected`);
  }
  const result = await entry.client.callTool({ name: toolName, arguments: args });
  return result;
}

export async function getAllConnectedTools(): Promise<Array<{ server: string; tool: McpToolInfo }>> {
  const result: Array<{ server: string; tool: McpToolInfo }> = [];
  for (const [name, entry] of serverStates) {
    if (entry.state.status === 'connected') {
      for (const tool of entry.state.tools) {
        result.push({ server: name, tool });
      }
    }
  }
  return result;
}

export async function disconnectAll(): Promise<void> {
  for (const name of serverStates.keys()) {
    await disconnectServer(name);
  }
}
