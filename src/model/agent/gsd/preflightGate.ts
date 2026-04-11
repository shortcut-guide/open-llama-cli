// src/model/agent/gsd/preflightGate.ts
import { getPreflightRequirements, listPlanningFiles, planningFileExists } from '../../gsd.js';

export class GsdPreflightError extends Error {
  constructor(msg: string, public readonly suggestion: string) {
    super(msg); this.name = 'GsdPreflightError';
  }
}

async function phaseFileExists(
  planningRoot: string,
  phaseNum: number,
  suffix: string
): Promise<boolean> {
  const allFiles = await listPlanningFiles(planningRoot, 'phases');
  const paddedNum = String(phaseNum).padStart(2, '0');
  return allFiles.some((f) => {
    const parts = f.replace(/^phases\//, '').split('/');
    if (parts.length < 2) return false;
    const dir = parts[0];
    const file = parts[parts.length - 1];
    const dirNum = dir.match(/^(\d+)/)?.[1];
    return (
      (dirNum === String(phaseNum) || dirNum === paddedNum) &&
      file.endsWith(`-${suffix}`)
    );
  });
}

export async function runPreflightGate(
  commandName: string,
  planningRoot: string,
  args: string
): Promise<void> {
  const requirements = getPreflightRequirements(commandName);

  if (commandName === 'execute-phase') {
    const phaseNum = extractPhaseNumberLocal(args);
    if (phaseNum !== null) {
      const hasPlan = await phaseFileExists(planningRoot, phaseNum, 'PLAN.md');
      if (!hasPlan) {
        throw new GsdPreflightError(
          `Phase ${phaseNum} の PLAN.md が存在しません。`,
          `/gsd:plan-phase ${phaseNum}`
        );
      }
    }
    return;
  }

  if (commandName === 'verify-work') {
    const phaseNum = extractPhaseNumberLocal(args);
    if (phaseNum !== null) {
      const hasSummary = await phaseFileExists(planningRoot, phaseNum, 'SUMMARY.md');
      if (!hasSummary) {
        throw new GsdPreflightError(
          `Phase ${phaseNum} の SUMMARY.md が存在しません。execute-phase を先に実行してください。`,
          `/gsd:execute-phase ${phaseNum}`
        );
      }
    }
    return;
  }

  for (const req of requirements) {
    const exists = await planningFileExists(planningRoot, req.file);
    if (!exists) {
      throw new GsdPreflightError(req.missingMessage, req.suggestion);
    }
  }
}

function extractPhaseNumberLocal(args: string): number | null {
  const m = args.match(/\b(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}
