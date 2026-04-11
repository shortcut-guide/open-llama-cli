// src/model/gsd/planning.ts
import * as fs from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import * as path from 'node:path';
import { resolvePlanningPath } from './paths.js';

/**
 * .planning/ 配下の主要ファイルの内容をスナップショットとして返す。
 * 存在しないファイルはスキップ。phaseNum が指定されている場合はフェーズ固有ファイルも含む。
 */
export async function buildPlanningSnapshot(planningRoot: string, phaseNum?: number | null): Promise<string> {
  const targets = [
    'PROJECT.md',
    'REQUIREMENTS.md',
    'ROADMAP.md',
    'STATE.md',
  ];

  const parts: string[] = [];

  for (const name of targets) {
    const fullPath = path.join(planningRoot, name);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      parts.push(`### ${name}\n${content}`);
    } catch {
      // 存在しなければスキップ
    }
  }

  if (phaseNum !== null && phaseNum !== undefined) {
    const phaseFiles = await loadPhaseFiles(planningRoot, phaseNum);
    parts.push(...phaseFiles);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 指定フェーズのディレクトリを探し、CONTEXT.md / RESEARCH.md / PLAN.md を読み込む。
 */
async function loadPhaseFiles(planningRoot: string, phaseNum: number): Promise<string[]> {
  const phasesDir = path.join(planningRoot, 'phases');
  const parts: string[] = [];

  let dirEntries: Dirent[] = [];
  try {
    dirEntries = await fs.readdir(phasesDir, { withFileTypes: true });
  } catch {
    return parts;
  }

  const paddedNum = String(phaseNum).padStart(2, '0');
  const phaseEntry = dirEntries.find(
    (e) =>
      e.isDirectory() &&
      (e.name === String(phaseNum) ||
        e.name.startsWith(`${phaseNum}-`) ||
        e.name.startsWith(`${paddedNum}-`) ||
        e.name === paddedNum)
  );

  if (!phaseEntry) return parts;

  const phaseDir = phaseEntry.name;
  const phaseRoot = path.join(phasesDir, phaseDir);
  const phaseTargets = [
    { pattern: `${paddedNum}-CONTEXT.md`, fallback: 'CONTEXT.md' },
    { pattern: `${paddedNum}-RESEARCH.md`, fallback: 'RESEARCH.md' },
    { pattern: 'PLAN.md' },
  ];

  for (const target of phaseTargets) {
    const candidates = [target.pattern, ...(target.fallback ? [target.fallback] : [])] as string[];
    for (const candidate of candidates) {
      const fullPath = path.join(phaseRoot, candidate);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        parts.push(`### phases/${phaseDir}/${candidate}\n${content}`);
        break;
      } catch {
        // try next candidate
      }
    }
  }

  return parts;
}

/**
 * .planning/ 配下のファイルを安全に読む。
 * 存在しない場合は null を返す。
 */
export async function readPlanningFile(
  planningRoot: string,
  relative: string
): Promise<string | null> {
  const abs = resolvePlanningPath(planningRoot, relative);
  try {
    return await fs.readFile(abs, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * .planning/ 配下にファイルを書き込む。
 * 中間ディレクトリは自動生成。
 */
export async function writePlanningFile(
  planningRoot: string,
  relative: string,
  content: string
): Promise<void> {
  const abs = resolvePlanningPath(planningRoot, relative);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

/**
 * .planning/ 配下にファイルが存在するか確認する。
 */
export async function planningFileExists(
  planningRoot: string,
  relative: string
): Promise<boolean> {
  const abs = resolvePlanningPath(planningRoot, relative);
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * .planning/ 配下の指定ディレクトリのファイル一覧を返す。
 */
export async function listPlanningFiles(
  planningRoot: string,
  relativeDir: string = '.'
): Promise<string[]> {
  const abs = resolvePlanningPath(planningRoot, relativeDir);
  try {
    const entries = await fs.readdir(abs, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(planningRoot, path.join(e.path ?? abs, e.name)));
  } catch {
    return [];
  }
}
