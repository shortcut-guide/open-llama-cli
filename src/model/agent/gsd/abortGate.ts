// src/model/agent/gsd/abortGate.ts
import chalk from 'chalk';
import { loadGsdState, saveGsdState, isBlockingErrorState } from '../../../controller/gsdState.js';

export class GsdAbortError extends Error {
  constructor(msg: string) { super(msg); this.name = 'GsdAbortError'; }
}

export async function runAbortGate(commandName: string, force: boolean): Promise<void> {
  const blocking = await isBlockingErrorState(force);
  if (!blocking) return;

  const state = await loadGsdState();
  throw new GsdAbortError(
    `STATE.md がエラー状態です: ${state.errorMessage ?? '原因不明'}\n` +
    `解決後に再実行するか、"/gsd:next --force" でバイパスしてください。`
  );
}
