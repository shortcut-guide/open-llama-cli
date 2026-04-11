// src/model/file/workspace.ts

let WORKSPACE_ROOT: string = process.cwd();

export function setWorkspaceRoot(root: string): void {
  WORKSPACE_ROOT = root;
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}
