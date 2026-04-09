// src/controller/fileCommands.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { searchFiles, readFileContent, writeFile, replaceLines, deleteFile } from '../../model/file.js';
import { getLineCountCache } from '../fileProposal.js';
import { setPendingFileContext } from '../state.js';

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
