// src/model/gsd/paths.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * get-shit-done/ ディレクトリの絶対パスを返す。
 * 実行環境: dist/src/model/gsd/ → ../../../.. = projectRoot
 */
export function resolveGsdRoot(): string {
  const projectRoot = path.resolve(__dirname, '../../../..');
  return path.join(projectRoot, 'get-shit-done');
}

/**
 * コマンド定義 TOML のパスを返す。
 * 探索順:
 *   1. get-shit-done/commands/gsd/<name>.toml  (GSD ネイティブ)
 *   2. <cwd>/.planning/commands/gsd/<name>.toml (プロジェクトローカル上書き)
 *   3. .gemini/commands/gsd/<name>.toml  (後方互換: Gemini CLI 共有インストール)
 *
 * NOTE: .gemini/ は Gemini CLI 専用スペース。GSD コマンドは get-shit-done/ に配置すること。
 */
export async function findTomlPath(name: string, gsdRoot: string): Promise<string> {
  const candidates = [
    path.join(gsdRoot, 'commands', 'gsd', `${name}.toml`),
    path.join(process.cwd(), '.planning', 'commands', 'gsd', `${name}.toml`),
    path.join(process.cwd(), '.gemini', 'commands', 'gsd', `${name}.toml`),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    `GSDコマンド "${name}" が見つかりません。\n` +
    `探索パス:\n${candidates.map((c) => `  ${c}`).join('\n')}`
  );
}

/**
 * パストラバーサル防止付き絶対パス解決。
 */
export function resolvePlanningPath(planningRoot: string, relative: string): string {
  const abs = path.resolve(planningRoot, relative);
  const rel = path.relative(planningRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`.planning/ 外へのアクセスは禁止されています: ${abs}`);
  }
  return abs;
}
