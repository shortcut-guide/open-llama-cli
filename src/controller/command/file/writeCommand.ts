import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { writeFile } from '../../../model/file.js';

export async function handleWriteCommand(trimmed: string, rl: readline.Interface): Promise<boolean> {
  const filePath = trimmed.slice(7).trim();
  console.log(chalk.yellow(`\n✏️  ${filePath} の内容を入力（"EOF" で終了）:\n`));

  const lines: string[] = [];
  while (true) {
    const line = await rl.question('');
    if (line === 'EOF') break;
    lines.push(line);
  }

  await writeFile(filePath, lines.join('\n'));
  console.log(chalk.green(`  ✅ 保存しました: ${filePath}`));
  return true;
}
