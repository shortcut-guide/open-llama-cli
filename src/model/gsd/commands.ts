// src/model/gsd/commands.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import TOML from '@iarna/toml';
import { type GsdCommand } from './types.js';
import { resolveGsdRoot, findTomlPath } from './paths.js';

/**
 * TOML ファイルからコマンド定義を読み込む。
 */
export async function loadGsdCommand(name: string): Promise<GsdCommand> {
  const gsdRoot = resolveGsdRoot();
  const tomlPath = await findTomlPath(name, gsdRoot);
  const raw = await fs.readFile(tomlPath, 'utf-8');

  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`TOML パースエラー (${tomlPath}): ${(e as Error).message}`);
  }

  const description = typeof parsed['description'] === 'string' ? parsed['description'] : '';
  const prompt      = typeof parsed['prompt']      === 'string' ? parsed['prompt']      : '';

  if (!prompt) {
    throw new Error(`"prompt" フィールドが空です: ${tomlPath}`);
  }

  return { name, description, prompt };
}

/**
 * 利用可能な GSD コマンド名の一覧を返す。
 */
export async function listGsdCommands(): Promise<{ name: string; description: string }[]> {
  const results: { name: string; description: string }[] = [];

  const searchDirs = [
    path.join(resolveGsdRoot(), 'commands', 'gsd'),
    path.join(process.cwd(), '.planning', 'commands', 'gsd'),
    path.join(process.cwd(), '.gemini', 'commands', 'gsd'),
  ];

  const seen = new Set<string>();

  for (const dir of searchDirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.toml')) continue;
      const name = entry.replace(/\.toml$/, '');
      if (seen.has(name)) continue;
      seen.add(name);

      try {
        const cmd = await loadGsdCommand(name);
        results.push({ name, description: cmd.description });
      } catch {
        // 読み込み失敗はスキップ
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
