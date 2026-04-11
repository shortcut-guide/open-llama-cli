// src/controller/sanityCheck.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { readFileContent } from '../../model/file/index.js';
import { getCachedLineCount } from './lineCountCache.js';

export const SANITY_RATIO = 0.5;

export async function sanityCheckWrite(
  filePath: string,
  proposedContent: string,
  rl: readline.Interface
): Promise<boolean> {
  const proposedLines = proposedContent.trim().split('\n').length;

  if (proposedContent.trim().length === 0) {
    console.log(chalk.red(`  ⛔ [安全ガード] 提案内容が空です。書き込みをブロック: ${filePath}`));
    return false;
  }

  let originalLines = getCachedLineCount(filePath);
  if (originalLines === undefined) {
    try {
      const existing = await readFileContent(filePath);
      originalLines = existing.split('\n').length;
    } catch {
      return true;
    }
  }

  if (proposedLines < originalLines * SANITY_RATIO) {
    console.log(
      chalk.red(
        `\n  ⛔ [安全ガード] 行数が大幅に減少しています。` +
        `\n     元: ${originalLines}行 → 提案: ${proposedLines}行` +
        ` (${Math.round((proposedLines / originalLines) * 100)}%)`
      )
    );
    console.log(chalk.yellow(`\n  提案内容の先頭20行:\n`));
    proposedContent.split('\n').slice(0, 20).forEach((l, i) =>
      console.log(chalk.gray(`  ${String(i + 1).padStart(3)}: ${l}`))
    );
    const force = await rl.question(
      chalk.red(`\n  強制的に書き込みますか？ [yes で続行 / それ以外でキャンセル]: `)
    );
    if (force.trim().toLowerCase() !== 'yes') {
      console.log(chalk.gray('  ✋ 書き込みをキャンセルしました。'));
      return false;
    }
  }

  return true;
}
