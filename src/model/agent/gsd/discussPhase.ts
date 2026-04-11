// src/model/agent/gsd/discussPhase.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { callLLM, type Message } from '../../llm.js';
import { type GsdContext } from '../../gsd.js';
import { type GsdAgentResult } from './types.js';
import { writePlanningBlocks } from './planningWriter.js';
import { printRevisionHeader } from './utils.js';

export async function runDiscussPhaseInteractive(
  context: GsdContext,
  rl: readline.Interface,
  history: Message[],
  planningRoot: string
): Promise<GsdAgentResult> {
  const commandName = context.command.name;
  printRevisionHeader(commandName, 0, 1);

  console.log(chalk.gray('\n  💬 フェーズを分析しています...\n'));

  const analysisPrompt = context.resolvedPrompt +
    '\n\n<discuss_instruction>\n' +
    'まず、このフェーズの灰色地帯（実装上の判断が必要な部分）を分析してください。\n' +
    'その後、ユーザーに確認したい質問を番号付きリストで提示してください。\n' +
    '質問は最大5つまで。具体的で答えやすい形にしてください。\n' +
    'まだ CONTEXT.md は作成しないでください。\n' +
    '</discuss_instruction>';

  let analysisOutput: string;
  try {
    analysisOutput = await callLLM(
      [...history, { role: 'user', content: analysisPrompt }],
      { printStream: true, label: '💬 GSD:discuss-phase 分析', temperature: 0.3 }
    );
  } catch (e) {
    console.log(chalk.red(`\n❌ LLM エラー: ${(e as Error).message}`));
    return { output: '', gateReached: 'aborted', planningWrites: [] };
  }

  console.log(chalk.yellow('\n\n📝 上記の質問に回答してください。'));
  console.log(chalk.gray('   (空行または "skip" で質問をスキップし、デフォルト判断で CONTEXT.md を生成します)\n'));

  let userAnswers: string;
  try {
    userAnswers = await rl.question(chalk.blue('回答 > '));
  } catch {
    userAnswers = '';
  }

  const skipAnswering = !userAnswers.trim() || userAnswers.trim().toLowerCase() === 'skip';

  console.log(chalk.gray('\n  📝 CONTEXT.md を生成しています...\n'));

  const contextGenPrompt = skipAnswering
    ? 'ユーザーは質問をスキップしました。各質問について推奨デフォルトを選択し、CONTEXT.md を生成してください。'
    : `ユーザーの回答: ${userAnswers}\n\nこの回答に基づいて CONTEXT.md を生成してください。`;

  const fullMessages: Message[] = [
    ...history,
    { role: 'user',      content: analysisPrompt },
    { role: 'assistant', content: analysisOutput },
    { role: 'user',      content: contextGenPrompt },
  ];

  let contextOutput: string;
  try {
    contextOutput = await callLLM(
      fullMessages,
      { printStream: true, label: '📝 GSD:discuss-phase CONTEXT.md 生成', temperature: 0.3 }
    );
  } catch (e) {
    console.log(chalk.red(`\n❌ LLM エラー: ${(e as Error).message}`));
    return { output: analysisOutput, gateReached: 'escalated', planningWrites: [] };
  }

  const writes = await writePlanningBlocks(contextOutput, planningRoot);
  const combinedOutput = `${analysisOutput}\n\n---\n\n${contextOutput}`;
  return { output: combinedOutput, gateReached: 'done', planningWrites: writes };
}
