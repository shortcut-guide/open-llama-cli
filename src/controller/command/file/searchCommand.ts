import chalk from 'chalk';
import { searchFiles } from '../../../model/file.js';

export async function handleSearchCommand(trimmed: string): Promise<boolean> {
  const args = trimmed.slice(8).trim();
  const contentMatch = args.match(/--content\s+(.+)$/);
  const contentRegex = contentMatch ? contentMatch[1].trim() : undefined;
  const pattern = contentRegex ? args.replace(/--content\s+.+$/, '').trim() : args;

  console.log(chalk.blue(`\n🔍 検索中: ${pattern}${contentRegex ? ` (内容: ${contentRegex})` : ''}\n`));
  const results = await searchFiles(pattern, contentRegex);

  if (results.length === 0) {
    console.log(chalk.gray('  一致するファイルが見つかりませんでした。'));
  } else {
    results.forEach((r) => {
      console.log(chalk.cyan(`  📄 ${r.filePath}`));
      r.matchedLines?.forEach((l) => console.log(chalk.gray(l)));
    });
    console.log(chalk.gray(`\n  ${results.length}件`));
  }

  return true;
}
