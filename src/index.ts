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
import {
  handleCommand,
  getAutoWrite,
  setAutoWrite,
  getPendingFileContext,
  clearPendingFileContext,
} from './controller/command.js';
import { handleFileEditProposals } from './controller/fileProposal.js';
import {
  printBanner,
  printAutoWriteStatus,
  printWorkspaceInfo,
  printHint,
  printGsdStatusIfActive,
} from './view/display.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  await initializeConfig();

  const config = getConfig();
  setWorkspaceRoot(config.WORKSPACE_ROOT);
  setAutoWrite(config.AUTO_WRITE_DEFAULT);

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
    input,
    output,
  });

  printBanner();
  printWorkspaceInfo(config.WORKSPACE_ROOT);
  printAutoWriteStatus(getAutoWrite());
  await printGsdStatusIfActive();
  printHint();

  const history: Message[] = await loadHistory(fullSystemPrompt);

  while (true) {
    const userInput = await rl.question(chalk.blue('You: '));
    if (!userInput.trim()) continue;

    // ✅ コマンド処理（/agent含む）
    const handled = await handleCommand(userInput, rl, {
      history,
      fullSystemPrompt,
    });

    if (handled) continue;

    // ─── 通常チャット ─────────────────────────
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

      await handleFileEditProposals(
        assistantMessage,
        history,
        rl,
        getAutoWrite()
      );
    } catch (e: unknown) {
      console.error(chalk.red(`\n❌ LLMエラー: ${(e as Error).message}\n`));
    }
  }
}

main().catch((e) => {
  console.error(chalk.red('Fatal:'), e);
  process.exit(1);
});