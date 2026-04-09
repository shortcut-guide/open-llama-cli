// src/controller/agentCommand.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { saveHistory } from '../../model/history.js';
import { getLineCountCache, handleFileEditProposals } from '../fileProposal.js';
import { runOrchestrator } from '../../orchestrator.js';

import { TaskType, AgentCommand, CommandContext } from './types.js';
import { getAutoWrite, getPendingFileContext, clearPendingFileContext } from '../state.js';
import { readMultiline } from '../multilineInput.js';

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

export async function handleAgentCommand(
  trimmed: string,
  rl: readline.Interface,
  ctx: CommandContext
): Promise<boolean> {
  const parsed = parseAgentCommand(trimmed);

  const firstLineTask = trimmed
    .replace(/^\/agent\s*/, '')
    .replace(/^(new|refactor|fix|extend|analyze|gsd)\s*/, '');

  const multi = await readMultiline(rl);
  const task = [firstLineTask, multi].filter(Boolean).join('\n');

  if (!task.trim()) {
    console.log("空です");
    return true;
  }

  const pending = getPendingFileContext();
  let agentCode = '';
  let agentFilePath = '';

  if (pending) {
    const codeMatch = pending.match(/```\n([\s\S]*?)\n```/);
    agentCode = codeMatch ? codeMatch[1] : '';

    const pathMatch = pending.match(/対象ファイル: `([^`]+)`/);
    agentFilePath = pathMatch ? pathMatch[1] : '';

    if (parsed.type !== 'gsd') {
      clearPendingFileContext();
    }
  }

  try {
    const result = await runOrchestrator(task, agentCode, agentFilePath, parsed.type);

    ctx.history.push({ role: 'user', content: `[Multi-Agent Task: ${parsed.type || 'auto'}] ${task}` });
    ctx.history.push({ role: 'assistant', content: result.finalCode });

    await saveHistory(ctx.history);

    if (parsed.type !== 'gsd') {
      await handleFileEditProposals(result.finalCode, ctx.history, rl, getAutoWrite());
    }
  } catch (e: unknown) {
    console.error(chalk.red(`\n❌ Orchestratorエラー: ${(e as Error).message}\n`));
  }

  return true;
}
