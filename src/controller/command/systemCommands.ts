// src/controller/command/systemCommands.ts
import chalk from 'chalk';

import { clearHistory } from '../../model/history/index.js';
import { getAutoWrite, setAutoWrite } from '../state/index.js';

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
└────────────────────────────────┴─────────────────────────────────┘
  自動書き込み現在: `) + autoStatus + '\n');
  return true;
}

export function handleExitCommand(): never {
  console.log(chalk.cyan('\n👋 終了します。\n'));
  process.exit(0);
}