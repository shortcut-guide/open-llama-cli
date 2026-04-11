import chalk from 'chalk';
import type { ReviewResult } from '../types.js';

export function displayReviewResult(reviewResult: ReviewResult, iterationCount: number): void {
  if (reviewResult.approved) {
    console.log(chalk.green('\n  ✅ レビュー結果: 承認'));
    return;
  }

  console.log(chalk.red(`\n  ❌ レビュー結果: 要修正 (イテレーション ${iterationCount})`));
  reviewResult.issues?.forEach((issue) => console.log(chalk.red(`    - ${issue}`)));

  if (reviewResult.hints.length > 0) {
    console.log(chalk.cyan('    💡 ヒント (Code Snippets):'));
    reviewResult.hints.forEach((hint) => {
      console.log(chalk.cyan(`      ${hint.trim().split('\n').join('\n      ')}`));
    });
  }
}
