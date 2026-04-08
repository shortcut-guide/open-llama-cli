// src/orchestrator.ts

import chalk from 'chalk';
import { getConfig } from './config.js';

import { runAnalyzer } from './agents/analyzer.js';
import { runMicroPlanner } from './agents/planner.js';
import { runCoderAgent } from './agents/coder.js';
import { runReviewerAgent, parseReviewResult } from './agents/reviewer.js';

import type { AgentContext, TaskType } from './agents/types.js';

export interface OrchestratorResult {
  finalCode: string;
  iterations: number;
  approved: boolean;
}

/**
 * タスクタイプ判定
 */
function resolveTaskType(userTask: string, explicit: TaskType | null): TaskType {
  if (explicit) {
    console.log(chalk.cyan(`  📌 TaskType: ${explicit} (明示指定)`));
    return explicit;
  }

  const lower = userTask.toLowerCase();

  if (lower.includes('リファクタ') || lower.includes('refactor')) return 'refactor';
  if (lower.includes('修正') || lower.includes('fix') || lower.includes('error')) return 'fix';
  if (lower.includes('分析') || lower.includes('analyze')) return 'analyze';

  return 'new';
}

/**
 * ダミーコード検知
 */
function isGarbageCode(code: string): boolean {
  if (!code) return true;

  return (
    code.length < 80 ||
    code.includes('Sample') ||
    code.includes('TODO') ||
    !code.includes('file:')
  );
}

/**
 * メインOrchestrator
 */
export async function runOrchestrator(
  userTask: string,
  code: string,
  filePath: string,
  explicitType: TaskType | null = null
): Promise<OrchestratorResult> {
  const config = getConfig();
  const taskType = resolveTaskType(userTask, explicitType);

  // 空コードガード
  if (!code.trim()) {
    throw new Error(
      'コードが未指定です。先に /read <ファイルパス> でファイルを読み込んでください。'
    );
  }

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator (Micro Pipeline)   ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  /**
   * Step1: Analyzer（構造分解）
   */
  const analysis = await runAnalyzer({
    code,
    filePath,
    llmUrl: config.LLM_API_URL,
  });

  let finalCode = '';
  let approved = true;
  let iterationCount = 0;

  /**
   * Step2: 各関数ごとに処理（超重要）
   */
  for (const fn of analysis.functions) {
    console.log(chalk.yellow(`\n🔍 Processing function: ${fn.name}`));

    /**
     * Step2-1: Micro Planner（1ファイルのみ）
     */
    const plan = await runMicroPlanner({
      target: userTask,
      functionInfo: fn,
      filePath: analysis.path,
      llmUrl: config.LLM_API_URL,
    });

    // 🔥 修正ポイント: Analyzerの行数判定が狂うことがあるため、
    // 切り出し(slice)を廃止し、ファイル全体のコードをそのままCoderに渡す
    const targetCode = code;

    /**
     * Step2-2: Coder（1ファイル生成）
     */
    const ctx: AgentContext = {
      userTask,
      taskType,
      iterationCount: 0,
      plan: JSON.stringify(plan),
      sourceCode: targetCode,
      sourcePath: analysis.path,
    };

    let coderResult = await runCoderAgent(ctx);
    let codeOutput = coderResult.output;

    if (isGarbageCode(codeOutput)) {
      console.log('⚠️ ダミーコード検知 → 再生成');

      coderResult = await runCoderAgent({
        ...ctx,
        userTask: ctx.userTask + '\n\nダミー禁止。実装のみ出力せよ。',
      });

      codeOutput = coderResult.output;
    }

    /**
     * Step2-3: Review loop（軽量）
     */
    let localApproved = false;

    for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
      iterationCount++;

      const reviewerResult = await runReviewerAgent({
        ...ctx,
        code: codeOutput,
      });

      const review = parseReviewResult(reviewerResult.output);

      if (review.approved) {
        localApproved = true;
        console.log(chalk.green(`  ✅ Approved (${fn.name})`));
        break;
      }

      if (i < config.MAX_REVIEW_ITERATIONS - 1) {
        console.log('🔧 再生成');

        const retry = await runCoderAgent({
          ...ctx,
          userTask:
            ctx.userTask +
            '\n\nレビュー指摘を修正し、完全なコードを出力せよ。',
        });

        codeOutput = retry.output;
      }
    }

    if (!localApproved) {
      approved = false;
    }

    finalCode += '\n\n' + codeOutput;
  }

  /**
   * Summary
   */
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  📊 Orchestrator Summary            ║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  Iterations : ${String(iterationCount).padEnd(22)}║`));
  console.log(chalk.bold.cyan(`║  Approved   : ${String(approved).padEnd(22)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  return {
    finalCode,
    iterations: iterationCount,
    approved,
  };
}