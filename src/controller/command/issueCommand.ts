// src/controller/command/issueCommand.ts
import { execSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';

import { setPendingFileContext } from '../state/index.js';

function isGhAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface IssueDetail {
  number: number;
  title: string;
  state: string;
  body: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  url: string;
  createdAt: string;
}

interface IssueSummary {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  url: string;
  createdAt: string;
}

function handleIssueView(issueNumber: string): void {
  console.log(chalk.cyan(`\n  🔍 Issue #${issueNumber} を取得中...\n`));

  const result = spawnSync(
    'gh',
    ['issue', 'view', issueNumber, '--json',
     'number,title,state,body,author,labels,assignees,url,createdAt'],
    { encoding: 'utf8', stdio: 'pipe' }
  );

  if (result.status !== 0) {
    const errMsg = (result.stderr ?? '').trim();
    if (errMsg.includes('Could not resolve') || errMsg.includes('not found')) {
      console.log(chalk.red(`  ❌ Issue #${issueNumber} が見つかりません。`));
    } else {
      console.error(chalk.red(`  ❌ エラー: ${errMsg}`));
    }
    return;
  }

  let issue: IssueDetail;
  try {
    issue = JSON.parse(result.stdout) as IssueDetail;
  } catch {
    console.error(chalk.red('  ❌ Issue情報のパースに失敗しました'));
    return;
  }

  const stateColor = issue.state === 'OPEN' ? chalk.green : chalk.magenta;
  const labels = issue.labels.map(l => chalk.cyan(`[${l.name}]`)).join(' ');
  const assignees = issue.assignees.map(a => a.login).join(', ') || 'なし';

  console.log(chalk.bold(`  Issue #${issue.number}: ${issue.title}`));
  console.log(`  状態:    ${stateColor(issue.state)}`);
  console.log(`  作成者:  ${issue.author.login}`);
  console.log(`  担当者:  ${assignees}`);
  if (labels) console.log(`  ラベル:  ${labels}`);
  console.log(`  URL:     ${chalk.blue(issue.url)}`);
  console.log('');

  if (issue.body) {
    const bodyLines = issue.body.split('\n').map(l => `  ${l}`).join('\n');
    console.log(chalk.gray('  ── 本文 ──'));
    console.log(bodyLines);
    console.log('');
  }

  // Inject into pendingContext for next LLM message
  const contextText = [
    `## GitHub Issue #${issue.number}: ${issue.title}`,
    `状態: ${issue.state}`,
    `作成者: ${issue.author.login}`,
    `担当者: ${assignees}`,
    issue.labels.length > 0 ? `ラベル: ${issue.labels.map(l => l.name).join(', ')}` : '',
    `URL: ${issue.url}`,
    '',
    '### 内容',
    issue.body ?? '（本文なし）',
  ].filter(line => line !== null).join('\n');

  setPendingFileContext(contextText);
  console.log(chalk.green('  ✅ Issue内容を次のメッセージのコンテキストに追加しました。\n'));
}

function handleIssueList(): void {
  console.log(chalk.cyan('\n  📋 オープンなIssue一覧を取得中...\n'));

  const result = spawnSync(
    'gh',
    ['issue', 'list', '--state', 'open', '--limit', '20',
     '--json', 'number,title,state,author,labels,url,createdAt'],
    { encoding: 'utf8', stdio: 'pipe' }
  );

  if (result.status !== 0) {
    const errMsg = (result.stderr ?? '').trim();
    console.error(chalk.red(`  ❌ エラー: ${errMsg}`));
    return;
  }

  let issues: IssueSummary[];
  try {
    issues = JSON.parse(result.stdout) as IssueSummary[];
  } catch {
    console.error(chalk.red('  ❌ Issue一覧のパースに失敗しました'));
    return;
  }

  if (issues.length === 0) {
    console.log(chalk.gray('  オープンなIssueはありません。\n'));
    return;
  }

  console.log(chalk.bold(`  オープンなIssue (${issues.length}件):\n`));
  for (const issue of issues) {
    const labels = issue.labels.map(l => chalk.cyan(`[${l.name}]`)).join(' ');
    const labelStr = labels ? `  ${labels}` : '';
    console.log(`  ${chalk.green(`#${issue.number}`)}  ${issue.title}${labelStr}`);
    console.log(`       ${chalk.gray(issue.url)}`);
  }
  console.log('');
  console.log(chalk.gray('  特定のIssueを読み込む: /issue <番号>'));
  console.log('');
}

/**
 * /issue <subcommand|number>
 *
 * <number>    : 指定したIssueを取得してコンテキストに注入
 * list        : オープンなIssue一覧を表示
 */
export function handleIssueCommand(input: string): boolean {
  if (!isGhAvailable()) {
    console.log(chalk.red('  ❌ `gh` CLI が見つかりません。インストールと認証を行ってください: https://cli.github.com'));
    return true;
  }

  const parts = input.trim().split(/\s+/).slice(1); // "/issue" を除去
  const sub = parts[0] ?? '';

  if (!sub) {
    console.log(chalk.yellow('  使用法: /issue <番号> | /issue list'));
    return true;
  }

  if (sub === 'list') {
    handleIssueList();
  } else if (/^\d+$/.test(sub)) {
    handleIssueView(sub);
  } else {
    console.log(chalk.yellow(`  ⚠️  不明なサブコマンド: ${sub}`));
    console.log(chalk.gray('  使用法: /issue <番号> | /issue list'));
  }

  return true;
}
