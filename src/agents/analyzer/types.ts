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
