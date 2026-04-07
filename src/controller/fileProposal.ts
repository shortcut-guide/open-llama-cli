// src/controller/fileProposal.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { readFileContent, writeFile } from '../model/file.js';
import { callLLM, type Message } from '../model/llm.js';

const originalLineCountCache = new Map<string, number>();

export function getLineCountCache(): Map<string, number> {
  return originalLineCountCache;
}

export function extractFileBlocks(message: string): { filePath: string; content: string }[] {
  const FILE_BLOCK_RE = /```file:([^\n]+)\n([\s\S]*?)```/g;
  const results: { filePath: string; content: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(message)) !== null) {
    results.push({ filePath: match[1].trim(), content: match[2] });
  }
  return results;
}

const SANITY_RATIO = 0.5;
const RETRY_CHUNK_LINES = 20;
const MAX_RETRY = 5;

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

  let originalLines = originalLineCountCache.get(filePath);
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

async function fetchFileContentInChunks(
  filePath: string,
  originalContent: string,
  history: Message[]
): Promise<string> {
  const totalLines = originalContent.split('\n').length;
  let assembled = '';
  let startLine = 1;
  let retryCount = 0;

  console.log(chalk.yellow(`\n  🔄 チャンク分割モードで再取得します (${totalLines}行 / ${RETRY_CHUNK_LINES}行ずつ)\n`));

  while (startLine <= totalLines && retryCount < MAX_RETRY) {
    const endLine = Math.min(startLine + RETRY_CHUNK_LINES - 1, totalLines);
    const isLast = endLine >= totalLines;

    const chunkPrompt =
      `前回のリファクタリング済みコードを ${startLine}行目から${endLine}行目まで出力してください。` +
      `コードブロック（\`\`\`tsx や \`\`\`typescript）で囲んで出力してください。` +
      (isLast ? '（これが最終チャンクです）' : '');

    console.log(chalk.gray(`  📦 チャンク取得: L${startLine}-L${endLine}...`));

    const chunkHistory: Message[] = [
      ...history,
      { role: 'user', content: chunkPrompt },
    ];

    try {
      const chunkResponse = await callLLM(chunkHistory, { printStream: false });
      const codeMatch = chunkResponse.match(/```(?:tsx|typescript|ts)?\n?([\s\S]*?)```/);
      if (codeMatch && codeMatch[1].trim().length > 0) {
        assembled += (assembled ? '\n' : '') + codeMatch[1].trimEnd();
        startLine = endLine + 1;
        retryCount = 0;
      } else {
        retryCount++;
        console.log(chalk.yellow(`  ⚠️  チャンク取得失敗 (${retryCount}/${MAX_RETRY})、リトライ...`));
      }
    } catch {
      retryCount++;
    }
  }

  return assembled;
}

export async function handleFileEditProposals(
  assistantMessage: string,
  history: Message[],
  rl: readline.Interface,
  autoWrite: boolean
): Promise<void> {
  const proposals = extractFileBlocks(assistantMessage);
  if (proposals.length === 0) return;

  console.log(chalk.yellow(`\n📝 ${proposals.length}件のファイルブロックを検知:\n`));

  const resolvedProposals: { filePath: string; content: string }[] = [];
  for (const p of proposals) {
    const lines = p.content.trim().split('\n').length;
    const isEmpty = p.content.trim().length === 0;
    const isTooShort =
      (originalLineCountCache.get(p.filePath) ?? 0) > 0 &&
      lines < (originalLineCountCache.get(p.filePath) ?? 0) * SANITY_RATIO;

    if (isEmpty || isTooShort) {
      console.log(
        chalk.yellow(`  ⚠️  [${p.filePath}] 内容が不十分 (${isEmpty ? '空' : lines + '行'})。チャンクリトライを開始します...`)
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
    for (const p of resolvedProposals) {
      const ok = await sanityCheckWrite(p.filePath, p.content, rl);
      if (!ok) continue;
      try {
        await writeFile(p.filePath, p.content);
        console.log(chalk.green(`  ✅ 自動保存: ${p.filePath}`));
      } catch (e: unknown) {
        console.error(chalk.red(`  ❌ 保存失敗 [${p.filePath}]: ${(e as Error).message}`));
      }
    }
    return;
  }

  const answer = await rl.question(
    chalk.yellow('\n適用しますか？ [y=全件 / N=スキップ / 番号=選択]: ')
  );
  const trimmedAns = answer.trim().toLowerCase();

  if (trimmedAns === 'y' || trimmedAns === 'yes') {
    for (const p of resolvedProposals) {
      const ok = await sanityCheckWrite(p.filePath, p.content, rl);
      if (!ok) continue;
      try {
        await writeFile(p.filePath, p.content);
        console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
      } catch (e: unknown) {
        console.error(chalk.red(`  ❌ 保存失敗: ${(e as Error).message}`));
      }
    }
  } else if (/^\d+$/.test(trimmedAns)) {
    const idx = parseInt(trimmedAns, 10) - 1;
    if (idx >= 0 && idx < resolvedProposals.length) {
      const p = resolvedProposals[idx];
      const ok = await sanityCheckWrite(p.filePath, p.content, rl);
      if (ok) {
        try {
          await writeFile(p.filePath, p.content);
          console.log(chalk.green(`  ✅ 保存: ${p.filePath}`));
        } catch (e: unknown) {
          console.error(chalk.red(`  ❌ 保存失敗: ${(e as Error).message}`));
        }
      }
    } else {
      console.log(chalk.red('  ❌ 無効な番号です。'));
    }
  } else {
    console.log(chalk.gray('  スキップしました。'));
  }
}
