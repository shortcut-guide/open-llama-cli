// src/model/gsd/types.ts

export interface GsdCommand {
  name: string;
  description: string;
  prompt: string;
}

export interface GsdContext {
  command: GsdCommand;
  resolvedPrompt: string;       // $ARGUMENTS 展開 + @path インライン展開済み
  contextFiles: Map<string, string>; // @path → file content
  planningRoot: string;         // <cwd>/.planning/
  gsdRoot: string;              // get-shit-done/ の絶対パス
}

export interface PreflightRequirement {
  file: string;           // planningRoot からの相対パス
  missingMessage: string; // ファイル不在時のエラーメッセージ
  suggestion: string;     // 解決策の提案コマンド
}
