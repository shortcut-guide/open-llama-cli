// src/controller/command.ts
import * as readline from 'node:readline/promises';
import * as fs from 'node:fs/promises';
import chalk from 'chalk';
import {
  searchFiles,
  readFileContent,
  writeFile,
  replaceLines,
  deleteFile,
} from '../model/file.js';
import { clearHistory } from '../model/history.js';
import { getLineCountCache } from './fileProposal.js';

let AUTO_WRITE: boolean = false;
export let pendingFileContext: string | null = null;

export function getAutoWrite(): boolean { return AUTO_WRITE; }
export function setAutoWrite(v: boolean): void { AUTO_WRITE = v; }
export function clearPendingFileContext(): void { pendingFileContext = null; }
export function getPendingFileContext(): string | null { return pendingFileContext; }

export async function handleCommand(
  userInput: string,
  rl: readline.Interface
): Promise<boolean> {
  const trimmed = userInput.trim();

  if (trimmed.startsWith('/autowrite')) {
    const arg = trimmed.slice(10).trim().toLowerCase();
    if (arg === 'on') AUTO_WRITE = true;
    else if (arg === 'off') AUTO_WRITE = false;
    else AUTO_WRITE = !AUTO_WRITE;
    console.log(
      AUTO_WRITE
        ? chalk.green('  🟢 自動書き込み: ON')
        : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）')
    );
    return true;
  }

  if (trimmed.startsWith('/search ')) {
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

  if (trimmed.startsWith('/read ')) {
    const filePath = trimmed.slice(6).trim();
    try {
      const content = await readFileContent(filePath);
      const lines = content.split('\n');
      getLineCountCache().set(filePath, lines.length);
      console.log(chalk.blue(`\n📖 ${filePath} (${lines.length}行)\n`));
      lines.forEach((line, i) =>
        console.log(chalk.gray(`${String(i + 1).padStart(4)}: `) + line)
      );
      pendingFileContext =
        `対象ファイル: \`${filePath}\` (${lines.length}行)\n\n` +
        '```\n' + content + '\n```\n\n' +
        `上記ファイルに対して次の指示を実行してください。` +
        `必ず \`\`\`file:${filePath}\`\`\` 形式でファイル全体を省略なく出力してください。`;
      console.log(chalk.gray(`\n  ℹ️  コンテキストを保持しました (${lines.length}行)。続けてタスクを入力してください。\n`));
    } catch (e: unknown) {
      console.error(chalk.red(`  ❌ 読み込み失敗: ${(e as Error).message}`));
    }
    return true;
  }

  if (trimmed.startsWith('/write ')) {
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

  if (trimmed.startsWith('/replace ')) {
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

  if (trimmed.startsWith('/delete ')) {
    const filePath = trimmed.slice(8).trim();
    const confirm = await rl.question(chalk.red(`\n⚠️  ${filePath} を削除しますか？ [y/N]: `));
    if (confirm.trim().toLowerCase() === 'y') {
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

  if (trimmed === '/clear') {
    try {
      await clearHistory();
      console.log(chalk.green('  ✅ 履歴をクリアしました。'));
    } catch {
      console.log(chalk.gray('  履歴ファイルが存在しません。'));
    }
    return true;
  }

  if (trimmed === '/help') {
    const autoStatus = AUTO_WRITE ? chalk.green('ON') : chalk.gray('OFF');
    console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────┐
│  コマンド一覧                                                      │
├────────────────────────────────┬─────────────────────────────────┤
│  /autowrite [on|off]           │ 自動書き込みトグル               │
│  /agent <task>                 │ Multi-Agent モードで実行         │
│  /search <glob>                │ globでファイル検索               │
│  /search <glob> --content <re> │ ファイル内容を正規表現検索       │
│  /read <path>                  │ ファイル表示 + 次発言へ注入      │
│  /write <path>                 │ 対話入力でファイル書き込み       │
│  /replace <path> <s> => <r>    │ 文字列置換                       │
│  /delete <path>                │ ファイル削除（確認あり）          │
│  /clear                        │ チャット履歴をクリア             │
│  /exit                         │ 終了                             │
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
    return true;
  }

  if (trimmed === '/exit' || trimmed === '/quit') {
    console.log(chalk.cyan('\n👋 終了します。\n'));
    process.exit(0);
  }

  return false;
}
