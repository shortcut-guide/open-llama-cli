// src/agents/types.ts
import type { Message } from '../model/llm.js';
export type TaskType = 'new' | 'refactor' | 'fix' | 'extend' | 'analyze';
export interface AgentContext {
  userTask: string;
  taskType?: TaskType;
  plan?: string;
  sourceCode?: string;
  code?: string;
  reviewResult?: ReviewResult;
  fixedCode?: string;
  iterationCount: number;
  fileTargets?: string[];
  priorityFixes?: string[];
  sourcePath?: string;
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  hints?: string[];
  priority_fixes?: string[];
  fileCount?: number;
  directoryCheck?: {
    types?: boolean;
    services?: boolean;
    hooks?: boolean;
    components?: boolean;
  };
  raw: string;
}

export interface AgentResult {
  agentName: string;
  output: string;
  messages: Message[];
}

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'fixer';
