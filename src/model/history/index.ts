// src/model/history.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Message } from '../llm/index.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TokenUsage {
  systemTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
}

export function getTokenUsage(history: Message[], maxTokens: number): TokenUsage {
  const systemMsg = history.find(m => m.role === 'system');
  const systemTokens = systemMsg ? estimateTokens(systemMsg.content) : 0;
  const historyTokens = history
    .filter(m => m.role !== 'system')
    .reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const totalTokens = systemTokens + historyTokens;
  return {
    systemTokens,
    historyTokens,
    totalTokens,
    maxTokens,
    usagePercent: Math.round((totalTokens / maxTokens) * 100),
  };
}

const HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');

export async function loadHistory(systemPrompt: string): Promise<Message[]> {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [{ role: 'system', content: systemPrompt }];
  }
}

export async function saveHistory(history: Message[]): Promise<void> {
  try {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch {
    console.error(chalk.red('\n⚠️ 履歴の保存に失敗しました。'));
  }
}

export async function clearHistory(): Promise<void> {
  await fs.unlink(HISTORY_FILE);
}

/**
 * Removes the last user + assistant message pair from the history file.
 * Returns true if a pair was removed, false if there was nothing to remove.
 */
export async function rewindHistory(): Promise<boolean> {
  const history = await loadHistoryRaw();
  // Find the last assistant message
  let lastAssistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx < 0) return false;

  // Find the preceding user message
  let lastUserIdx = -1;
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (history[i].role === 'user') { lastUserIdx = i; break; }
  }

  const trimTo = lastUserIdx >= 0 ? lastUserIdx : lastAssistantIdx;
  const rewound = history.slice(0, trimTo);

  await fs.writeFile(HISTORY_FILE, JSON.stringify(rewound, null, 2), 'utf-8');
  return true;
}

async function loadHistoryRaw(): Promise<Message[]> {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data) as Message[];
  } catch {
    return [];
  }
}
