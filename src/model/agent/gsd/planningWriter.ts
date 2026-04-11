// src/model/agent/gsd/planningWriter.ts
import chalk from 'chalk';
import { extractFileBlocks } from '../../../controller/fileProposal.js';
import { writePlanningFile } from '../../gsd.js';

export async function writePlanningBlocks(
  output: string,
  planningRoot: string
): Promise<string[]> {
  const blocks = extractFileBlocks(output);
  const written: string[] = [];

  for (const block of blocks) {
    let rel: string;

    if (block.filePath.startsWith('.planning/')) {
      rel = block.filePath.replace(/^\.planning\//, '');
    } else if (block.filePath.startsWith('phases/')) {
      rel = block.filePath;
    } else {
      continue;
    }

    try {
      await writePlanningFile(planningRoot, rel, block.content);
      written.push(rel);
      console.log(chalk.green(`  💾 .planning/${rel} を書き込みました`));
    } catch (e) {
      console.log(chalk.red(`  ❌ 書き込み失敗: ${rel} — ${(e as Error).message}`));
    }
  }

  return written;
}
