// src/controller/command/mcpCommand.ts
import chalk from 'chalk';
import {
  loadMcpConfig,
  addMcpServer,
  removeMcpServer,
  getMcpConfigPath,
  connectServer,
  disconnectServer,
  getServerStates,
  getServerState,
} from '../../model/mcp/index.js';

const USAGE = chalk.cyan(`
  使い方:
    /mcp list                              サーバー一覧と接続状態を表示
    /mcp add <name> <command> [args...]    サーバーを追加
    /mcp remove <name>                     サーバーを削除
    /mcp connect <name>                    サーバーに接続
    /mcp disconnect <name>                 サーバーから切断
    /mcp tools [name]                      ツール一覧を表示
`);

function statusIcon(status: string): string {
  switch (status) {
    case 'connected':    return chalk.green('●');
    case 'connecting':   return chalk.yellow('○');
    case 'error':        return chalk.red('✕');
    default:             return chalk.gray('○');
  }
}

async function handleList(): Promise<void> {
  const config = await loadMcpConfig();
  const configuredNames = Object.keys(config.servers);

  if (configuredNames.length === 0) {
    console.log(chalk.gray(`\n  MCPサーバーが設定されていません。`));
    console.log(chalk.gray(`  設定ファイル: ${getMcpConfigPath()}`));
    console.log(chalk.gray(`  追加するには: /mcp add <name> <command> [args...]\n`));
    return;
  }

  console.log(chalk.cyan(`\n  MCPサーバー一覧 (設定: ${getMcpConfigPath()})\n`));
  console.log(chalk.gray(`  ${'名前'.padEnd(20)} ${'状態'.padEnd(12)} ${'コマンド'}`));
  console.log(chalk.gray(`  ${'─'.repeat(60)}`));

  for (const name of configuredNames) {
    const serverCfg = config.servers[name];
    const runtimeState = getServerState(name);
    const status = runtimeState?.status ?? 'disconnected';
    const icon = statusIcon(status);
    const statusLabel = status === 'connected'
      ? chalk.green(status)
      : status === 'error'
      ? chalk.red(status)
      : chalk.gray(status);
    const cmd = [serverCfg.command, ...(serverCfg.args ?? [])].join(' ');
    console.log(`  ${icon} ${name.padEnd(19)} ${statusLabel.padEnd(22)} ${chalk.white(cmd)}`);
    if (runtimeState?.status === 'connected') {
      console.log(chalk.gray(`    ツール: ${runtimeState.tools.length}件`));
    }
    if (runtimeState?.error) {
      console.log(chalk.red(`    エラー: ${runtimeState.error}`));
    }
  }
  console.log();
}

async function handleAdd(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.red('  使い方: /mcp add <name> <command> [args...]'));
    return;
  }
  const [name, command, ...rest] = args;
  await addMcpServer(name, { command, args: rest.length > 0 ? rest : undefined });
  console.log(chalk.green(`  ✅ MCPサーバー "${name}" を追加しました。`));
  console.log(chalk.gray(`  接続するには: /mcp connect ${name}`));
}

async function handleRemove(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.log(chalk.red('  使い方: /mcp remove <name>'));
    return;
  }
  const [name] = args;
  await disconnectServer(name);
  const removed = await removeMcpServer(name);
  if (removed) {
    console.log(chalk.green(`  ✅ MCPサーバー "${name}" を削除しました。`));
  } else {
    console.log(chalk.yellow(`  ⚠️  MCPサーバー "${name}" が見つかりません。`));
  }
}

async function handleConnect(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.log(chalk.red('  使い方: /mcp connect <name>'));
    return;
  }
  const [name] = args;
  console.log(chalk.gray(`  MCPサーバー "${name}" に接続中...`));
  try {
    const state = await connectServer(name);
    if (state.status === 'connected') {
      console.log(chalk.green(`  ✅ "${name}" に接続しました。ツール: ${state.tools.length}件`));
    } else {
      console.log(chalk.red(`  ❌ "${name}" への接続に失敗しました: ${state.error}`));
    }
  } catch (err) {
    console.log(chalk.red(`  ❌ エラー: ${(err as Error).message}`));
  }
}

async function handleDisconnect(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.log(chalk.red('  使い方: /mcp disconnect <name>'));
    return;
  }
  const [name] = args;
  await disconnectServer(name);
  console.log(chalk.green(`  ✅ MCPサーバー "${name}" から切断しました。`));
}

async function handleTools(args: string[]): Promise<void> {
  const states = getServerStates().filter(s => s.status === 'connected');

  if (states.length === 0) {
    console.log(chalk.gray('\n  接続中のMCPサーバーがありません。'));
    console.log(chalk.gray('  接続するには: /mcp connect <name>\n'));
    return;
  }

  const filterName = args[0];
  const targets = filterName ? states.filter(s => s.name === filterName) : states;

  if (filterName && targets.length === 0) {
    console.log(chalk.yellow(`  ⚠️  サーバー "${filterName}" は接続されていません。`));
    return;
  }

  console.log(chalk.cyan('\n  MCP ツール一覧\n'));
  for (const state of targets) {
    console.log(chalk.green(`  [${state.name}]`));
    if (state.tools.length === 0) {
      console.log(chalk.gray('    ツールなし'));
    }
    for (const tool of state.tools) {
      console.log(`    ${chalk.white(tool.name)}`);
      if (tool.description) {
        console.log(chalk.gray(`      ${tool.description}`));
      }
    }
  }
  console.log();
}

export async function handleMcpCommand(trimmed: string): Promise<boolean> {
  const parts = trimmed.slice(4).trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  switch (subcommand) {
    case 'list':
    case '':
    case undefined:
      await handleList();
      break;
    case 'add':
      await handleAdd(args);
      break;
    case 'remove':
    case 'rm':
    case 'delete':
      await handleRemove(args);
      break;
    case 'connect':
      await handleConnect(args);
      break;
    case 'disconnect':
      await handleDisconnect(args);
      break;
    case 'tools':
      await handleTools(args);
      break;
    default:
      console.log(chalk.yellow(`  ⚠️  不明なサブコマンド: "${subcommand}"`));
      console.log(USAGE);
  }

  return true;
}
