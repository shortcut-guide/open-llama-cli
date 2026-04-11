// src/model/backup/index.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const BACKUP_BASE = path.join(os.homedir(), '.lcli', 'backups');
const STACK_FILE = path.join(os.homedir(), '.lcli', 'rewind-stack.json');

const MAX_STACK_SIZE = 10;
const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface RewindEntry {
  turnId: string;
  timestamp: number;
  files: Array<{ originalPath: string; existed: boolean }>;
}

/**
 * Backs up the current content of each file (by absolute path) before it is overwritten.
 * Files that don't yet exist are marked as `existed: false` so restore can delete them.
 * Returns the turnId used for this backup set.
 */
export async function backupFiles(absolutePaths: string[]): Promise<string> {
  const turnId = Date.now().toString();
  const backupDir = path.join(BACKUP_BASE, turnId);
  await fs.mkdir(backupDir, { recursive: true });

  const entries: RewindEntry['files'] = [];

  for (const filePath of absolutePaths) {
    const safeName = filePath.replace(/[/\\:]/g, '__');
    const backupPath = path.join(backupDir, safeName);
    let existed = true;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      await fs.writeFile(backupPath, content, 'utf-8');
    } catch {
      existed = false;
      // touch a marker so we know the path was tracked even though file was new
      await fs.writeFile(backupPath + '.new', '', 'utf-8');
    }

    entries.push({ originalPath: filePath, existed });
  }

  await pushToStack({ turnId, timestamp: Date.now(), files: entries });
  return turnId;
}

/**
 * Restores files from a RewindEntry and removes the backup directory afterwards.
 */
export async function restoreBackup(entry: RewindEntry): Promise<void> {
  const backupDir = path.join(BACKUP_BASE, entry.turnId);

  for (const { originalPath, existed } of entry.files) {
    if (!existed) {
      // File was newly created by this turn — delete it
      try { await fs.rm(originalPath); } catch { /* already gone */ }
    } else {
      const safeName = originalPath.replace(/[/\\:]/g, '__');
      const backupPath = path.join(backupDir, safeName);
      try {
        const content = await fs.readFile(backupPath, 'utf-8');
        await fs.mkdir(path.dirname(originalPath), { recursive: true });
        await fs.writeFile(originalPath, content, 'utf-8');
      } catch { /* backup file missing — skip */ }
    }
  }

  try { await fs.rm(backupDir, { recursive: true }); } catch { /* already cleaned */ }
}

/**
 * Removes and returns the most recent RewindEntry from the stack.
 * Returns null if the stack is empty.
 */
export async function popFromStack(): Promise<RewindEntry | null> {
  const stack = await loadStack();
  if (stack.length === 0) return null;
  const entry = stack.pop()!;
  await saveStack(stack);
  return entry;
}

/**
 * Returns the number of entries currently in the rewind stack.
 */
export async function getStackSize(): Promise<number> {
  const stack = await loadStack();
  return stack.length;
}

/**
 * Removes backup directories and stack entries older than BACKUP_TTL_MS.
 */
export async function cleanOldBackups(): Promise<void> {
  const stack = await loadStack();
  const now = Date.now();
  const expired = stack.filter((e) => now - e.timestamp >= BACKUP_TTL_MS);
  const valid = stack.filter((e) => now - e.timestamp < BACKUP_TTL_MS);

  for (const e of expired) {
    try { await fs.rm(path.join(BACKUP_BASE, e.turnId), { recursive: true }); } catch { /* ok */ }
  }

  if (expired.length > 0) await saveStack(valid);
}

async function pushToStack(entry: RewindEntry): Promise<void> {
  const stack = await loadStack();
  stack.push(entry);
  while (stack.length > MAX_STACK_SIZE) stack.shift();
  await saveStack(stack);
}

async function loadStack(): Promise<RewindEntry[]> {
  try {
    const data = await fs.readFile(STACK_FILE, 'utf-8');
    return JSON.parse(data) as RewindEntry[];
  } catch {
    return [];
  }
}

async function saveStack(stack: RewindEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(STACK_FILE), { recursive: true });
  await fs.writeFile(STACK_FILE, JSON.stringify(stack, null, 2), 'utf-8');
}
