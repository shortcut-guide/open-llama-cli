import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { deleteFile } from '../../../model/file.js';

export async function handleDeleteCommand(trimmed: string, rl: readline.Interface): Promise<boolean> {
  const filePath = trimmed.slice(8).trim();
  const answer = await rl.question(chalk.red(`\n⚠️  ${filePath} を削除しますか？ [y/N]: `));

  if (answer.trim().toLowerCase() === 'y') {
    try {
      await deleteFile(filePath);
      console.log(chalk.green(`  ✅ 削除しました: ${filePath}`));
    } catch (e: unknown) {
      console.error(chalk.red(`  ❌ 削除失敗: ${(e as Error).message}`));
    }
  } else {
    console.log(chalk.gray('  キャンセルしました。'));
  }

  return true;
}
