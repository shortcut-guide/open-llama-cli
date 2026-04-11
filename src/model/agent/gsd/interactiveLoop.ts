// src/model/agent/gsd/interactiveLoop.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { callLLM, type Message } from '../../llm/index.js';
import { type GsdContext, planningFileExists } from '../../gsd/index.js';
import { saveGsdState, commandToPhase } from '../../../controller/gsdState/index.js';
import { type GsdAgentResult } from './types.js';
import { writePlanningBlocks } from './planningWriter.js';
import { isTerminalCommand, printRevisionHeader } from './utils.js';

export async function runInteractiveGsdLoop(
  context: GsdContext,
  rl: readline.Interface,
  history: Message[],
  planningRoot: string,
  commandName: string,
  maxTurns = 20
): Promise<GsdAgentResult> {
  const TERMINAL_FILES: Record<string, string[]> = {
    'new-project':   ['PROJECT.md', 'REQUIREMENTS.md', 'ROADMAP.md'],
    'new-milestone': ['ROADMAP.md'],
    'import':        ['PROJECT.md', 'ROADMAP.md'],
  };

  const terminalFiles = TERMINAL_FILES[commandName] ?? [];
  const messages: Message[] = [
    ...history,
    { role: 'user', content: context.resolvedPrompt },
  ];

  let latestOutput   = '';
  let allWrites: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (turn === 0) {
      printRevisionHeader(commandName, 0, maxTurns);
    } else {
      console.log(chalk.cyan(`\n🔁 ターン ${turn + 1}/${maxTurns}`));
    }

    try {
      latestOutput = await callLLM(messages, {
        printStream: true,
        label:       `🎯 GSD:${commandName}`,
        temperature: 0.3,
      });
    } catch (e) {
      console.log(chalk.red(`\n❌ LLM エラー: ${(e as Error).message}`));
      await saveGsdState({ phase: 'error', errorMessage: (e as Error).message, lastCommand: commandName });
      return { output: latestOutput, gateReached: 'aborted', planningWrites: allWrites };
    }

    const writes = await writePlanningBlocks(latestOutput, planningRoot);
    allWrites.push(...writes);
    messages.push({ role: 'assistant', content: latestOutput });

    if (terminalFiles.length > 0) {
      const missing = await Promise.all(
        terminalFiles.map(async (f) => ({ f, exists: await planningFileExists(planningRoot, f) }))
      );
      const allPresent = missing.every((m) => m.exists);

      if (allPresent) {
        console.log(chalk.green('\n✅ 必須ファイルがすべて生成されました。ワークフロー完了。'));
        await saveGsdState({ phase: commandToPhase(commandName), lastCommand: commandName });
        return { output: latestOutput, gateReached: 'done', planningWrites: allWrites };
      }

      if (writes.length > 0) {
        const remaining = missing.filter((m) => !m.exists).map((m) => m.f);
        console.log(chalk.gray(`  残りファイル: ${remaining.join(', ')}`));
      }
    }

    console.log(chalk.yellow('\n💬 応答を入力してください。'));
    console.log(chalk.gray('  （空行または "/done" で終了 | "/abort" で中断）\n'));

    let userInput: string;
    try {
      userInput = await rl.question(chalk.blue('> '));
    } catch {
      break;
    }

    const trimmed = userInput.trim();
    if (!trimmed || trimmed === '/done') {
      console.log(chalk.gray('\n  対話を終了します。'));
      break;
    }
    if (trimmed === '/abort') {
      await saveGsdState({ phase: 'error', errorMessage: 'ユーザーが中断しました', lastCommand: commandName });
      return { output: latestOutput, gateReached: 'aborted', planningWrites: allWrites };
    }

    messages.push({ role: 'user', content: trimmed });
  }

  const gateReached: GsdAgentResult['gateReached'] = allWrites.length > 0 ? 'done' : 'escalated';
  await saveGsdState({
    phase: isTerminalCommand(commandName) ? 'done' : commandToPhase(commandName),
    lastCommand: commandName,
  });
  return { output: latestOutput, gateReached, planningWrites: allWrites };
}
