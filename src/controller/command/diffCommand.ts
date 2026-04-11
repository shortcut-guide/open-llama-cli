// src/controller/command/diffCommand.ts
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';

import { CommandContext } from './types.js';
import { setPendingFileContext } from '../state/index.js';

/** git diff の1行をカラーリングして返す */
function colorLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return chalk.white(line);
  if (line.startsWith('+'))  return chalk.green(line);
  if (line.startsWith('-'))  return chalk.red(line);
  if (line.startsWith('@@')) return chalk.cyan(line);
  if (line.startsWith('diff --git') || line.startsWith('index ')) return chalk.yellow(line);
  return line;
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runGitDiff(args: string[]): { output: string; empty: boolean } {
  const result = spawnSync('git', ['diff', '--color=never', ...args], {
    encoding: 'utf8',
  });
  const output = (result.stdout ?? '').trim();
  return { output, empty: output.length === 0 };
}

/**
 * /diff [--staged] [--review] [<file>...]
 *
 * --staged  : git diff --staged
 * --review  : diff を LLM コンテキストに追加してレビューを依頼
 * <file>    : 特定ファイルの差分のみ表示
 */
export async function handleDiffCommand(
  input: string,
  ctx: CommandContext
): Promise<boolean> {
  if (!isGitRepo()) {
    console.log(chalk.red('  ❌ git リポジトリが見つかりません'));
    return true;
  }

  const parts = input.split(/\s+/).slice(1); // "/diff" を除去
  const staged  = parts.includes('--staged');
  const review  = parts.includes('--review');
  const files   = parts.filter(p => !p.startsWith('--'));

  const diffArgs: string[] = [];
  if (staged) diffArgs.push('--staged');
  if (files.length > 0) diffArgs.push('--', ...files);

  const { output, empty } = runGitDiff(diffArgs);

  if (empty) {
    const target = staged ? 'ステージ済み変更' : '変更';
    console.log(chalk.gray(`  変更なし（${target}）`));
    return true;
  }

  // カラー表示
  const MAX_DISPLAY_LINES = 300;
  const lines = output.split('\n');
  const truncated = lines.length > MAX_DISPLAY_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_DISPLAY_LINES) : lines;

  console.log('');
  for (const line of displayLines) {
    console.log(colorLine(line));
  }
  if (truncated) {
    console.log(chalk.yellow(`\n  … 表示を ${MAX_DISPLAY_LINES} 行に省略（全 ${lines.length} 行）`));
  }
  console.log('');

  // --review: 差分を pendingContext として LLM に渡す
  if (review) {
    const reviewPrompt = [
      '以下の git diff を確認してください。',
      staged ? '（ステージ済み変更）' : '（作業ツリーの変更）',
      '',
      '```diff',
      output,
      '```',
      '',
      '変更内容の概要、潜在的な問題点、改善提案があれば教えてください。',
    ].join('\n');

    setPendingFileContext(reviewPrompt);

    // 直後の LLM ターンに自動送信
    ctx.history.push({ role: 'user', content: reviewPrompt });
    console.log(chalk.cyan('  📋 差分をコンテキストに追加しました。LLM にレビューを依頼します…\n'));
  }

  return true;
}
