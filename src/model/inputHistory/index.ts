// src/model/inputHistory/index.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const HISTORY_DIR = path.join(os.homedir(), '.lcli');
const HISTORY_FILE = path.join(HISTORY_DIR, 'input_history');

/** Patterns that likely indicate sensitive data (API keys, tokens, etc.) */
const SENSITIVE_REGEXES = [
  /\bsk-[A-Za-z0-9_\-]{10,}/i,
  /\bBearer\s+[A-Za-z0-9_\-\.]{10,}/i,
  /\b(api[_-]?key|token|secret|password)\s*[=:]\s*\S{8,}/i,
];

function isSensitive(input: string): boolean {
  return SENSITIVE_REGEXES.some((re) => re.test(input));
}

export async function loadInputHistory(maxEntries: number): Promise<string[]> {
  try {
    const content = await fs.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    return lines.slice(-maxEntries);
  } catch {
    return [];
  }
}

export async function appendInputHistory(
  newEntries: string[],
  maxEntries: number
): Promise<void> {
  const filtered = newEntries.filter((e) => e.trim() && !isSensitive(e));
  if (filtered.length === 0) return;

  try {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
    const existing = await loadInputHistory(maxEntries * 2);
    const combined = [...existing, ...filtered].slice(-maxEntries);
    const tmp = HISTORY_FILE + '.tmp';
    await fs.writeFile(tmp, combined.join('\n') + '\n', 'utf-8');
    await fs.rename(tmp, HISTORY_FILE);
  } catch {}
}
