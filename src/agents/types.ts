// src/agents/types.ts
import type { Message } from '../model/llm.js';
export type TaskType = 'new' | 'refactor' | 'fix' | 'extend' | 'analyze' | 'gsd';

export interface GsdTask {
  name: string;
  files: string[];
  action: string;
  verification: string;
}

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'fixer' | 'analyzer';

export interface AgentContext {
  userTask: string;
  taskType?: TaskType;
  agentRole?: AgentRole; // 追加
  plan?: string;
  gsdTask?: GsdTask;
  sourceCode?: string;
  code?: string;
  reviewResult?: ReviewResult;
  fixedCode?: string;
  iterationCount: number;
  fileTargets?: string[];
  priorityFixes?: string[];
  sourcePath?: string;
  llmUrl?: string;
}

