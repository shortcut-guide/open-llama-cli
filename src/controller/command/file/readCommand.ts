import chalk from 'chalk';
import { readFileContent } from '../../../model/file/index.js';
import { getLineCountCache } from '../../fileProposal/index.js';
import { setPendingFileContext } from '../../state/index.js';

export async function handleReadCommand(trimmed: string): Promise<boolean> {
  const filePath = trimmed.slice(6).trim();
  try {
    const content = await readFileContent(filePath);
    const lines = content.split('\n');
    getLineCountCache().set(filePath, lines.length);

    console.log(chalk.blue(`\n📖 ${filePath} (${lines.length}行)\n`));
    lines.forEach((line, i) =>
      console.log(chalk.gray(`${String(i + 1).padStart(4)}: `) + line)
    );

    setPendingFileContext(
      `対象ファイル: \`${filePath}\` (${lines.length}行)\n\n` +
      '```\n' + content + '\n```\n\n' +
      `上記ファイルに対して次の指示を実行してください。` +
      `必ず \`\`\`file:${filePath}\`\`\` 形式でファイル全体を省略なく出力してください。`
    );

    console.log(chalk.gray(`\n  ℹ️  コンテキストを保持しました (${lines.length}行)。続けてタスクを入力してください。\n`));
  } catch (e: unknown) {
    console.error(chalk.red(`  ❌ 読み込み失敗: ${(e as Error).message}`));
  }

  return true;
}
