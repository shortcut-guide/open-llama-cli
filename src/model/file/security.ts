// src/model/file/security.ts
import * as path from 'node:path';
import { getWorkspaceRoot } from './workspace.js';

export function resolveSafe(filePath: string): string {
  const root = getWorkspaceRoot();
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`ワークスペース外へのアクセスは禁止されています: ${abs}`);
  }
  return abs;
}
