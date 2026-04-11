// src/controller/state.ts

let AUTO_WRITE: boolean = false;
let pendingFileContext: string | null = null;

export function getAutoWrite(): boolean {
  return AUTO_WRITE;
}

export function setAutoWrite(v: boolean): void {
  AUTO_WRITE = v;
}

export function getPendingFileContext(): string | null {
  return pendingFileContext;
}

export function setPendingFileContext(value: string): void {
  pendingFileContext = value;
}

export function clearPendingFileContext(): void {
  pendingFileContext = null;
}
