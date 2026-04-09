// src/orchestrator.ts

import chalk from 'chalk';
import { getConfig } from './config.js';

import { runAnalyzer } from './agents/analyzer.js';
import { runPlanner } from './agents/planner.js';
import { runCoderAgent } from './agents/coder.js';
import { runReviewerAgent, parseReviewResult } from './agents/reviewer.js';
import { gsdInitialize, gsdDiscussPhase, gsdPlanPhase, gsdExecutePhase, gsdVerifyWork } from './gsd/orchestrator.js';

import type { AgentContext, TaskType, ReviewResult } from './agents/types.js';

export interface OrchestratorResult {
  finalCode: string;
  iterations: number;
  approved: boolean;
}

/**
 * タスクタイプを解決する (明示指定がない場合はキーワードから推測)
 */
function resolveTaskType(userTask: string, explicit: TaskType | null): TaskType {
  if (explicit) return explicit;
  const lower = userTask.toLowerCase();
  if (lower.includes('gsd')) return 'gsd';
  if (lower.includes('リファクタ') || lower.includes('refactor') || lower.includes('分割')) return 'refactor';
  if (lower.includes('修正') || lower.includes('fix') || lower.includes('error')) return 'fix';
  if (lower.includes('分析') || lower.includes('analyze')) return 'analyze';
  return 'new';
}

/**
 * GSDフローの実行
 */
async function runGsdFlow(userTask: string): Promise<OrchestratorResult> {
  const parts = userTask.trim().split(/\s+/);
  const subCommand = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (subCommand) {
    case 'init':
    case 'initialize':
      await gsdInitialize(arg);
      break;
    case 'discuss':
      await gsdDiscussPhase(arg);
      break;
    case 'plan':
      await gsdPlanPhase(arg);
      break;
    case 'execute':
      await gsdExecutePhase(arg);
      break;
    case 'verify':
      await gsdVerifyWork(arg);
      break;
    default:
      console.log(chalk.yellow(`不明なGSDサブコマンド: ${subCommand}. 使用法: /agent gsd [init|discuss|plan|execute|verify] <args>`));
  }

  return {
    finalCode: 'GSD task completed. Check .planning/ directory or updated files.',
    iterations: 1,
    approved: true,
  };
}

/**
 * AIが生成したコードが実体のない「ゴミ」かどうかを判定
 */
function isGarbageCode(code: string): boolean {
  if (!code) return true;
  return (
    code.length < 50 ||
    code.includes('Sample Code') ||
    code.includes('TODO: Implement') ||
    !code.includes('file:')
  );
}

/**
 * メインオーケストレーター
 * 全体フロー: Analyzer -> Planner -> (Coder -> Reviewer) x ファイル数
 */
export async function runOrchestrator(
  userTask: string,
  code: string,
  filePath: string,
  explicitType: TaskType | null = null
): Promise<OrchestratorResult> {
  const config = getConfig();
  const taskType = resolveTaskType(userTask, explicitType);

  if (taskType === 'gsd') {
    return await runGsdFlow(userTask);
  }

  if (!code.trim()) {
    throw new Error('ソースコードが空です。/read コマンドでファイルを読み込んでから実行してください。');
  }

  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  🎯 Orchestrator (Macro Pipeline)   ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝'));

  /**
   * Step 1: Analyzer (ソースコードの事実解析)
   */
  const analysis = await runAnalyzer({
    code,
    filePath,
    llmUrl: config.LLM_API_URL,
  });

  /**
   * Step 2: Architect Planner (複数ファイル分割の設計図作成)
   */
  console.log(chalk.yellow(`\n📋 Designing Architecture Plan for: ${filePath}`));
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
   * Step 3: 設計された各ファイルごとに生成とレビューを実行
   */
  for (const plan of macroPlan.plans) {
    console.log(chalk.bold.magenta(`\n📦 Generating: ${plan.file}`));

    let ctx: AgentContext = {
      userTask,
      taskType,
      iterationCount: 0,
      plan: JSON.stringify(plan),
      sourceCode: code,
      sourcePath: analysis.path,
    };

    let coderResult = await runCoderAgent(ctx);
    let codeOutput = coderResult.output;

    if (isGarbageCode(codeOutput)) {
      console.log(chalk.red('  ⚠️ 不完全なコードを検知。再生成を試みます...'));
      coderResult = await runCoderAgent({
        ...ctx,
        userTask: ctx.userTask + '\n\n指示に従い、実装のみを完全なファイル形式で出力してください。',
      });
      codeOutput = coderResult.output;
    }

    let localApproved = false;
    let currentReviewResult: ReviewResult | undefined;

    /**
     * Step 4: Review Loop (指摘 -> ヒント提示 -> 再生成)
     */
    for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
      totalIterations++;
      ctx.iterationCount = i;

      const reviewerResult = await runReviewerAgent({
        ...ctx,
        code: codeOutput,
        reviewResult: currentReviewResult,
      });

      // レビューJSONの解析
      let review: ReviewResult;
      try {
        review = parseReviewResult(reviewerResult.output);
      } catch (e) {
        console.log(chalk.red('  ⚠️ レビューJSONの解析に失敗しました。パニック防止のためリトライします。'));
        // 🔥 修正箇所: raw プロパティを追加
        review = { 
          approved: false, 
          issues: ['Reviewer JSON parse error'], 
          hints: [], 
          suggestions: [],
          raw: reviewerResult.output // 元の出力を保持
        };
      }

      if (review.approved) {
        localApproved = true;
        console.log(chalk.green(`  ✅ Approved: ${plan.file.split('/').pop()}`));
        break;
      }

      if (i < config.MAX_REVIEW_ITERATIONS - 1) {
        console.log(chalk.yellow(`  🔧 再生成 (修正ループ ${i + 1}/${config.MAX_REVIEW_ITERATIONS})...`));
        
        const retryResult = await runCoderAgent({
          ...ctx,
          code: codeOutput,
          reviewResult: review,
        });

        codeOutput = retryResult.output;
        currentReviewResult = review;
      }
    }

    if (!localApproved) {
      overallApproved = false;
      console.log(chalk.red(`  ❌ 指定回数内に承認が得られませんでした: ${plan.file}`));
    }

    finalCode += '\n\n' + codeOutput;
  }

  /**
   * Step 5: サマリー出力
   */
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  📊 Orchestrator Summary            ║'));
  console.log(chalk.bold.cyan('╠══════════════════════════════════════╣'));
  console.log(chalk.bold.cyan(`║  Files Generated: ${String(macroPlan.plans.length).padEnd(18)}║`));
  console.log(chalk.bold.cyan(`║  Total Iterations: ${String(totalIterations).padEnd(17)}║`));
  console.log(chalk.bold.cyan(`║  Approved Overall: ${String(overallApproved).padEnd(17)}║`));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════╝\n'));

  return {
    finalCode,
    iterations: totalIterations,
    approved: overallApproved,
  };
}