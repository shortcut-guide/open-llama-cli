// src/controller/command/prCommand.ts
import { execSync, spawnSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import chalk from 'chalk';

import { callLLM } from '../../model/llm/index.js';
import { getConfig } from '../../config/index.js';

const MAX_DIFF_LINES = 600;

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isGhAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(): string {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  return (result.stdout ?? '').trim();
}

function getDefaultBranch(): string {
  // Try to detect default branch (main or master)
  for (const branch of ['main', 'master']) {
    const result = spawnSync('git', ['rev-parse', '--verify', branch], { encoding: 'utf8' });
    if (result.status === 0) return branch;
  }
  return 'main';
}

function getDiffFromBase(base: string): string {
  const result = spawnSync('git', ['diff', '--color=never', `${base}...HEAD`], { encoding: 'utf8' });
  return (result.stdout ?? '').trim();
}

function getPrTemplate(): string | null {
  const templatePaths = [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/pull_request_template.md',
    'PULL_REQUEST_TEMPLATE.md',
  ];
  for (const tmpl of templatePaths) {
    try {
      const result = spawnSync('cat', [tmpl], { encoding: 'utf8' });
      if (result.status === 0 && result.stdout) return result.stdout.trim();
    } catch {
      // skip
    }
  }
  return null;
}

interface PrMeta {
  title: string;
  body: string;
}

async function generatePrMeta(diff: string, template: string | null): Promise<PrMeta> {
  const config = getConfig();
  const templateSection = template
    ? `\nまた、以下のPRテンプレートに沿った形式で本文を書いてください:\n\`\`\`\n${template}\n\`\`\`\n`
    : '';

  const prompt = [
    '以下の git diff をもとに、GitHubプルリクエストのタイトルと本文を日本語で生成してください。',
    templateSection,
    '出力は必ず以下のJSON形式のみで返してください（コードブロック不要）:',
    '{"title":"PRタイトル","body":"PR本文"}',
    '',
    '```diff',
    diff,
    '```',
  ].join('\n');

  const raw = await callLLM(
    [{ role: 'user', content: prompt }],
    { printStream: false, temperature: 0.3, llmUrl: config.LLM_API_URL }
  );

  // Extract JSON from raw response
  const match = raw.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
  if (!match) throw new Error('LLMからのJSONパースに失敗しました');
  return JSON.parse(match[0]) as PrMeta;
}

async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await rl.question(question);
  return answer.trim().toLowerCase() === 'y' || answer.trim() === '';
}

async function handlePrCreate(force: boolean, rl: readline.Interface): Promise<void> {
  if (!isGhAvailable()) {
    console.log(chalk.red('  ❌ `gh` CLI が見つかりません。インストールと認証を行ってください: https://cli.github.com'));
    return;
  }

  const branch = getCurrentBranch();
  if (branch === 'HEAD') {
    console.log(chalk.red('  ❌ detached HEAD 状態です。ブランチをチェックアウトしてください。'));
    return;
  }

  const base = getDefaultBranch();
  if (branch === base) {
    console.log(chalk.yellow(`  ⚠️  現在 ${base} ブランチにいます。feature ブランチに切り替えてください。`));
    return;
  }

  console.log(chalk.cyan(`\n  🔍 差分を取得中... (${base}...${branch})\n`));
  const diff = getDiffFromBase(base);

  if (!diff) {
    console.log(chalk.gray(`  変更なし（${base} との差分が見つかりません）`));
    return;
  }

  const lines = diff.split('\n');
  let diffForLLM = diff;
  if (lines.length > MAX_DIFF_LINES) {
    diffForLLM = lines.slice(0, MAX_DIFF_LINES).join('\n');
    console.log(chalk.yellow(`  ⚠️  差分が大きいため先頭 ${MAX_DIFF_LINES} 行のみをLLMに渡します（全 ${lines.length} 行）\n`));
  }

  const template = getPrTemplate();
  if (template) {
    console.log(chalk.gray('  📄 PRテンプレートを検出しました'));
  }

  console.log(chalk.cyan('  🤖 タイトルと説明文を生成中...\n'));
  let meta: PrMeta;
  try {
    meta = await generatePrMeta(diffForLLM, template);
  } catch (e: unknown) {
    console.error(chalk.red(`  ❌ 生成エラー: ${(e as Error).message}`));
    return;
  }

  console.log(chalk.bold('\n  ── 生成されたPR情報 ──'));
  console.log(chalk.green(`  タイトル: ${meta.title}`));
  console.log(chalk.white(`\n  本文:\n`));
  console.log(meta.body.split('\n').map(l => `    ${l}`).join('\n'));
  console.log('');

  if (!force) {
    const ok = await confirm(rl, chalk.yellow('  このPRを作成しますか？ [Y/n]: '));
    if (!ok) {
      console.log(chalk.gray('  キャンセルしました。'));
      return;
    }
  }

  console.log(chalk.cyan('  🚀 PRを作成中...\n'));
  const result = spawnSync(
    'gh',
    ['pr', 'create', '--title', meta.title, '--body', meta.body, '--base', base],
    { encoding: 'utf8', stdio: 'pipe' }
  );

  if (result.status === 0) {
    const url = (result.stdout ?? '').trim();
    console.log(chalk.green(`  ✅ PR作成完了: ${url}\n`));
  } else {
    const errMsg = (result.stderr ?? '').trim();
    console.error(chalk.red(`  ❌ PR作成に失敗しました:\n    ${errMsg}\n`));
  }
}

async function handlePrStatus(): Promise<void> {
  if (!isGhAvailable()) {
    console.log(chalk.red('  ❌ `gh` CLI が見つかりません。インストールと認証を行ってください: https://cli.github.com'));
    return;
  }

  const branch = getCurrentBranch();
  console.log(chalk.cyan(`\n  📋 PR状態を確認中... (ブランチ: ${branch})\n`));

  const result = spawnSync(
    'gh',
    ['pr', 'view', '--json', 'number,title,state,url,reviews,statusCheckRollup,isDraft'],
    { encoding: 'utf8', stdio: 'pipe' }
  );

  if (result.status !== 0) {
    const errMsg = (result.stderr ?? '').trim();
    if (errMsg.includes('no pull requests found') || errMsg.includes('could not find any pull requests')) {
      console.log(chalk.gray(`  このブランチ (${branch}) にはPRが存在しません。\n`));
      console.log(chalk.gray('  作成するには: /pr create\n'));
    } else {
      console.error(chalk.red(`  ❌ エラー: ${errMsg}\n`));
    }
    return;
  }

  let pr: {
    number: number;
    title: string;
    state: string;
    url: string;
    isDraft: boolean;
    reviews?: Array<{ state: string }>;
    statusCheckRollup?: Array<{ conclusion: string; status: string; name: string }>;
  };

  try {
    pr = JSON.parse(result.stdout);
  } catch {
    console.error(chalk.red('  ❌ PR情報のパースに失敗しました'));
    return;
  }

  const stateColor =
    pr.state === 'OPEN' ? chalk.green :
    pr.state === 'MERGED' ? chalk.magenta :
    chalk.red;

  console.log(chalk.bold(`  PR #${pr.number}: ${pr.title}`));
  console.log(`  状態: ${stateColor(pr.state)}${pr.isDraft ? chalk.yellow(' (Draft)') : ''}`);
  console.log(`  URL:  ${chalk.blue(pr.url)}`);

  // CI status
  if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
    console.log('');
    console.log(chalk.cyan('  CI/チェック状態:'));
    for (const check of pr.statusCheckRollup) {
      const conclusion = check.conclusion ?? check.status ?? 'PENDING';
      const icon =
        conclusion === 'SUCCESS' ? chalk.green('✅') :
        conclusion === 'FAILURE' ? chalk.red('❌') :
        conclusion === 'SKIPPED' ? chalk.gray('⏭️') :
        chalk.yellow('⏳');
      console.log(`    ${icon} ${check.name} (${conclusion})`);
    }
  }

  // Review status
  if (pr.reviews && pr.reviews.length > 0) {
    const latest = pr.reviews[pr.reviews.length - 1];
    const reviewColor =
      latest.state === 'APPROVED' ? chalk.green :
      latest.state === 'CHANGES_REQUESTED' ? chalk.red :
      chalk.yellow;
    console.log('');
    console.log(`  レビュー: ${reviewColor(latest.state)}`);
  }

  console.log('');
}

/**
 * /pr <subcommand> [options]
 *
 * create [--force]  : LLMでタイトル・本文を生成してPR作成
 * status            : カレントブランチのPR状態を表示
 */
export async function handlePrCommand(
  input: string,
  rl: readline.Interface
): Promise<boolean> {
  if (!isGitRepo()) {
    console.log(chalk.red('  ❌ git リポジトリが見つかりません'));
    return true;
  }

  const parts = input.split(/\s+/).slice(1); // "/pr" を除去
  const sub = parts[0] ?? 'status';

  if (sub === 'create') {
    const force = parts.includes('--force');
    await handlePrCreate(force, rl);
  } else if (sub === 'status') {
    await handlePrStatus();
  } else {
    console.log(chalk.yellow(`  ⚠️  不明なサブコマンド: ${sub}`));
    console.log(chalk.gray('  使用法: /pr create [--force] | /pr status'));
  }

  return true;
}
