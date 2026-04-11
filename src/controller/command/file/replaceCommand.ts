import chalk from 'chalk';
import { replaceLines } from '../../../model/file.js';

export async function handleReplaceCommand(trimmed: string): Promise<boolean> {
  const rest = trimmed.slice(9).trim();
  const sepIdx = rest.indexOf(' ');

  if (sepIdx === -1) {
    console.error(chalk.red('  使用法: /replace <filePath> <search> => <replace>'));
    return true;
  }

  const filePath = rest.slice(0, sepIdx).trim();
  const expr = rest.slice(sepIdx + 1).trim();
  const arrowIdx = expr.indexOf('=>');

  if (arrowIdx === -1) {
    console.error(chalk.red('  使用法: /replace <filePath> <search> => <replace>'));
    return true;
  }

  const searchText = expr.slice(0, arrowIdx).trim();
  const replaceText = expr.slice(arrowIdx + 2).trim();

  try {
    const count = await replaceLines(filePath, searchText, replaceText);
    console.log(chalk.green(`  ✅ ${count}箇所を置換しました: ${filePath}`));
  } catch (e: unknown) {
    console.error(chalk.red(`  ❌ 置換失敗: ${(e as Error).message}`));
  }

  return true;
}
