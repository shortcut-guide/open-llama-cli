// src/orchestrator.ts

import chalk from 'chalk';
import { getConfig } from './config.js';

import { runAnalyzer } from './agents/analyzer.js';
import { runPlanner } from './agents/planner.js'; // MicroPlanner から変更
import { runCoderAgent } from './agents/coder.js';
import { runReviewerAgent, parseReviewResult } from './agents/reviewer.js';

import type { AgentContext, TaskType } from './agents/types.js';

export interface OrchestratorResult {
  finalCode: string;
  iterations: number;
  approved: boolean;
}

function resolveTaskType(userTask: string, explicit: TaskType | null): TaskType {
  if (explicit) return explicit;
  const lower = userTask.toLowerCase();
  if (lower.includes('リファクタ') || lower.includes('refactor')) return 'refactor';
  if (lower.includes('修正') || lower.includes('fix') || lower.includes('error')) return 'fix';
  if (lower.includes('分析') || lower.includes('analyze')) return 'analyze';
  return 'new';
}

function isGarbageCode(code: string): boolean {
  if (!code) return true;
  return (
    code.length < 50 ||
    code.includes('Sample') ||
    code.includes('TODO') ||
    !code.includes('file:')
  );
}

export async function runOrchestrator(
  userTask: string,
  code: string,
  filePath: string,
  explicitType: TaskType | null = null
): Promise<OrchestratorResult> {
  const config = getConfig();
  const taskType = resolveTaskType(userTask, explicitType);

  if (!code.trim()) {
    throw new Error('コードが未指定です。先に /read <ファイルパス> で読み込んでください。');
  }

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator (Macro Pipeline)   ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  /**
   * Step 1: Analyzer (事実の抽出)
   */
  const analysis = await runAnalyzer({
    code,
    filePath,
    llmUrl: config.LLM_API_URL,
  });

  /**
   * Step 2: Architect Planner (複数ファイルの設計)
   */
  console.log(chalk.yellow(`\n📋 Designing Architecture Plan...`));
  const macroPlan = await runPlanner({
    target: userTask,
    code: code,
    analysis: analysis,
    llmUrl: config.LLM_API_URL,
  });

  let finalCode = '';
  let overallApproved = true;
  let totalIterations = 0;

  /**
   * Step 3: Coder & Reviewer ループ (設計されたファイル群の数だけ回る)
   */
  for (const plan of macroPlan.plans) {
    console.log(chalk.bold.magenta(`\n📦 Generating File: ${plan.file}`));

    const ctx: AgentContext = {
      userTask,
      taskType,
      iterationCount: 0,
      plan: JSON.stringify(plan), // 各ファイルごとの指示
      sourceCode: code, // 元コード全体を渡す
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

    let localApproved = false;

    // Review Loop
    for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
      totalIterations++;

      const reviewerResult = await runReviewerAgent({
        ...ctx,
        code: codeOutput,
      });

      const review = parseReviewResult(reviewerResult.output);

      if (review.approved) {
        localApproved = true;
        console.log(chalk.green(`  ✅ Approved (${plan.file.split('/').pop()})`));
        break;
      }

      if (i < config.MAX_REVIEW_ITERATIONS - 1) {
        console.log('🔧 レビュー指摘による再生成');
        const retry = await runCoderAgent({
          ...ctx,
          userTask: ctx.userTask + '\n\nレビュー指摘を修正し、完全なコードを出力せよ。',
        });
        codeOutput = retry.output;
      }
    }

    if (!localApproved) overallApproved = false;
    finalCode += '\n\n' + codeOutput;
  }

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  📊 Orchestrator Summary            ║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  Files Generated: ${String(macroPlan.plans.length).padEnd(20)}║`));
  console.log(chalk.bold.cyan(`║  Total Iterations: ${String(totalIterations).padEnd(19)}║`));
  console.log(chalk.bold.cyan(`║  Approved        : ${String(overallApproved).padEnd(19)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  return {
    finalCode,
    iterations: totalIterations,
    approved: overallApproved,
  };
}