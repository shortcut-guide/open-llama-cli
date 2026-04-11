// src/controller/command/reviewCommand.ts
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';

import { runReviewerAgent } from '../../agents/reviewer/index.js';
import { getConfig } from '../../config/index.js';
import type { ReviewResult } from '../../agents/types.js';

const MAX_DIFF_LINES = 500;

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getDiff(staged: boolean, files: string[]): string {
  const args = ['diff', '--color=never'];
  if (staged) {
    args.push('--staged');
  } else {
    args.push('HEAD');
  }
  if (files.length > 0) args.push('--', ...files);

  const result = spawnSync('git', args, { encoding: 'utf8' });
  return (result.stdout ?? '').trim();
}

function displayReviewForDiff(result: ReviewResult): void {
  console.log('');

  if (result.approved && (!result.issues || result.issues.length === 0)) {
    console.log(chalk.green('  ✅ 問題なし: コードは良好です'));
  } else {
    console.log(chalk.yellow('  レビュー結果:'));
  }

  if (result.issues && result.issues.length > 0) {
    console.log('');
    console.log(chalk.red('  ⚠️  警告 / 問題点:'));
    result.issues.forEach((issue) => {
      console.log(chalk.red(`    • ${issue}`));
    });
  }

  if (result.suggestions && result.suggestions.length > 0) {
    console.log('');
    console.log(chalk.cyan('  💡 提案:'));
    result.suggestions.forEach((suggestion) => {
      console.log(chalk.cyan(`    • ${suggestion}`));
    });
  }

  if (result.hints && result.hints.length > 0) {
    console.log('');
    console.log(chalk.blue('  💡 ヒント:'));
    result.hints.forEach((hint) => {
      const formatted = hint.trim().split('\n').join('\n      ');
      console.log(chalk.blue(`    • ${formatted}`));
    });
  }

  console.log('');
}

/**
 * /review [--staged] [<file>...]
 *
 * --staged : git diff --staged をレビュー（デフォルトは git diff HEAD）
 * <file>   : 特定ファイルのみレビュー
 */
export async function handleReviewCommand(input: string): Promise<boolean> {
  if (!isGitRepo()) {
    console.log(chalk.red('  ❌ git リポジトリが見つかりません'));
    return true;
  }

  const parts = input.split(/\s+/).slice(1); // "/review" を除去
  const staged = parts.includes('--staged');
  const files = parts.filter((p) => !p.startsWith('--'));

  const diff = getDiff(staged, files);

  if (!diff) {
    const target = staged ? 'ステージ済み変更' : 'HEAD との差分';
    console.log(chalk.gray(`  変更なし（${target}）`));
    return true;
  }

  const lines = diff.split('\n');
  let diffToReview = diff;
  if (lines.length > MAX_DIFF_LINES) {
    diffToReview = lines.slice(0, MAX_DIFF_LINES).join('\n');
    console.log(chalk.yellow(
      `\n  ⚠️  差分が大きいため先頭 ${MAX_DIFF_LINES} 行のみをレビューします（全 ${lines.length} 行）\n`
    ));
  }

  const target = staged ? 'ステージ済み変更' : 'HEAD との差分';
  const fileLabel = files.length > 0 ? ` (${files.join(', ')})` : '';
  console.log(chalk.cyan(`\n  🔍 AIレビュー中... ${target}${fileLabel}\n`));

  const config = getConfig();

  try {
    const agentResult = await runReviewerAgent({
      userTask: `以下のgit差分をコードレビューしてください。バグ、セキュリティ問題、コード品質の観点で確認してください。`,
      code: diffToReview,
      iterationCount: 1,
      llmUrl: config.LLM_BONSAI_URL,
    });

    const reviewResult: ReviewResult = JSON.parse(agentResult.output);
    displayReviewForDiff(reviewResult);
  } catch (e: unknown) {
    console.error(chalk.red(`\n  ❌ レビューエラー: ${(e as Error).message}\n`));
  }

  return true;
}
