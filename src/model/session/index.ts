// src/model/session/index.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Message } from '../llm/index.js';

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
}

const LCLI_DIR = path.join(os.homedir(), '.lcli');
const SESSIONS_DIR = path.join(LCLI_DIR, 'sessions');
const CURRENT_SESSION_FILE = path.join(LCLI_DIR, 'current_session');
const LEGACY_HISTORY_FILE = path.join(process.cwd(), 'chat_history.json');

export function getSessionsDir(): string {
  return SESSIONS_DIR;
}

export function getSessionHistoryPath(id: string): string {
  return path.join(SESSIONS_DIR, id, 'history.json');
}

function getSessionMetaPath(id: string): string {
  return path.join(SESSIONS_DIR, id, 'meta.json');
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function getCurrentSessionId(): Promise<string | null> {
  try {
    const id = await fs.readFile(CURRENT_SESSION_FILE, 'utf-8');
    return id.trim() || null;
  } catch {
    return null;
  }
}

export async function setCurrentSessionId(id: string): Promise<void> {
  await fs.mkdir(LCLI_DIR, { recursive: true });
  await fs.writeFile(CURRENT_SESSION_FILE, id, 'utf-8');
}

export async function createSession(name?: string): Promise<SessionMeta> {
  await ensureDirs();
  const id = randomUUID();
  const meta: SessionMeta = {
    id,
    name: name ?? `session-${id.slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const sessionDir = path.join(SESSIONS_DIR, id);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(getSessionMetaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(getSessionMetaPath(id), 'utf-8');
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<Array<SessionMeta & { messageCount: number }>> {
  await ensureDirs();
  let entries: string[];
  try {
    entries = await fs.readdir(SESSIONS_DIR);
  } catch {
    return [];
  }

  const results: Array<SessionMeta & { messageCount: number }> = [];
  for (const entry of entries) {
    const meta = await getSession(entry);
    if (!meta) continue;

    let messageCount = 0;
    try {
      const raw = await fs.readFile(getSessionHistoryPath(entry), 'utf-8');
      const msgs = JSON.parse(raw) as Message[];
      messageCount = msgs.filter(m => m.role !== 'system').length;
    } catch {
      // no history yet
    }

    results.push({ ...meta, messageCount });
  }

  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return results;
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  const meta = await getSession(id);
  if (!meta) return false;
  meta.name = name;
  await fs.writeFile(getSessionMetaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return true;
}

/**
 * Find a session by partial ID prefix or exact name (case-insensitive).
 */
export async function findSession(query: string): Promise<SessionMeta | null> {
  const sessions = await listSessions();
  // exact ID match first
  const byId = sessions.find(s => s.id === query || s.id.startsWith(query));
  if (byId) return byId;
  // name match (case-insensitive)
  const q = query.toLowerCase();
  return sessions.find(s => s.name.toLowerCase() === q) ?? null;
}

/**
 * Initializes the session system on startup.
 * - Creates ~/.lcli/sessions/ if needed
 * - Migrates legacy chat_history.json if present
 * - Creates a new session if none exists
 * Returns the current session meta.
 */
export async function initSession(systemPrompt: string): Promise<SessionMeta> {
  await ensureDirs();

  const currentId = await getCurrentSessionId();

  // Validate that the current session still exists
  if (currentId) {
    const meta = await getSession(currentId);
    if (meta) return meta;
  }

  // Attempt migration from legacy chat_history.json
  try {
    const raw = await fs.readFile(LEGACY_HISTORY_FILE, 'utf-8');
    const messages = JSON.parse(raw) as Message[];
    if (Array.isArray(messages) && messages.length > 0) {
      const meta = await createSession('default');
      await fs.writeFile(
        getSessionHistoryPath(meta.id),
        JSON.stringify(messages, null, 2),
        'utf-8'
      );
      await setCurrentSessionId(meta.id);
      // Rename legacy file to avoid re-migration
      await fs.rename(LEGACY_HISTORY_FILE, `${LEGACY_HISTORY_FILE}.migrated`);
      return meta;
    }
  } catch {
    // No legacy file or parse error — create fresh session
  }

  // Create a brand-new session
  const meta = await createSession();
  await setCurrentSessionId(meta.id);
  return meta;
}

/**
 * Returns the history file path for the currently active session.
 * Assumes initSession() has already been called.
 */
export async function getCurrentHistoryPath(): Promise<string> {
  const id = await getCurrentSessionId();
  if (!id) throw new Error('セッションが初期化されていません。');
  return getSessionHistoryPath(id);
}
