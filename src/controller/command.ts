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

import { clearHistory, saveHistory } from '../model/history.js';
import { getLineCountCache, handleFileEditProposals } from './fileProposal.js';
import { runOrchestrator } from '../orchestrator.js';
import { Message } from '../model/llm.js';

let AUTO_WRITE: boolean = false;
export let pendingFileContext: string | null = null;

// ─────────────────────────────────────

export interface CommandContext {
  history: Message[];
  fullSystemPrompt: string;
}

// ─────────────────────────────────────

export function getAutoWrite(): boolean {
  return AUTO_WRITE;
}

export function setAutoWrite(v: boolean): void {
  AUTO_WRITE = v;
}

export function clearPendingFileContext(): void {
  pendingFileContext = null;
}

export function getPendingFileContext(): string | null {
  return pendingFileContext;
}

// ─────────────────────────────────────
// multiline入力
async function readMultiline(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    console.log("\n📝 複数行入力モード（/endで送信）\n");

    let lines: string[] = [];

    rl.on("line", (line) => {
      if (line.trim() === "/end") {
        rl.removeAllListeners("line");
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
  });
}

// ─────────────────────────────────────
// Agent Command

export type TaskType = 'new' | 'refactor' | 'fix' | 'extend' | 'analyze' | 'gsd' | null;

export interface AgentCommand {
  type: TaskType;
  rawInput: string;
}

const VALID_TYPES: TaskType[] = ['new', 'refactor', 'fix', 'extend', 'analyze', 'gsd'];

export function parseAgentCommand(input: string): AgentCommand {
  const parts = input.split(/\s+/);
  const typeArg = parts[1]?.toLowerCase() as TaskType;

  if (VALID_TYPES.includes(typeArg)) {
    return { type: typeArg, rawInput: input };
  }

  if (parts[1]) {
    console.log(chalk.yellow(
      `⚠️ 不明なタイプ "${parts[1]}" → 自動判断モード`
    ));
  }

  return { type: null, rawInput: input };
}

import { gsdInitialize, gsdDiscussPhase, gsdPlanPhase, gsdExecutePhase, gsdVerifyWork } from '../gsd/orchestrator.js';

// ─────────────────────────────────────
// メインコマンドハンドラ

export async function handleCommand(
  userInput: string,
  rl: readline.Interface,
  ctx: CommandContext
): Promise<boolean> {

  const trimmed = userInput.trim();

  // ─── /agent ─────────────────────
  if (trimmed.startsWith('/agent')) {
    const parsed = parseAgentCommand(trimmed);

    // 1行目からコマンド部分を除去して残りを取得
    const firstLineTask = trimmed
      .replace(/^\/agent\s*/, '')
      .replace(/^(new|refactor|fix|extend|analyze|gsd)\s*/, '');

    const multi = await readMultiline(rl);

    // 1行目 + 複数行を結合
    const task = [firstLineTask, multi].filter(Boolean).join('\n');

    if (!task.trim()) {
      console.log("空です");
      return true;
    }

    // pendingFileContext からコード・パスを取得
    const pending = getPendingFileContext();
    let agentCode = '';
    let agentFilePath = '';

    if (pending) {
      // ```\ncode\n``` を抽出
      const codeMatch = pending.match(/```\n([\s\S]*?)\n```/);
      agentCode = codeMatch ? codeMatch[1] : '';

      // 対象ファイル: `path` を抽出
      const pathMatch = pending.match(/対象ファイル: `([^`]+)`/);
      agentFilePath = pathMatch ? pathMatch[1] : '';

      if (parsed.type !== 'gsd') {
        clearPendingFileContext();
      }
    }

    try {
      const result = await runOrchestrator(
        task,
        agentCode,
        agentFilePath,
        parsed.type
      );

      ctx.history.push({
        role: 'user',
        content: `[Multi-Agent Task: ${parsed.type || 'auto'}] ${task}`
      });

      ctx.history.push({
        role: 'assistant',
        content: result.finalCode
      });

      await saveHistory(ctx.history);

      if (parsed.type !== 'gsd') {
        await handleFileEditProposals(
          result.finalCode,
          ctx.history,
          rl,
          getAutoWrite()
        );
      }

    } catch (e: unknown) {
      console.error(
        chalk.red(`\n❌ Orchestratorエラー: ${(e as Error).message}\n`)
      );
    }

    return true;
  }

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
│  /agent gsd <subcmd> <args>    │ GSDモード (init|discuss|plan|...) │
│  /agent <task>                 │ Multi-Agent モードで実行         │
│  /autowrite [on|off]           │ 自動書き込みトグル               │
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