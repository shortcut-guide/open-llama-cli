// src/model/history.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Message } from '../llm/index.js';

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
