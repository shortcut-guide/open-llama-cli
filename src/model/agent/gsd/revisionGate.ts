// src/model/agent/gsd/revisionGate.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { extractFileBlocks } from '../../../controller/fileProposal/index.js';

export function assessOutputQuality(output: string, commandName?: string): { pass: boolean; reason?: string } {
  if (!output || output.trim().length < 30) {
    return { pass: false, reason: '出力が空または短すぎます。' };
  }
  if (/^(error|エラー|失敗)/i.test(output.trim())) {
    return { pass: false, reason: 'LLM がエラーを返しました。' };
  }
  if (commandName === 'execute-phase') {
    const blocks = extractFileBlocks(output);
    const implBlocks = blocks.filter(
      (b) => !b.filePath.startsWith('.planning/') && !b.filePath.startsWith('phases/')
    );
    if (implBlocks.length === 0) {
      return {
        pass: false,
        reason:
          '実装ファイルが生成されていません。PLAN.md の各タスクを実行し、' +
          'ソースコードや設定ファイルを ```file:パス``` 形式で出力してください。' +
          '新しい PLAN.md の作成は禁止です。',
      };
    }
  }
  return { pass: true };
}

export async function runEscalationGate(
  rl: readline.Interface,
  reason: string,
  iteration: number,
  maxRevisions: number
): Promise<'retry' | 'skip' | 'abort'> {
  console.log(chalk.red(`\n⚠️  Revision Gate: ${iteration}/${maxRevisions} 回試行しましたが品質基準を満たしません。`));
  console.log(chalk.red(`   理由: ${reason}`));
  console.log(chalk.yellow('\n選択してください:'));
  console.log(chalk.gray('  [r] リトライ（追加プロンプトで再生成）'));
  console.log(chalk.gray('  [s] スキップ（この出力のまま続行）'));
  console.log(chalk.gray('  [a] 中断'));

  const answer = await rl.question(chalk.blue('> '));
  const ans = answer.trim().toLowerCase();

  if (ans === 'r' || ans === 'retry') return 'retry';
  if (ans === 's' || ans === 'skip') return 'skip';
  return 'abort';
}
