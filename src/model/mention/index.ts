// src/model/mention/index.ts
import * as fs from 'node:fs/promises';
import chalk from 'chalk';
import { resolveSafe } from '../file/index.js';
import { getWorkspaceRoot } from '../file/index.js';
import * as path from 'node:path';

const MENTION_PATTERN = /@([\w./\-\\]+)/g;
const LARGE_FILE_THRESHOLD = 50 * 1024; // 50KB

export interface MentionResult {
  /** Expanded message content, or null if an error occurred and the send should be aborted */
  content: string | null;
}

async function isBinaryBuffer(buf: Buffer): Promise<boolean> {
  // Check for null bytes — a simple heuristic for binary files
  return buf.includes(0);
}

/**
 * Scans a user message for @path patterns, reads each file, and expands
 * them inline. Returns the expanded content, or null on fatal error.
 */
export async function expandMentions(message: string): Promise<MentionResult> {
  const matches = [...message.matchAll(MENTION_PATTERN)];
  if (matches.length === 0) return { content: message };

  const root = getWorkspaceRoot();
  let result = message;

  for (const match of matches) {
    const rawPath = match[1];
    const mention = match[0]; // e.g. "@src/index.ts"

    let absPath: string;
    try {
      absPath = resolveSafe(rawPath);
    } catch {
      console.error(chalk.red(`\n❌ @メンション: ワークスペース外のパスはアクセスできません: ${rawPath}\n`));
      return { content: null };
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(absPath);
    } catch {
      console.error(chalk.red(`\n❌ @メンション: ファイルが見つかりません: ${rawPath}\n`));
      return { content: null };
    }

    if (await isBinaryBuffer(buf)) {
      console.error(chalk.red(`\n❌ @メンション: バイナリファイルはメンションできません: ${rawPath}\n`));
      return { content: null };
    }

    if (buf.length > LARGE_FILE_THRESHOLD) {
      console.warn(chalk.yellow(`\n⚠️  @メンション: ファイルが大きいです (${(buf.length / 1024).toFixed(1)}KB): ${rawPath} — トークン消費が増加します\n`));
    }

    const relPath = path.relative(root, absPath);
    const fileContent = buf.toString('utf-8');
    const block = `\n【ファイル: ${relPath}】\n\`\`\`\n${fileContent}\n\`\`\``;
    result = result.replace(mention, block);
  }

  return { content: result };
}
