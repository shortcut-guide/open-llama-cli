// src/controller/command.ts
import * as readline from 'node:readline/promises';

import { CommandContext } from './command/types.js';
import { handleAgentCommand } from './command/agentCommand.js';
import {
  handleSearchCommand,
  handleReadCommand,
  handleWriteCommand,
  handleReplaceCommand,
  handleDeleteCommand,
} from './command/fileCommands.js';
import {
  handleAutowriteCommand,
  handleClearCommand,
  handleHelpCommand,
  handleExitCommand,
} from './command/systemCommands.js';

export { CommandContext } from './command/types.js';
export { getAutoWrite, setAutoWrite, getPendingFileContext, clearPendingFileContext } from './state.js';
export { parseAgentCommand } from './command/agentCommand.js';
export type { TaskType, AgentCommand } from './command/types.js';

// 後方互換: pendingFileContext の直接参照が他ファイルに存在する場合のみ残す
// 新規コードでは state.ts の関数を使うこと
export { setPendingFileContext as _setPendingFileContext } from './state.js';

export async function handleCommand(
  userInput: string,
  rl: readline.Interface,
  ctx: CommandContext
): Promise<boolean> {
  const trimmed = userInput.trim();

  if (trimmed.startsWith('/agent'))      return handleAgentCommand(trimmed, rl, ctx);
  if (trimmed.startsWith('/autowrite'))  return handleAutowriteCommand(trimmed);
  if (trimmed.startsWith('/search '))    return handleSearchCommand(trimmed);
  if (trimmed.startsWith('/read '))      return handleReadCommand(trimmed);
  if (trimmed.startsWith('/write '))     return handleWriteCommand(trimmed, rl);
  if (trimmed.startsWith('/replace '))   return handleReplaceCommand(trimmed);
  if (trimmed.startsWith('/delete '))    return handleDeleteCommand(trimmed, rl);
  if (trimmed === '/clear')              return handleClearCommand();
  if (trimmed === '/help')               return handleHelpCommand();
  if (trimmed === '/exit' || trimmed === '/quit') handleExitCommand();

  return false;
}
