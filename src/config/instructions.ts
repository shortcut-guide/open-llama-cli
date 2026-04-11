// src/config/instructions.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface LoadedInstruction {
  filePath: string;
  content: string;
}

// Module-level store so /instructions command can read loaded files
let _loadedInstructions: LoadedInstruction[] = [];

/** Returns all instruction files loaded at startup. */
export function getLoadedInstructions(): LoadedInstruction[] {
  return _loadedInstructions;
}

async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Loads custom instruction files in priority order and returns their contents.
 * Files that do not exist are silently skipped.
 *
 * Search order:
 *  1. ~/.lcli/instructions.md  (global)
 *  2. LCLI_INSTRUCTIONS_DIRS   (extra dirs, colon-separated; loads instructions.md from each)
 *  3. ./AGENTS.md
 *  4. ./CLAUDE.md
 *  5. ./.github/copilot-instructions.md
 *
 * Later entries override / supplement earlier ones (all are appended in order).
 */
export async function loadInstructions(workspaceRoot: string): Promise<LoadedInstruction[]> {
  const candidates: string[] = [];

  // 1. Global
  candidates.push(path.join(os.homedir(), '.lcli', 'instructions.md'));

  // 2. LCLI_INSTRUCTIONS_DIRS
  const extraDirs = process.env.LCLI_INSTRUCTIONS_DIRS;
  if (extraDirs) {
    for (const dir of extraDirs.split(':').map(d => d.trim()).filter(Boolean)) {
      candidates.push(path.join(dir, 'instructions.md'));
    }
  }

  // 3-5. Repo-local standard files (resolved relative to workspaceRoot)
  for (const rel of ['AGENTS.md', 'CLAUDE.md', path.join('.github', 'copilot-instructions.md')]) {
    candidates.push(path.join(workspaceRoot, rel));
  }

  const loaded: LoadedInstruction[] = [];
  for (const filePath of candidates) {
    const content = await tryReadFile(filePath);
    if (content !== null && content.trim().length > 0) {
      loaded.push({ filePath, content: content.trim() });
    }
  }

  _loadedInstructions = loaded;
  return loaded;
}

/** Builds a string to append to the system prompt from loaded instructions. */
export function buildInstructionsPrompt(instructions: LoadedInstruction[]): string {
  if (instructions.length === 0) return '';
  const sections = instructions.map(
    ({ filePath, content }) => `### ${path.basename(filePath)}\n${content}`
  );
  return `\n\n---\n【カスタム指示】\n${sections.join('\n\n---\n')}`;
}
