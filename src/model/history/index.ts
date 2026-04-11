// src/model/history/index.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Message } from '../llm/index.js';
import { getCurrentHistoryPath } from '../session/index.js';

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

async function getHistoryFile(): Promise<string> {
  try {
    return await getCurrentHistoryPath();
  } catch {
    return HISTORY_FILE;
  }
}

export async function loadHistory(systemPrompt: string): Promise<Message[]> {
  const file = await getHistoryFile();
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [{ role: 'system', content: systemPrompt }];
  }
}

export async function saveHistory(history: Message[]): Promise<void> {
  const file = await getHistoryFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(history, null, 2), 'utf-8');
  } catch {
    console.error(chalk.red('\n⚠️ 履歴の保存に失敗しました。'));
  }
}

export async function clearHistory(): Promise<void> {
  const file = await getHistoryFile();
  await fs.unlink(file);
}

/**
 * Removes the last user + assistant message pair from the history file.
 * Returns true if a pair was removed, false if there was nothing to remove.
 */
export async function rewindHistory(): Promise<boolean> {
  const file = await getHistoryFile();
  const history = await loadHistoryRaw(file);
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

  await fs.writeFile(file, JSON.stringify(rewound, null, 2), 'utf-8');
  return true;
}

async function loadHistoryRaw(file?: string): Promise<Message[]> {
  const historyFile = file ?? await getHistoryFile();
  try {
    const data = await fs.readFile(historyFile, 'utf-8');
    return JSON.parse(data) as Message[];
  } catch {
    return [];
  }
}
