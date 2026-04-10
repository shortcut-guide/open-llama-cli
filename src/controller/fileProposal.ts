// src/controller/fileProposal.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { readFileContent, writeFile } from '../model/file.js';
import { type Message } from '../model/llm.js';
import { extractFileBlocks } from './fileProposal/extractFileBlocks.js';
import { sanityCheckWrite, SANITY_RATIO } from './fileProposal/sanityCheck.js';
import { fetchFileContentInChunks } from './fileProposal/chunkFetcher.js';
import { getCachedLineCount } from './fileProposal/lineCountCache.js';

// lineCountCache の公開 API は lineCountCache.ts から直接 import して使用してください
export { getLineCountCache, getCachedLineCount, setCachedLineCount } from './fileProposal/lineCountCache.js';
export { extractFileBlocks } from './fileProposal/extractFileBlocks.js';
export { sanityCheckWrite } from './fileProposal/sanityCheck.js';

export async function handleFileEditProposals(
  assistantMessage: string,
  history: Message[],
  rl: readline.Interface,
  autoWrite: boolean,
  excludePathPrefixes: string[] = []
): Promise<void> {
  const allProposals = extractFileBlocks(assistantMessage);
  const proposals = excludePathPrefixes.length > 0
    ? allProposals.filter((p) => !excludePathPrefixes.some((prefix) => p.filePath.startsWith(prefix)))
    : allProposals;
  if (proposals.length === 0) return;

  console.log(chalk.yellow(`\n📝 ${proposals.length}件のファイルブロックを検知:\n`));

  const resolvedProposals: { filePath: string; content: string }[] = [];

  for (const p of proposals) {
    const lines = p.content.trim().split('\n').length;
    const isEmpty = p.content.trim().length === 0;
    const cachedLines = getCachedLineCount(p.filePath) ?? 0;
    const isTooShort = cachedLines > 0 && lines < cachedLines * SANITY_RATIO;

    if (isEmpty || isTooShort) {
      console.log(
        chalk.yellow(
          `  ⚠️  [${p.filePath}] 内容が不十分 (${isEmpty ? '空' : lines + '行'})。チャンクリトライを開始します...`
        )
      );
      let originalContent = '';
      try { originalContent = await readFileContent(p.filePath); } catch {}
      const recovered = await fetchFileContentInChunks(p.filePath, originalContent, history);
      if (recovered.trim().length > 0) {
        console.log(chalk.green(`  ✅ チャンク結合完了: ${recovered.split('\n').length}行`));
        resolvedProposals.push({ filePath: p.filePath, content: recovered });
      } else {
        console.log(chalk.red(`  ❌ チャンク取得に失敗しました。スキップ: ${p.filePath}`));
      }
    } else {
      console.log(chalk.cyan(`  [${p.filePath}]`) + chalk.gray(` (${lines}行)`));
      resolvedProposals.push(p);
    }
  }

  if (resolvedProposals.length === 0) return;

  if (autoWrite) {
    await writeProposals(resolvedProposals, rl);
    return;
  }

  const answer = await rl.question(
    chalk.yellow('\n適用しますか？ [y=全件 / N=スキップ / 番号=選択]: ')
  );
  const trimmedAns = answer.trim().toLowerCase();

  if (trimmedAns === 'y' || trimmedAns === 'yes') {
    await writeProposals(resolvedProposals, rl);
  } else if (/^\d+$/.test(trimmedAns)) {
    const idx = parseInt(trimmedAns, 10) - 1;
    if (idx >= 0 && idx < resolvedProposals.length) {
      await writeSingle(resolvedProposals[idx], rl);
    } else {
      console.log(chalk.red('  ❌ 無効な番号です。'));
    }
  } else {
    console.log(chalk.gray('  スキップしました。'));
  }
}

async function writeProposals(
  proposals: { filePath: string; content: string }[],
  rl: readline.Interface
): Promise<void> {
  for (const p of proposals) {
    await writeSingle(p, rl);
  }
}

async function writeSingle(
  p: { filePath: string; content: string },
  rl: readline.Interface
): Promise<void> {
  const ok = await sanityCheckWrite(p.filePath, p.content, rl);
  if (!ok) return;
  try {
    await writeFile(p.filePath, p.content);
    console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
  } catch (e: unknown) {
    console.error(chalk.red(`  ❌ 保存失敗 [${p.filePath}]: ${(e as Error).message}`));
  }
}
