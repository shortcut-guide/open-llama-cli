// src/agents/analyzer/types.ts

export type FunctionInfo = {
  name: string;
  startLine: number;
  endLine: number;
  description: string;
};

export type FileAnalysis = {
  path: string;
  exports: string[];
  dependencies: string[];
  functions: FunctionInfo[];
};

export function isFileAnalysis(obj: unknown): obj is FileAnalysis {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.path === 'string' &&
    Array.isArray(o.exports) &&
    Array.isArray(o.dependencies) &&
    Array.isArray(o.functions)
  );
}
