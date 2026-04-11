// src/model/mcp/types.ts

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpServerState {
  name: string;
  config: McpServerConfig;
  status: McpConnectionStatus;
  tools: McpToolInfo[];
  error?: string;
}
