// src/view/display/gsdStatus.ts
import chalk from 'chalk';
import { loadGsdState, type GsdWorkflowState, type GsdPhase } from '../../controller/gsdState/index.js';

const PHASE_ICON: Record<GsdPhase, string> = {
  idle:      '⚪',
  init:      '🟡',
  planning:  '🔵',
  executing: '🟢',
  verifying: '🟣',
  done:      '✅',
  error:     '🔴',
};

const PHASE_LABEL: Record<GsdPhase, string> = {
  idle:      '待機中',
  init:      '初期化中',
  planning:  '計画中',
  executing: '実行中',
  verifying: '検証中',
  done:      '完了',
  error:     'エラー',
};

/**
 * 起動時に .planning/STATE.md が存在すれば GSD 状態を表示する。
 * idle の場合は何も表示しない。
 */
export async function printGsdStatusIfActive(): Promise<void> {
  let state: GsdWorkflowState;
  try {
    state = await loadGsdState();
  } catch {
    return;
  }

  if (state.phase === 'idle') return;

  const icon  = PHASE_ICON[state.phase];
  const label = PHASE_LABEL[state.phase];
  const phaseNum = state.currentPhaseNumber !== null
    ? ` (Phase ${state.currentPhaseNumber})`
    : '';
  const line =
    `  ${icon} GSD: ${label}${phaseNum}` +
    (state.lastCommand ? chalk.gray(` — 最後: /gsd:${state.lastCommand}`) : '');

  if (state.phase === 'error') {
    console.log(chalk.red(line));
    if (state.errorMessage) {
      console.log(chalk.red(`     ${state.errorMessage}`));
    }
  } else {
    console.log(chalk.cyan(line));
  }
}

/**
 * .planning/ 書き込み結果の表示。
 */
export function printPlanningWriteSummary(written: string[]): void {
  if (written.length === 0) return;
  console.log(chalk.green(`\n💾 .planning/ に ${written.length} ファイルを保存:`));
  for (const f of written) {
    console.log(chalk.gray(`   ${f}`));
  }
}
