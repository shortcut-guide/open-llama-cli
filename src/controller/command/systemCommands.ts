// src/controller/command/systemCommands.ts
import chalk from 'chalk';

import { clearHistory, rewindHistory, getTokenUsage } from '../../model/history/index.js';
import { popFromStack, restoreBackup, getStackSize } from '../../model/backup/index.js';
import { getAutoWrite, setAutoWrite } from '../state/index.js';
import { callLLM } from '../../model/llm/index.js';
import { getConfig } from '../../config/index.js';
import { saveHistory } from '../../model/history/index.js';
import type { CommandContext } from './types.js';

export async function handleAutowriteCommand(trimmed: string): Promise<boolean> {
  const arg = trimmed.slice(10).trim().toLowerCase();
  if (arg === 'on') setAutoWrite(true);
  else if (arg === 'off') setAutoWrite(false);
  else setAutoWrite(!getAutoWrite());

  console.log(
    getAutoWrite()
      ? chalk.green('  🟢 自動書き込み: ON')
      : chalk.gray('  ⚪ 自動書き込み: OFF（確認あり）')
  );
  return true;
}

export async function handleClearCommand(): Promise<boolean> {
  try {
    await clearHistory();
    console.log(chalk.green('  ✅ 履歴をクリアしました。'));
  } catch {
    console.log(chalk.gray('  履歴ファイルが存在しません。'));
  }
  return true;
}

export function handleTerminalSetupCommand(): boolean {
  console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────────┐
│  マルチライン入力のセットアップ                                        │
├──────────────────────────────────────────────────────────────────────┤
│  Shift+Enter で改行を挿入するには端末の設定が必要です。                │
│                                                                      │
│  【iTerm2】                                                           │
│  Preferences → Profiles → Keys → Key Mappings                       │
│  + を押して追加:                                                      │
│    Keyboard Shortcut: Shift+Enter                                    │
│    Action: Send Escape Sequence                                      │
│    Esc+: \\r  (バックスラッシュ r)                                   │
│                                                                      │
│  【Kitty】                                                            │
│  ~/.config/kitty/kitty.conf に追加:                                  │
│    map shift+enter send_text all \\x1b[13;2u                         │
│                                                                      │
│  【WezTerm】                                                          │
│  wezterm.lua に追加:                                                  │
│    keys = {{ key="Return", mods="SHIFT",                             │
│             action=act.SendString("\\x1b\\r") }}                     │
│                                                                      │
│  設定後は端末を再起動してください。                                    │
│  設定なしでも複数行ペーストはそのまま動作します。                      │
└──────────────────────────────────────────────────────────────────────┘
`));
  return true;
}

export function handleHelpCommand(): boolean {
  const autoStatus = getAutoWrite() ? chalk.green('ON') : chalk.gray('OFF');
  console.log(chalk.cyan(`
┌──────────────────────────────────────────────────────────────────┐
│  コマンド一覧                                                      │
├────────────────────────────────┬─────────────────────────────────┤
│  GSD ワークフロー                                                  │
│  /gsd:help                     │ GSDコマンド一覧を表示            │
│  /gsd:status                   │ ワークフロー状態を表示           │
│  /gsd:new-project              │ プロジェクト新規初期化           │
│  /gsd:new-milestone <name>     │ 新マイルストーン開始             │
│  /gsd:plan-phase <N>           │ フェーズ N の計画生成            │
│  /gsd:execute-phase <N>        │ フェーズ N を実行                │
│  /gsd:verify-work <N>          │ フェーズ N の成果物を検証        │
│  /gsd:next [--force]           │ 次のステップへ自動進行           │
├────────────────────────────────┼─────────────────────────────────┤
│  Multi-Agent / ファイル操作                                        │
│  /agent <task>                 │ Multi-Agent モードで実行         │
│  /autowrite [on|off]           │ 自動書き込みトグル               │
│  /search <glob>                │ globでファイル検索               │
│  /search <glob> --content <re> │ ファイル内容を正規表現検索       │
│  /read <path>                  │ ファイル表示 + 次発言へ注入      │
│  /write <path>                 │ 対話入力でファイル書き込み       │
│  /replace <path> <s> => <r>    │ 文字列置換                       │
│  /delete <path>                │ ファイル削除（確認あり）          │
│  /clear                        │ チャット履歴をクリア             │
│  /rewind                       │ 直前ターンの変更をロールバック   │
│  /context                      │ トークン使用量を表示             │
│  /compact                      │ 会話を要約・圧縮                 │
│  /exit                         │ 終了                             │
├────────────────────────────────┼─────────────────────────────────┤
│  シェル実行                                                        │
│  !<コマンド>                   │ ローカルシェルで直接実行         │
│  例: !npm run build            │ ビルド実行                       │
│  例: !git status               │ git状態確認                      │
├────────────────────────────────┼─────────────────────────────────┤
│  入力操作                                                          │
│  Shift+Enter                   │ 改行挿入（端末設定が必要）       │
│  複数行ペースト                │ そのまま貼り付け可能             │
│  Ctrl+U                        │ 現在行をクリア                   │
│  /terminal-setup               │ 端末設定の案内を表示             │
│  /diff [--staged] [--review]  │ git diff をカラー表示・AIレビュー│
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
  return true;
}

export function handleContextCommand(ctx: CommandContext): boolean {
  const config = getConfig();
  const usage = getTokenUsage(ctx.history, config.MAX_TOKENS);

  const BAR_WIDTH = 40;
  const filled = Math.round((usage.usagePercent / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const barFill = '█'.repeat(filled) + '░'.repeat(empty);
  const barColor =
    usage.usagePercent >= 80 ? chalk.red :
    usage.usagePercent >= 60 ? chalk.yellow :
    chalk.green;

  console.log(chalk.cyan('\n  📊 コンテキストウィンドウ使用状況'));
  console.log(chalk.gray('  ─────────────────────────────────────────'));
  console.log(`  システムプロンプト : ${chalk.white(usage.systemTokens.toLocaleString())} トークン`);
  console.log(`  会話履歴           : ${chalk.white(usage.historyTokens.toLocaleString())} トークン`);
  console.log(`  合計               : ${chalk.white(usage.totalTokens.toLocaleString())} / ${usage.maxTokens.toLocaleString()} トークン`);
  console.log(`\n  [${barColor(barFill)}] ${barColor(usage.usagePercent + '%')}\n`);

  if (usage.usagePercent >= 80) {
    console.log(chalk.red('  ⚠️  使用率が80%を超えています。/compact で圧縮することをお勧めします。\n'));
  }
  return true;
}

export async function handleCompactCommand(ctx: CommandContext): Promise<boolean> {
  const config = getConfig();
  const usage = getTokenUsage(ctx.history, config.MAX_TOKENS);

  console.log(chalk.cyan(`\n  🗜️  会話を圧縮します... (現在 ${usage.totalTokens.toLocaleString()} トークン)`));

  // Backup: save current history to a timestamped file
  const backupPath = `chat_history.backup.${Date.now()}.json`;
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(backupPath, JSON.stringify(ctx.history, null, 2), 'utf-8');
    console.log(chalk.gray(`  💾 バックアップ保存: ${backupPath}`));
  } catch {
    console.log(chalk.yellow('  ⚠️  バックアップの保存に失敗しました。続行します。'));
  }

  // Build summary prompt from non-system messages
  const conversationText = ctx.history
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  if (!conversationText.trim()) {
    console.log(chalk.gray('  圧縮する会話がありません。\n'));
    return true;
  }

  try {
    console.log(chalk.gray('  要約中...'));
    const summary = await callLLM(
      [{ role: 'user', content: `以下の会話を、重要な情報・決定事項・コードの変更点を漏れなく含めて簡潔に要約してください。この要約は今後の会話のコンテキストとして使われます。\n\n${conversationText}` }],
      { printStream: false, temperature: 0.3 }
    );

    // Get the original system message
    const systemMsg = ctx.history.find(m => m.role === 'system');

    // Replace history: keep system prompt + add summary as system message
    ctx.history.length = 0;
    if (systemMsg) ctx.history.push(systemMsg);
    ctx.history.push({ role: 'system', content: `【会話要約】\n${summary}` });

    await saveHistory(ctx.history);

    const newUsage = getTokenUsage(ctx.history, config.MAX_TOKENS);
    console.log(chalk.green(`  ✅ 圧縮完了: ${usage.totalTokens.toLocaleString()} → ${newUsage.totalTokens.toLocaleString()} トークン\n`));
  } catch (e: unknown) {
    console.error(chalk.red(`  ❌ 圧縮に失敗しました: ${(e as Error).message}\n`));
  }

  return true;
}

export function handleExitCommand(): never {
  console.log(chalk.cyan('\n👋 終了します。\n'));
  process.exit(0);
}

export async function handleRewindCommand(): Promise<boolean> {
  const remaining = await getStackSize();
  if (remaining === 0) {
    console.log(chalk.yellow('  ⚠️  巻き戻せるターンがありません。'));
    return true;
  }

  const entry = await popFromStack();
  if (!entry) {
    console.log(chalk.yellow('  ⚠️  巻き戻せるターンがありません。'));
    return true;
  }

  // Restore files
  if (entry.files.length > 0) {
    try {
      await restoreBackup(entry);
      console.log(chalk.green(`  ✅ ${entry.files.length}件のファイルを復元しました。`));
    } catch (e: unknown) {
      console.error(chalk.red(`  ❌ ファイル復元に失敗しました: ${(e as Error).message}`));
    }
  }

  // Rewind chat history
  const rewound = await rewindHistory();
  if (rewound) {
    console.log(chalk.green('  ✅ チャット履歴を1ターン巻き戻しました。'));
  } else {
    console.log(chalk.gray('  チャット履歴に巻き戻す内容がありませんでした。'));
  }

  const newSize = await getStackSize();
  if (newSize > 0) {
    console.log(chalk.gray(`  ℹ️  さらに ${newSize} ターン巻き戻せます。`));
  }

  return true;
}