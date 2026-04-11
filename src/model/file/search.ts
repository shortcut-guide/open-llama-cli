// src/model/file/search.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { getWorkspaceRoot } from './workspace.js';

export async function searchFiles(
  pattern: string,
  contentRegex?: string
): Promise<{ filePath: string; matchedLines?: string[] }[]> {
  const root = getWorkspaceRoot();
  const files = await glob(pattern, {
    cwd: root,
    nodir: true,
    dot: false,
    ignore: ['node_modules/**', '.git/**', '*.json'],
  });
  if (!contentRegex) return files.map((f) => ({ filePath: f }));
  const re = new RegExp(contentRegex, 'gm');
  const results: { filePath: string; matchedLines: string[] }[] = [];
  for (const f of files) {
    try {
      const content = await fs.readFile(path.join(root, f), 'utf-8');
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
