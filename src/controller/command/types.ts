// src/controller/types.ts
import { Message } from '../../model/llm.js';

export type TaskType = 'new' | 'refactor' | 'fix' | 'extend' | 'analyze' | 'gsd' | null;

export interface AgentCommand {
  type: TaskType;
  rawInput: string;
}

export interface CommandContext {
  history: Message[];
  fullSystemPrompt: string;
}
