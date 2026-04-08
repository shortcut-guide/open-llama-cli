#!/usr/bin/env node
// src/index.ts
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { initializeConfig, getConfig } from './config.js';
import { loadHistory, saveHistory } from './model/history.js';
import { setWorkspaceRoot } from './model/file.js';
import { callLLM, type Message } from './model/llm.js';
import { runOrchestrator } from './orchestrator.js';
import {
  handleCommand,
  getAutoWrite,
  setAutoWrite,
  getPendingFileContext,
  clearPendingFileContext,
  parseAgentCommand,
} from './controller/command.js';
import { handleFileEditProposals } from './controller/fileProposal.js';
import {
  printBanner,
  printAutoWriteStatus,
  printWorkspaceInfo,
  printHint,
} from './view/display.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  await initializeConfig();

  const config = getConfig();
  setWorkspaceRoot(config.WORKSPACE_ROOT);
  setAutoWrite(config.AUTO_WRITE_DEFAULT);

  // 通常チャット用のシステムプロンプト
  const fullSystemPrompt = `${config.SYSTEM_PROMPT}
【重要指令】
ファイルを新規作成または上書き更新する場合は、必ず以下の専用マークダウン形式で出力してください：

\`\`\`file:保存先のファイルパス
ここにファイルの中身全体を記述
\`\`\`

【絶対禁止事項】
- \`// ...\` \`// existing code\` などの省略表現を禁止します
- ファイルブロック内は必ずファイル全体を省略なく完全に記述してください
- 差分・パッチ形式での出力は禁止です。常に完全なファイル内容を出力してください

注意: 複数のファイルを変更する場合は、このブロックを複数回出力してください。
`;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  printBanner();
  printWorkspaceInfo(config.WORKSPACE_ROOT);
  printAutoWriteStatus(getAutoWrite());
  printHint();

  const history: Message[] = await loadHistory(fullSystemPrompt);

  while (true) {
    const userInput = await rl.question(chalk.blue('You: '));
    if (!userInput.trim()) continue;

    // ─── /agent コマンド: Multi-Agent Orchestrator ───────────────
    if (userInput.trim().startsWith('/agent')) {
      const parsed = parseAgentCommand(userInput.trim());
      // parsed = { type: 'REFACTOR' | 'NEW' | 'FIX' | 'EXTEND' | null }

      const task = await readMultiline(rl);
      if (!task.trim()) { console.log("空です"); continue;}

      try {
        const result = await runOrchestrator(task,parsed.type);
        // Orchestratorの最終コードをhistoryに追記してファイルブロック処理
        history.push({ role: 'user', content: `[Multi-Agent Task] ${task}` });
        history.push({ role: 'assistant', content: result.finalCode });
        await saveHistory(history);
        await handleFileEditProposals(result.finalCode, history, rl, getAutoWrite());
      } catch (e: unknown) {
        console.error(chalk.red(`\n❌ Orchestratorエラー: ${(e as Error).message}\n`));
      }
      continue;
    }

    // ─── 通常コマンド処理 ────────────────────────────────────────
    const handled = await handleCommand(userInput, rl);
    if (handled) continue;

    // ─── 通常チャット ────────────────────────────────────────────
    let messageContent = userInput;
    const pending = getPendingFileContext();
    if (pending) {
      messageContent = `${pending}\n\n指示: ${userInput}`;
      clearPendingFileContext();
    }

    history.push({ role: 'user', content: messageContent });

    try {
      const assistantMessage = await callLLM(history, {
        printStream: true,
        label: 'AI',
      });
      history.push({ role: 'assistant', content: assistantMessage });
      await saveHistory(history);
      await handleFileEditProposals(assistantMessage, history, rl, getAutoWrite());
    } catch (e: unknown) {
      console.error(chalk.red(`\n❌ LLMエラー: ${(e as Error).message}\n`));
    }
  }
}

async function readMultiline(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    console.log("📝 複数行入力モード（/endで送信）");

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

main().catch((e) => {
  console.error(chalk.red('Fatal:'), e);
  process.exit(1);
});
