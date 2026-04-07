// src/agents/types.ts
import type { Message } from '../model/llm.js';

export interface AgentContext {
  userTask: string;
  plan?: string;
  code?: string;
  reviewResult?: ReviewResult;
  fixedCode?: string;
  iterationCount: number;
  fileTargets?: string[];
  priorityFixes?: string[];
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
  priority_fixes?: string[];
  raw: string;
}

export interface AgentResult {
  agentName: string;
  output: string;
  messages: Message[];
}

export type AgentRole = 'planner' | 'coder' | 'reviewer' | 'fixer';
