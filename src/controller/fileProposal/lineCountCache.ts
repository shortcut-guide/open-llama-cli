// src/controller/lineCountCache.ts

const originalLineCountCache = new Map<string, number>();

export function getLineCountCache(): Map<string, number> {
  return originalLineCountCache;
}

export function getCachedLineCount(filePath: string): number | undefined {
  return originalLineCountCache.get(filePath);
}

export function setCachedLineCount(filePath: string, count: number): void {
  originalLineCountCache.set(filePath, count);
}
