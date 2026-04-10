// src/agents/gsdAgent.ts
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { callLLM, type Message } from '../llm.js';
import {
  type GsdContext,
  getPreflightRequirements,
  planningFileExists,
  writePlanningFile,
} from '../gsd.js';
import {
  loadGsdState,
  saveGsdState,
  isBlockingErrorState,
  commandToPhase,
  type GsdWorkflowState,
} from '../../controller/gsdState.js';
import { extractFileBlocks } from '../../controller/fileProposal.js';

// ─── 型定義 ────────────────────────────────────────────────────────────────

export type GsdGateResult = 'done' | 'escalated' | 'aborted';

export interface GsdAgentResult {
  output: string;
  gateReached: GsdGateResult;
  planningWrites: string[];   // 書き込んだ .planning/ 相対パス一覧
}

export interface GsdAgentOptions {
  context: GsdContext;
  rl: readline.Interface;
  history: Message[];
  args: string;               // ユーザーが渡した引数（フラグ解析用）
  maxRevisions?: number;      // Revision Gate 上限（default: 3）
}

// ─── Gate: Abort ──────────────────────────────────────────────────────────

/**
 * Abort Gate: error state または致命的な前提不足で即時停止。
 */
async function runAbortGate(commandName: string, force: boolean): Promise<void> {
  const blocking = await isBlockingErrorState(force);
  if (!blocking) return;

  const state = await loadGsdState();
  throw new GsdAbortError(
    `STATE.md がエラー状態です: ${state.errorMessage ?? '原因不明'}\n` +
    `解決後に再実行するか、"/gsd:next --force" でバイパスしてください。`
  );
}

// ─── Gate: Pre-flight ─────────────────────────────────────────────────────

/**
 * Pre-flight Gate: コマンドの前提ファイルが存在するか確認。
 * 不足があれば GsdPreflightError を投げる。
 */
async function runPreflightGate(
  commandName: string,
  planningRoot: string,
  args: string
): Promise<void> {
  const requirements = getPreflightRequirements(commandName);

  // execute-phase / verify-work はフェーズ番号依存の動的チェック
  if (commandName === 'execute-phase') {
    const phaseNum = extractPhaseNumber(args);
    if (phaseNum !== null) {
      const planPath = `phases/${phaseNum}/PLAN.md`;
      const exists = await planningFileExists(planningRoot, planPath);
      if (!exists) {
        throw new GsdPreflightError(
          `Phase ${phaseNum} の PLAN.md が存在しません。`,
          `/gsd:plan-phase ${phaseNum}`
        );
      }
    }
    return;
  }

  if (commandName === 'verify-work') {
    const phaseNum = extractPhaseNumber(args);
    if (phaseNum !== null) {
      const summaryPath = `phases/${phaseNum}/SUMMARY.md`;
      const exists = await planningFileExists(planningRoot, summaryPath);
      if (!exists) {
        throw new GsdPreflightError(
          `Phase ${phaseNum} の SUMMARY.md が存在しません。execute-phase を先に実行してください。`,
          `/gsd:execute-phase ${phaseNum}`
        );
      }
    }
    return;
  }

  // 静的チェック
  for (const req of requirements) {
    const exists = await planningFileExists(planningRoot, req.file);
    if (!exists) {
      throw new GsdPreflightError(req.missingMessage, req.suggestion);
    }
  }
}

// ─── Gate: Revision ───────────────────────────────────────────────────────

/**
 * 出力品質の簡易評価。
 * LLM が「何も生成しなかった」「エラーを返した」ケースを検知する。
 */
function assessOutputQuality(output: string): { pass: boolean; reason?: string } {
  if (!output || output.trim().length < 30) {
    return { pass: false, reason: '出力が空または短すぎます。' };
  }
  if (/^(error|エラー|失敗)/i.test(output.trim())) {
    return { pass: false, reason: 'LLM がエラーを返しました。' };
  }
  return { pass: true };
}

// ─── Gate: Escalation ─────────────────────────────────────────────────────

/**
 * Escalation Gate: ユーザーに選択肢を提示して次のアクションを決める。
 * 戻り値: 'retry' | 'skip' | 'abort'
 */
async function runEscalationGate(
  rl: readline.Interface,
  reason: string,
  iteration: number,
  maxRevisions: number
): Promise<'retry' | 'skip' | 'abort'> {
  console.log(chalk.red(`\n⚠️  Revision Gate: ${iteration}/${maxRevisions} 回試行しましたが品質基準を満たしません。`));
  console.log(chalk.red(`   理由: ${reason}`));
  console.log(chalk.yellow('\n選択してください:'));
  console.log(chalk.gray('  [r] リトライ（追加プロンプトで再生成）'));
  console.log(chalk.gray('  [s] スキップ（この出力のまま続行）'));
  console.log(chalk.gray('  [a] 中断'));

  const answer = await rl.question(chalk.blue('> '));
  const ans = answer.trim().toLowerCase();

  if (ans === 'r' || ans === 'retry') return 'retry';
  if (ans === 's' || ans === 'skip') return 'skip';
  return 'abort';
}

// ─── .planning/ 書き込み検知 ──────────────────────────────────────────────

/**
 * LLM 出力から ```file:... ブロックを抽出し、
 * .planning/ に属するものだけ自動書き込みする。
 */
async function writePlanningBlocks(
  output: string,
  planningRoot: string
): Promise<string[]> {
  const blocks = extractFileBlocks(output);
  const written: string[] = [];

  for (const block of blocks) {
    // .planning/ パスのみ対象
    const rel = block.filePath.replace(/^\.planning\//, '');
    if (rel === block.filePath && !block.filePath.startsWith('.planning')) {
      continue; // .planning/ 以外はスキップ（通常の fileProposal に任せる）
    }

    try {
      await writePlanningFile(planningRoot, rel, block.content);
      written.push(rel);
      console.log(chalk.green(`  💾 .planning/${rel} を書き込みました`));
    } catch (e) {
      console.log(chalk.red(`  ❌ 書き込み失敗: ${rel} — ${(e as Error).message}`));
    }
  }

  return written;
}

// ─── メイン実行 ───────────────────────────────────────────────────────────

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
        {
          printStream: true,
          label: `🎯 GSD:${commandName}`,
          temperature: 0.3,
        }
      );
    } catch (e) {
      console.log(chalk.red(`\n❌ LLM エラー: ${(e as Error).message}`));
      await saveGsdState({ phase: 'error', errorMessage: (e as Error).message, lastCommand: commandName });
      return { output: '', gateReached: 'aborted', planningWrites: [] };
    }

    // .planning/ 書き込み
    const writes = await writePlanningBlocks(output, planningRoot);
    planningWrites.push(...writes);

    // Revision Gate 評価
    const quality = assessOutputQuality(output);
    if (quality.pass) {
      gateReached = 'done';
      break;
    }

    // 最終イテレーション → Escalation Gate
    if (i === maxRevisions - 1) {
      const decision = await runEscalationGate(rl, quality.reason ?? '不明', i + 1, maxRevisions);

      if (decision === 'skip') {
        gateReached = 'escalated';
        break;
      }
      if (decision === 'abort') {
        await saveGsdState({
          phase: 'error',
          errorMessage: `Escalation: ${quality.reason}`,
          lastCommand: commandName,
        });
        return { output, gateReached: 'aborted', planningWrites };
      }
      // 'retry' → ループ継続（maxRevisions を超えるが1回だけ追加）
      i--; // イテレーションを消費しない
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

// ─── ユーティリティ ────────────────────────────────────────────────────────

function extractPhaseNumber(args: string): number | null {
  const m = args.match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function buildRetryPrompt(iteration: number): string {
  return (
    `[Retry ${iteration}] 前回の出力が不完全でした。\n` +
    `指示に従い、完全な内容を再出力してください。省略・placeholder は禁止です。`
  );
}

function isTerminalCommand(name: string): boolean {
  return ['complete-milestone', 'cleanup'].includes(name);
}

function printRevisionHeader(name: string, i: number, max: number): void {
  if (i === 0) {
    console.log(chalk.bold.cyan(`\n╔══════════════════════════════════╗`));
    console.log(chalk.bold.cyan(`║  🚀 GSD: ${name.padEnd(22)}║`));
    console.log(chalk.bold.cyan(`╚══════════════════════════════════╝`));
  } else {
    console.log(chalk.yellow(`\n🔄 リトライ ${i}/${max - 1}...`));
  }
}

// ─── カスタムエラー ────────────────────────────────────────────────────────

class GsdAbortError extends Error {
  constructor(msg: string) { super(msg); this.name = 'GsdAbortError'; }
}

class GsdPreflightError extends Error {
  constructor(msg: string, public readonly suggestion: string) {
    super(msg); this.name = 'GsdPreflightError';
  }
}