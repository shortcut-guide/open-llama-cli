// src/controller/command/sessionCommands.ts
import chalk from 'chalk';
import type { Message } from '../../model/llm/index.js';
import {
  listSessions,
  findSession,
  renameSession,
  createSession,
  setCurrentSessionId,
  getCurrentSessionId,
  getSessionHistoryPath,
  type SessionMeta,
} from '../../model/session/index.js';
import { loadHistory, saveHistory } from '../../model/history/index.js';

export interface SessionCommandContext {
  history: Message[];
  fullSystemPrompt: string;
}

export async function handleSessionCommand(
  trimmed: string,
  ctx: SessionCommandContext
): Promise<boolean> {
  const args = trimmed.slice('/session'.length).trim();

  if (args === 'list' || args === '') {
    return handleSessionList();
  }

  if (args === 'new') {
    return handleSessionNew(ctx);
  }

  console.log(chalk.yellow(`  ⚠️  不明なサブコマンド: /session ${args}`));
  console.log(chalk.gray('  使用例: /session list  |  /session new'));
  return true;
}

async function handleSessionList(): Promise<boolean> {
  const sessions = await listSessions();
  const currentId = await getCurrentSessionId();

  if (sessions.length === 0) {
    console.log(chalk.gray('\n  セッションがありません。'));
    return true;
  }

  console.log(chalk.cyan('\n  📋 セッション一覧'));
  console.log(chalk.gray('  ──────────────────────────────────────────────────────'));

  for (const s of sessions) {
    const isCurrent = s.id === currentId;
    const marker = isCurrent ? chalk.green('▶ ') : '  ';
    const nameStr = isCurrent ? chalk.green(s.name) : chalk.white(s.name);
    const date = new Date(s.createdAt).toLocaleString('ja-JP');
    const msgStr = chalk.gray(`${s.messageCount} メッセージ`);
    const idStr = chalk.gray(`[${s.id.slice(0, 8)}]`);
    console.log(`  ${marker}${nameStr}  ${idStr}  ${chalk.gray(date)}  ${msgStr}`);
  }

  console.log(chalk.gray('\n  /resume <name|id>  でセッションを切り替え'));
  console.log(chalk.gray('  /rename <name>     でセッション名を変更\n'));
  return true;
}

async function handleSessionNew(ctx: SessionCommandContext): Promise<boolean> {
  const meta = await createSession();
  await setCurrentSessionId(meta.id);

  // Reset in-memory history to fresh state
  ctx.history.length = 0;
  const fresh = await loadHistory(ctx.fullSystemPrompt);
  ctx.history.push(...fresh);

  console.log(chalk.green(`\n  ✅ 新しいセッションを作成しました: ${chalk.white(meta.name)}`));
  console.log(chalk.gray(`  ID: ${meta.id.slice(0, 8)}`));
  console.log(chalk.gray('  /rename <name> でセッション名を変更できます\n'));
  return true;
}

export async function handleResumeCommand(
  trimmed: string,
  ctx: SessionCommandContext
): Promise<boolean> {
  const query = trimmed.slice('/resume'.length).trim();

  if (!query) {
    return handleSessionList();
  }

  const session = await findSession(query);
  if (!session) {
    console.log(chalk.red(`\n  ❌ セッションが見つかりません: "${query}"`));
    console.log(chalk.gray('  /session list で一覧を確認してください\n'));
    return true;
  }

  const currentId = await getCurrentSessionId();
  if (session.id === currentId) {
    console.log(chalk.yellow(`\n  既にこのセッションです: ${chalk.white(session.name)}\n`));
    return true;
  }

  // Save current history before switching
  await saveHistory(ctx.history);

  // Switch session
  await setCurrentSessionId(session.id);

  // Load new session's history into memory
  ctx.history.length = 0;
  const loaded = await loadHistory(ctx.fullSystemPrompt);
  ctx.history.push(...loaded);

  console.log(chalk.green(`\n  ✅ セッションを切り替えました: ${chalk.white(session.name)}`));
  console.log(chalk.gray(`  ID: ${session.id.slice(0, 8)}  |  作成: ${new Date(session.createdAt).toLocaleString('ja-JP')}\n`));
  return true;
}

export async function handleRenameCommand(trimmed: string): Promise<boolean> {
  const newName = trimmed.slice('/rename'.length).trim();

  if (!newName) {
    console.log(chalk.yellow('  使用例: /rename <新しい名前>'));
    return true;
  }

  const currentId = await getCurrentSessionId();
  if (!currentId) {
    console.log(chalk.red('  ❌ アクティブなセッションがありません。'));
    return true;
  }

  const success = await renameSession(currentId, newName);
  if (success) {
    console.log(chalk.green(`  ✅ セッション名を変更しました: ${chalk.white(newName)}`));
  } else {
    console.log(chalk.red('  ❌ セッションが見つかりません。'));
  }

  return true;
}
