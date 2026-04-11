// src/model/agent/gsdAgent.ts
import chalk from 'chalk';
import { callLLM, type Message } from '../../llm/index.js';
import { saveGsdState, commandToPhase } from '../../../controller/gsdState/index.js';

export type { GsdGateResult, GsdAgentResult, GsdAgentOptions } from '../gsd/types.js';

import { type GsdAgentOptions, type GsdAgentResult, type GsdGateResult } from '../gsd/types.js';
import { runAbortGate, GsdAbortError } from '../gsd/abortGate.js';
import { runPreflightGate, GsdPreflightError } from '../gsd/preflightGate.js';
import { assessOutputQuality, runEscalationGate } from '../gsd/revisionGate.js';
import { writePlanningBlocks } from '../gsd/planningWriter.js';
import { runInteractiveGsdLoop } from '../gsd/interactiveLoop.js';
import { runDiscussPhaseInteractive } from '../gsd/discussPhase.js';
import { extractPhaseNumber, buildRetryPrompt, isTerminalCommand, printRevisionHeader } from '../gsd/utils.js';

/**
 * GSD Agent メイン。
 * Abort → Pre-flight → (LLM → Revision) × maxRevisions → Escalation
 */
export async function runGsdAgent(opts: GsdAgentOptions): Promise<GsdAgentResult> {
  const { context, rl, history, args } = opts;
  const maxRevisions = opts.maxRevisions ?? 3;
  const commandName  = context.command.name;
  const planningRoot = context.planningRoot;
  const force        = args.includes('--force');

  // ── Abort Gate ──────────────────────────────────────────────────────────
  try {
    await runAbortGate(commandName, force);
  } catch (e) {
    if (e instanceof GsdAbortError) {
      console.log(chalk.red(`\n🛑 Abort Gate: ${e.message}`));
      await saveGsdState({ phase: 'error', errorMessage: e.message, lastCommand: commandName });
      return { output: '', gateReached: 'aborted', planningWrites: [] };
    }
    throw e;
  }

  // ── Pre-flight Gate ──────────────────────────────────────────────────────
  try {
    await runPreflightGate(commandName, planningRoot, args);
  } catch (e) {
    if (e instanceof GsdPreflightError) {
      console.log(chalk.red(`\n🚫 Pre-flight Gate: ${e.message}`));
      console.log(chalk.yellow(`   提案: ${e.suggestion}`));
      return { output: '', gateReached: 'aborted', planningWrites: [] };
    }
    throw e;
  }

  // ── 状態を実行中に更新 ───────────────────────────────────────────────────
  const phaseNumber = extractPhaseNumber(args);
  await saveGsdState({
    phase: commandToPhase(commandName),
    lastCommand: commandName,
    ...(phaseNumber !== null ? { currentPhaseNumber: phaseNumber } : {}),
  });

  // ── discuss-phase: 対話型マルチターンループ ────────────────────────────────
  if (commandName === 'discuss-phase' && !args.includes('--auto')) {
    return runDiscussPhaseInteractive(context, rl, history, planningRoot);
  }

  // ── 初期化系コマンド: 汎用マルチターン対話ループ ─────────────────────────
  const INTERACTIVE_COMMANDS = new Set(['new-project', 'new-milestone', 'import']);
  if (INTERACTIVE_COMMANDS.has(commandName) && !args.includes('--auto')) {
    return runInteractiveGsdLoop(context, rl, history, planningRoot, commandName);
  }

  // ── LLM メッセージ構築 ───────────────────────────────────────────────────
  const messages: Message[] = [
    ...history,
    { role: 'user', content: context.resolvedPrompt },
  ];

  // ── Revision Loop ────────────────────────────────────────────────────────
  let output      = '';
  let gateReached: GsdGateResult = 'done';
  let planningWrites: string[]   = [];

  for (let i = 0; i < maxRevisions; i++) {
    printRevisionHeader(commandName, i, maxRevisions);

    try {
      output = await callLLM(
        i === 0 ? messages : [...messages, { role: 'user', content: buildRetryPrompt(i) }],
        { printStream: true, label: `🎯 GSD:${commandName}`, temperature: 0.3 }
      );
    } catch (e) {
      console.log(chalk.red(`\n❌ LLM エラー: ${(e as Error).message}`));
      await saveGsdState({ phase: 'error', errorMessage: (e as Error).message, lastCommand: commandName });
      return { output: '', gateReached: 'aborted', planningWrites: [] };
    }

    const writes = await writePlanningBlocks(output, planningRoot);
    planningWrites.push(...writes);

    const quality = assessOutputQuality(output, commandName);
    if (quality.pass) {
      gateReached = 'done';
      break;
    }

    if (i === maxRevisions - 1) {
      const decision = await runEscalationGate(rl, quality.reason ?? '不明', i + 1, maxRevisions);
      if (decision === 'skip') { gateReached = 'escalated'; break; }
      if (decision === 'abort') {
        await saveGsdState({ phase: 'error', errorMessage: `Escalation: ${quality.reason}`, lastCommand: commandName });
        return { output, gateReached: 'aborted', planningWrites };
      }
      i--;
    }
  }

  // ── 状態を完了に更新 ─────────────────────────────────────────────────────
  if (gateReached === 'done' || gateReached === 'escalated') {
    await saveGsdState({
      phase: isTerminalCommand(commandName) ? 'done' : commandToPhase(commandName),
      lastCommand: commandName,
    });
  }

  return { output, gateReached, planningWrites };
}