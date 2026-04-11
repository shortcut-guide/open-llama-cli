#!/usr/bin/env node
// src/index.ts
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { initializeConfig, getConfig } from './config/index.js';
import { loadHistory, saveHistory } from './model/history/index.js';
import { loadInputHistory, appendInputHistory } from './model/inputHistory/index.js';
import { setWorkspaceRoot } from './model/file/index.js';
import { callLLM, type Message } from './model/llm/index.js';
import {
  handleCommand,
  getAutoWrite,
  setAutoWrite,
  getPendingFileContext,
  clearPendingFileContext,
} from './controller/command/index.js';
import { handleFileEditProposals } from './controller/fileProposal/index.js';
import { readUserInput } from './controller/multilineInput/index.js';
import { getTokenUsage } from './model/history/index.js';
import {
  printBanner,
  printAutoWriteStatus,
  printWorkspaceInfo,
  printHint,
  printGsdStatusIfActive,
} from './view/display/index.js';

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
  const inputHistory = await loadInputHistory(config.INPUT_HISTORY_MAX);
  const sessionInputs: string[] = [];

  const saveSessionHistory = async () => {
    if (sessionInputs.length > 0) {
      await appendInputHistory(sessionInputs, config.INPUT_HISTORY_MAX);
    }
  };

  process.on('exit', () => { void saveSessionHistory(); });
  process.on('SIGINT', async () => { await saveSessionHistory(); process.exit(0); });
  process.on('SIGTERM', async () => { await saveSessionHistory(); process.exit(0); });

  while (true) {
    const userInput = await readUserInput(chalk.blue('You: '), inputHistory);
    if (!userInput.trim()) continue;

    // 入力履歴に追加（重複を除く）
    if (inputHistory[inputHistory.length - 1] !== userInput) {
      inputHistory.push(userInput);
      sessionInputs.push(userInput);
    }

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

      const tokenUsage = getTokenUsage(history, config.MAX_TOKENS);
      if (tokenUsage.usagePercent >= 80) {
        console.log(chalk.yellow(`  ⚠️  コンテキスト使用率: ${tokenUsage.usagePercent}% (${tokenUsage.totalTokens.toLocaleString()}/${tokenUsage.maxTokens.toLocaleString()} トークン) — /compact で圧縮できます`));
      }

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