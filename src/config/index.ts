// src/config.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';

export async function loadEnvFile(filePath: string): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    content.split('\n').forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) return;
      const [key, ...values] = trimmedLine.split('=');
      if (key && values) {
        const value = values.join('=').trim().replace(/^["']|["']$/g, '');
        process.env[key.trim()] = value;
      }
    });
    console.log(chalk.gray(`  Loaded config from: ${filePath}`));
  } catch {}
}

export async function initializeConfig(): Promise<void> {
  await loadEnvFile(path.join(os.homedir(), '.lcli.env'));
  await loadEnvFile(path.join(process.cwd(), '.env'));
}

export interface Config {
  LLM_API_URL: string;
  LLM_BONSAI_URL: string;
  LLM_GEMMA_URL: string;
  TEMPERATURE: number;
  MAX_TOKENS: number;
  WORKSPACE_ROOT: string;
  AUTO_WRITE_DEFAULT: boolean;
  SYSTEM_PROMPT: string;
  MAX_REVIEW_ITERATIONS: number;
  INPUT_HISTORY_MAX: number;
}

export function getConfig(): Config {
  return {
    LLM_API_URL: process.env.LLM_API_URL || 'https://phis.jp/v1/chat/completions',
    LLM_BONSAI_URL: process.env.LLM_BONSAI_URL || 'https://phis.jp/v1/chat/completions',
    LLM_GEMMA_URL: process.env.LLM_GEMMA_URL || 'https://gemma.phis.jp/v1/chat/completions',
    TEMPERATURE: parseFloat(process.env.TEMPERATURE || '0.7'),
    MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '4096', 10),
    WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || process.cwd(),
    AUTO_WRITE_DEFAULT: process.env.AUTO_WRITE === 'true' || process.env.AUTO_WRITE === '1',
    SYSTEM_PROMPT: process.env.SYSTEM_PROMPT || 'あなたは優秀なAIアシスタントです。',
    MAX_REVIEW_ITERATIONS: parseInt(process.env.MAX_REVIEW_ITERATIONS || '3', 10),
    INPUT_HISTORY_MAX: parseInt(process.env.INPUT_HISTORY_MAX || '500', 10),
  };
}
