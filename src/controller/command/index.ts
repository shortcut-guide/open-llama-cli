// src/controller/command.ts
import * as readline from 'node:readline/promises';

import { CommandContext } from './types.js';
import { handleAgentCommand } from './agentCommand.js';
import { handleGsdCommand } from './gsdCommand.js';
import {
  handleSearchCommand,
  handleReadCommand,
  handleWriteCommand,
  handleReplaceCommand,
  handleDeleteCommand,
} from './fileCommands.js';
import {
  handleAutowriteCommand,
  handleClearCommand,
  handleHelpCommand,
  handleExitCommand,
  handleTerminalSetupCommand,
  handleRewindCommand,
  handleContextCommand,
  handleCompactCommand,
} from './systemCommands.js';
import { handleShellCommand } from './shellCommand.js';
import { handleDiffCommand } from './diffCommand.js';

export { CommandContext } from './types.js';
export { getAutoWrite, setAutoWrite, getPendingFileContext, clearPendingFileContext } from '../state/index.js';
export { parseAgentCommand } from './agentCommand.js';
export { parseGsdInput } from './gsdCommand.js';
export type { TaskType, AgentCommand } from './types.js';

// 後方互換: pendingFileContext の直接参照が他ファイルに存在する場合のみ残す
// 新規コードでは state.ts の関数を使うこと
export { setPendingFileContext as _setPendingFileContext } from '../state/index.js';

export async function handleCommand(
  userInput: string,
  rl: readline.Interface,
  ctx: CommandContext
): Promise<boolean> {
  const trimmed = userInput.trim();

  // シェルコマンド直接実行: ! プレフィックス
  if (trimmed.startsWith('!'))            return handleShellCommand(trimmed);

  // GSD ワークフローコマンド: /gsd:<name> [args]
  if (trimmed.startsWith('/gsd:'))        return handleGsdCommand(trimmed, rl, ctx);

  if (trimmed.startsWith('/agent'))       return handleAgentCommand(trimmed, rl, ctx);
  if (trimmed.startsWith('/autowrite'))   return handleAutowriteCommand(trimmed);
  if (trimmed.startsWith('/search '))     return handleSearchCommand(trimmed);
  if (trimmed.startsWith('/read '))       return handleReadCommand(trimmed);
  if (trimmed.startsWith('/write '))      return handleWriteCommand(trimmed, rl);
  if (trimmed.startsWith('/replace '))    return handleReplaceCommand(trimmed);
  if (trimmed.startsWith('/delete '))     return handleDeleteCommand(trimmed, rl);
  if (trimmed.startsWith('/diff'))         return handleDiffCommand(trimmed, ctx);
  if (trimmed === '/clear')               return handleClearCommand();
  if (trimmed === '/rewind')              return handleRewindCommand();
  if (trimmed === '/context')             return handleContextCommand(ctx);
  if (trimmed === '/compact')             return handleCompactCommand(ctx);
  if (trimmed === '/help')                return handleHelpCommand();
  if (trimmed === '/terminal-setup')      return handleTerminalSetupCommand();
  if (trimmed === '/exit' || trimmed === '/quit') handleExitCommand();

  return false;
}