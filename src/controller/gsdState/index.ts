// src/controller/gsdState.ts
import * as path from 'node:path';
import { readPlanningFile, writePlanningFile } from '../../model/gsd/index.js';

// ─── 型定義 ────────────────────────────────────────────────────────────────

export type GsdPhase =
  | 'idle'        // 未初期化
  | 'init'        // new-project / new-milestone 実行中
  | 'planning'    // plan-phase 実行中
  | 'executing'   // execute-phase 実行中
  | 'verifying'   // verify-work 実行中
  | 'done'        // フェーズ完了
  | 'error';      // エラー状態（abort gate トリガー）

export interface GsdWorkflowState {
  phase: GsdPhase;
  currentPhaseNumber: number | null;
  lastCommand: string;
  lastUpdated: string;          // ISO 8601
  errorMessage?: string;
  checkpointData?: Record<string, unknown>; // 任意のワークフロー継続データ
}

// ─── デフォルト値 ──────────────────────────────────────────────────────────

const DEFAULT_STATE: GsdWorkflowState = {
  phase: 'idle',
  currentPhaseNumber: null,
  lastCommand: '',
  lastUpdated: new Date().toISOString(),
};

// ─── STATE.md フォーマット ─────────────────────────────────────────────────

/**
 * GsdWorkflowState を STATE.md の Markdown 文字列に変換する。
 * LLM が読めるよう人間可読フォーマットを維持しつつ、
 * JSON ブロックで機械可読データも埋め込む。
 */
function serialize(state: GsdWorkflowState): string {
  const lines = [
    '# GSD Workflow State',
    '',
    `**Phase:** ${state.phase}`,
    `**Current Phase Number:** ${state.currentPhaseNumber ?? 'N/A'}`,
    `**Last Command:** ${state.lastCommand || 'N/A'}`,
    `**Last Updated:** ${state.lastUpdated}`,
  ];

  if (state.errorMessage) {
    lines.push('', `**Error:** ${state.errorMessage}`);
  }

  lines.push(
    '',
    '<!-- gsd-state-json',
    JSON.stringify(state, null, 2),
    'gsd-state-json -->',
  );

  return lines.join('\n');
}

/**
 * STATE.md の文字列から GsdWorkflowState を復元する。
 * JSON ブロックがあればそちらを優先。
 * パース失敗時は DEFAULT_STATE を返す（abort しない）。
 */
function deserialize(raw: string): GsdWorkflowState {
  // JSON ブロック抽出
  const jsonMatch = raw.match(
    /<!--\s*gsd-state-json\s*([\s\S]*?)\s*gsd-state-json\s*-->/
  );

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Partial<GsdWorkflowState>;
      return {
        ...DEFAULT_STATE,
        ...parsed,
      };
    } catch {
      // fall through to markdown parsing
    }
  }

  // フォールバック: Markdown テキストから最低限の情報を抽出
  const phaseMatch = raw.match(/\*\*Phase:\*\*\s*(\w+)/);
  const phaseNumMatch = raw.match(/\*\*Current Phase Number:\*\*\s*(\d+)/);
  const lastCmdMatch = raw.match(/\*\*Last Command:\*\*\s*(.+)/);

  return {
    ...DEFAULT_STATE,
    phase: (phaseMatch?.[1] as GsdPhase) ?? 'idle',
    currentPhaseNumber: phaseNumMatch ? parseInt(phaseNumMatch[1], 10) : null,
    lastCommand: lastCmdMatch?.[1]?.trim() ?? '',
    lastUpdated: new Date().toISOString(),
  };
}

// ─── 公開 API ─────────────────────────────────────────────────────────────

function getPlanningRoot(): string {
  return path.join(process.cwd(), '.planning');
}

/**
 * STATE.md から現在のワークフロー状態を読み込む。
 * ファイルが存在しない場合は DEFAULT_STATE を返す。
 */
export async function loadGsdState(): Promise<GsdWorkflowState> {
  const planningRoot = getPlanningRoot();
  const raw = await readPlanningFile(planningRoot, 'STATE.md');
  if (!raw) return { ...DEFAULT_STATE };
  return deserialize(raw);
}

/**
 * ワークフロー状態を STATE.md に書き込む。
 */
export async function saveGsdState(
  state: Partial<GsdWorkflowState>
): Promise<void> {
  const planningRoot = getPlanningRoot();
  const current = await loadGsdState();
  const next: GsdWorkflowState = {
    ...current,
    ...state,
    lastUpdated: new Date().toISOString(),
  };
  await writePlanningFile(planningRoot, 'STATE.md', serialize(next));
}

/**
 * Abort Gate 判定:
 * phase === 'error' の場合は true を返す。
 * `--force` フラグが付いている場合はバイパスする。
 */
export async function isBlockingErrorState(force = false): Promise<boolean> {
  if (force) return false;
  const state = await loadGsdState();
  return state.phase === 'error';
}

/**
 * エラー状態をクリアして idle に戻す。
 */
export async function clearErrorState(): Promise<void> {
  await saveGsdState({
    phase: 'idle',
    errorMessage: undefined,
  });
}

/**
 * 指定コマンドに対応する GsdPhase を返す。
 * コマンド実行開始時に state を更新するために使う。
 */
export function commandToPhase(commandName: string): GsdPhase {
  const phaseMap: Record<string, GsdPhase> = {
    'new-project':   'init',
    'new-milestone': 'init',
    'import':        'init',
    'plan-phase':    'planning',
    'discuss-phase': 'planning',
    'research-phase':'planning',
    'execute-phase': 'executing',
    'fast':          'executing',
    'do':            'executing',
    'verify-work':   'verifying',
    'audit-milestone':'verifying',
    'audit-uat':     'verifying',
    'complete-milestone': 'done',
  };

  return phaseMap[commandName] ?? 'idle';
}

/**
 * 現在の状態サマリーを人間可読テキストで返す。
 * display.ts から呼び出すことを想定。
 */
export async function formatStateDisplay(): Promise<string> {
  const state = await loadGsdState();

  const phaseLabel: Record<GsdPhase, string> = {
    idle:      '⚪ 待機中',
    init:      '🟡 初期化中',
    planning:  '🔵 計画中',
    executing: '🟢 実行中',
    verifying: '🟣 検証中',
    done:      '✅ 完了',
    error:     '🔴 エラー',
  };

  const lines = [
    `フェーズ: ${phaseLabel[state.phase]}`,
    state.currentPhaseNumber !== null
      ? `現在フェーズ番号: ${state.currentPhaseNumber}`
      : null,
    state.lastCommand
      ? `最後のコマンド: ${state.lastCommand}`
      : null,
    state.errorMessage
      ? `エラー: ${state.errorMessage}`
      : null,
  ].filter(Boolean);

  return lines.join('\n');
}