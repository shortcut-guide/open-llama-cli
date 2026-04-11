// src/model/gsd/preflight.ts
import { execFileSync } from 'node:child_process';
import { type PreflightRequirement } from './types.js';

/**
 * gsd-tools.cjs init <command> <phaseNum> を同期実行し、JSON 文字列を返す。
 * 失敗した場合は null を返す（ブロックしない）。
 * init をサポートしないコマンド・失敗時はフォールバックとして find-phase を試みる。
 */
export async function preExecuteGsdToolsInit(
  gsdToolsBin: string,
  commandName: string,
  phaseNum: number | null
): Promise<string | null> {
  const initCommands = new Set([
    'plan-phase', 'execute-phase', 'verify-work', 'new-milestone', 'new-project',
    'quick', 'resume', 'resume-work', 'map-codebase', 'progress', 'manager',
  ]);

  const phaseArg = phaseNum !== null ? [String(phaseNum)] : [];

  if (initCommands.has(commandName)) {
    try {
      const result = execFileSync('node', [gsdToolsBin, 'init', commandName, ...phaseArg], {
        cwd: process.cwd(),
        timeout: 8000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return result.trim() || null;
    } catch {
      // fall through to find-phase
    }
  }

  if (phaseNum !== null) {
    try {
      const result = execFileSync('node', [gsdToolsBin, 'find-phase', String(phaseNum)], {
        cwd: process.cwd(),
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return result.trim() || null;
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * ファイルを書き出す可能性があるコマンドかどうか判定する。
 */
export function isFileWritingCommand(commandName: string): boolean {
  const fileWriters = new Set([
    'discuss-phase', 'plan-phase', 'execute-phase', 'research-phase',
    'verify-work', 'new-milestone', 'new-project', 'complete-milestone',
    'fast', 'do', 'quick', 'audit-milestone', 'audit-uat',
  ]);
  return fileWriters.has(commandName);
}

/**
 * 引数文字列からフェーズ番号を抽出する。
 * 先頭の数値トークンをフェーズ番号として扱う。
 */
export function extractPhaseNumberFromArgs(args: string): number | null {
  const m = args.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * コマンド名に対応する pre-flight 前提ファイル一覧を返す。
 */
export function getPreflightRequirements(commandName: string): PreflightRequirement[] {
  const map: Record<string, PreflightRequirement[]> = {
    'new-milestone': [
      {
        file: 'PROJECT.md',
        missingMessage: 'PROJECT.md が存在しません。先に new-project を実行してください。',
        suggestion: '/gsd:new-project',
      },
    ],
    'plan-phase': [
      {
        file: 'REQUIREMENTS.md',
        missingMessage: 'REQUIREMENTS.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
      {
        file: 'ROADMAP.md',
        missingMessage: 'ROADMAP.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
    ],
    'execute-phase': [
      // フェーズ番号が引数で決まるため動的チェックは gsdAgent 側で実施
    ],
    'verify-work': [
      // 同上
    ],
    'discuss-phase': [
      {
        file: 'ROADMAP.md',
        missingMessage: 'ROADMAP.md が存在しません。',
        suggestion: '/gsd:new-project または /gsd:new-milestone',
      },
    ],
    'complete-milestone': [
      {
        file: 'PROJECT.md',
        missingMessage: 'PROJECT.md が存在しません。',
        suggestion: '/gsd:new-project',
      },
    ],
    'next': [
      {
        file: 'STATE.md',
        missingMessage: 'STATE.md が存在しません。プロジェクトが初期化されていない可能性があります。',
        suggestion: '/gsd:new-project',
      },
    ],
  };

  return map[commandName] ?? [];
}
