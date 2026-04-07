// src/model/file.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';

let WORKSPACE_ROOT: string = process.cwd();

export function setWorkspaceRoot(root: string): void {
  WORKSPACE_ROOT = root;
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export function resolveSafe(filePath: string): string {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(WORKSPACE_ROOT, filePath);
  const rel = path.relative(WORKSPACE_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`ワークスペース外へのアクセスは禁止されています: ${abs}`);
  }
  return abs;
}

export async function searchFiles(
  pattern: string,
  contentRegex?: string
): Promise<{ filePath: string; matchedLines?: string[] }[]> {
  const files = await glob(pattern, {
    cwd: WORKSPACE_ROOT,
    nodir: true,
    dot: false,
    ignore: ['node_modules/**', '.git/**', '*.json'],
  });
  if (!contentRegex) return files.map((f) => ({ filePath: f }));
  const re = new RegExp(contentRegex, 'gm');
  const results: { filePath: string; matchedLines: string[] }[] = [];
  for (const f of files) {
    try {
      const content = await fs.readFile(path.join(WORKSPACE_ROOT, f), 'utf-8');
      const matchedLines: string[] = [];
      content.split('\n').forEach((line, i) => {
        re.lastIndex = 0;
        if (re.test(line)) matchedLines.push(`  L${i + 1}: ${line.trim()}`);
      });
      if (matchedLines.length > 0) results.push({ filePath: f, matchedLines });
    } catch {}
  }
  return results;
}

export async function readFileContent(filePath: string): Promise<string> {
  return fs.readFile(resolveSafe(filePath), 'utf-8');
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const abs = resolveSafe(filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

export async function replaceLines(
  filePath: string,
  searchText: string,
  replaceText: string
): Promise<number> {
  const content = await readFileContent(filePath);
  const lines = content.split('\n');
  const count = lines.filter((l) => l.includes(searchText)).length;
  const updated = lines.map((l) =>
    l.includes(searchText) ? l.replace(searchText, replaceText) : l
  );
  await writeFile(filePath, updated.join('\n'));
  return count;
}

export async function deleteFile(filePath: string): Promise<void> {
  await fs.rm(resolveSafe(filePath), { recursive: false });
}
