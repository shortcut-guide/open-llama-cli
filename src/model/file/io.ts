// src/model/file/io.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveSafe } from './security.js';

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
