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
 * 対応パス形式:
 *   - `.planning/phases/N/FILE.md`   → planningRoot 相対に変換
 *   - `phases/N/FILE.md`             → planningRoot 直下として扱う
 *   - `phases/N-slug/FILE.md`        → 同上
 */
async function writePlanningBlocks(
  output: string,
  planningRoot: string
): Promise<string[]> {
  const blocks = extractFileBlocks(output);
  const written: string[] = [];

  for (const block of blocks) {
    let rel: string;

    if (block.filePath.startsWith('.planning/')) {
      rel = block.filePath.replace(/^\.planning\//, '');
    } else if (block.filePath.startsWith('phases/')) {
      rel = block.filePath;
    } else {
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

// ─── 汎用マルチターン対話ループ ───────────────────────────────────────────

/**
 * new-project / new-milestone / import など、
 * 複数ターンのユーザー対話が必要なコマンド向けの汎用ループ。
 *
 * フロー:
 *   1. 初回 LLM 呼び出し → ワークフロー開始・質問提示
 *   2. ユーザーが回答入力（空行 or "/done" で早期終了）
 *   3. 会話履歴に追加して LLM 再呼び出し → 次ステップ実行
 *   4. コマンド別の必須ファイルがすべて生成されたら自動完了
 *   5. maxTurns に達したら Escalation Gate へ
 */
async function runInteractiveGsdLoop(
  context: GsdContext,
  rl: readline.Interface,
  history: Message[],
  planningRoot: string,
  commandName: string,
  maxTurns = 20
): Promise<GsdAgentResult> {
  // コマンドごとの「完了」を示す必須ファイル
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
    // ヘッダー表示（初回のみ大枠）
    if (turn === 0) {
      printRevisionHeader(commandName, 0, maxTurns);
    } else {
      console.log(chalk.cyan(`\n🔁 ターン ${turn + 1}/${maxTurns}`));
    }

    // LLM 呼び出し
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

    // .planning/ ファイル書き込み
    const writes = await writePlanningBlocks(latestOutput, planningRoot);
    allWrites.push(...writes);

    // アシスタント発言を会話履歴へ追加
    messages.push({ role: 'assistant', content: latestOutput });

    // ── 完了判定: 必須ファイルがすべて揃ったか確認 ──────────────────────
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

      // 何か書き込まれたが未完了の場合はどのファイルが残っているか表示
      if (writes.length > 0) {
        const remaining = missing.filter((m) => !m.exists).map((m) => m.f);
        console.log(chalk.gray(`  残りファイル: ${remaining.join(', ')}`));
      }
    }

    // ── ユーザー入力待ち ─────────────────────────────────────────────────
    console.log(chalk.yellow('\n💬 応答を入力してください。'));
    console.log(chalk.gray('  （空行または "/done" で終了 | "/abort" で中断）\n'));

    let userInput: string;
    try {
      userInput = await rl.question(chalk.blue('> '));
    } catch {
      break; // readline が閉じられた
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

    // ユーザー発言を会話履歴へ追加
    messages.push({ role: 'user', content: trimmed });
  }

  // maxTurns 超過 or 早期終了: 生成されたものがあれば done 扱い
  const gateReached: GsdGateResult = allWrites.length > 0 ? 'done' : 'escalated';
  await saveGsdState({
    phase: isTerminalCommand(commandName) ? 'done' : commandToPhase(commandName),
    lastCommand: commandName,
  });
  return { output: latestOutput, gateReached, planningWrites: allWrites };
}

// ─── discuss-phase 対話型ループ ───────────────────────────────────────────

/**
 * discuss-phase 専用のマルチターン実行。
 *
 * フロー:
 *   1. 初回 LLM 呼び出し → 分析・質問提示
 *   2. ユーザーが回答入力
 *   3. 回答を含めて 2 回目 LLM 呼び出し → CONTEXT.md 生成
 *
 * ユーザーが空行を入力したり "skip" を入力したら対話をスキップして CONTEXT.md 生成へ進む。
 * "--auto" フラグがある場合は通常の Revision Loop に流れるため、この関数は呼ばれない。
 */
async function runDiscussPhaseInteractive(
  context: GsdContext,
  rl: readline.Interface,
  history: Message[],
  planningRoot: string
): Promise<GsdAgentResult> {
  const commandName = context.command.name;

  printRevisionHeader(commandName, 0, 1);

  // ── ステップ 1: 分析フェーズ ────────────────────────────────────────────
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

  // ── ステップ 2: ユーザー回答収集 ────────────────────────────────────────
  console.log(chalk.yellow('\n\n📝 上記の質問に回答してください。'));
  console.log(chalk.gray('   (空行または "skip" で質問をスキップし、デフォルト判断で CONTEXT.md を生成します)\n'));

  let userAnswers: string;
  try {
    userAnswers = await rl.question(chalk.blue('回答 > '));
  } catch {
    userAnswers = '';
  }

  const skipAnswering = !userAnswers.trim() || userAnswers.trim().toLowerCase() === 'skip';

  // ── ステップ 3: CONTEXT.md 生成 ─────────────────────────────────────────
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

  // .planning/ 書き込み
  const writes = await writePlanningBlocks(contextOutput, planningRoot);

  const combinedOutput = `${analysisOutput}\n\n---\n\n${contextOutput}`;
  return { output: combinedOutput, gateReached: 'done', planningWrites: writes };
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