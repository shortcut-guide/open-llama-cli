// src/model/lsp/types.ts

export interface LspServerConfig {
  name: string;
  command: string;
  args?: string[];
  /** File extensions handled by this server, e.g. [".ts", ".tsx"] */
  extensions: string[];
}

export interface LspConfig {
  servers: LspServerConfig[];
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface LspDiagnostic {
  file: string;
  line: number;
  character: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
}

export interface LspServerStatus {
  name: string;
  running: boolean;
  pid?: number;
  extensions: string[];
  error?: string;
}

// Minimal LSP protocol types (subset of LSP 3.17 spec)

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface ProtocolDiagnostic {
  range: Range;
  severity?: 1 | 2 | 3 | 4; // 1=error, 2=warning, 3=info, 4=hint
  message: string;
  source?: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: ProtocolDiagnostic[];
}
