// src/gsd/spec.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { getConfig } from '../config.js';

const PLANNING_DIR = '.planning';

export interface GsdSpec {
  project: string;
  requirements: string;
  roadmap: string;
  state: string;
}

export async function ensurePlanningDir(): Promise<string> {
  const config = getConfig();
  const dirPath = path.join(config.WORKSPACE_ROOT, PLANNING_DIR);
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (e) {
    // ignore
  }
  return dirPath;
}

export async function initializeGsdProject(params: {
  project: string;
  requirements: string;
  roadmap: string;
}): Promise<void> {
  const dirPath = await ensurePlanningDir();

  await fs.writeFile(path.join(dirPath, 'PROJECT.md'), params.project);
  await fs.writeFile(path.join(dirPath, 'REQUIREMENTS.md'), params.requirements);
  await fs.writeFile(path.join(dirPath, 'ROADMAP.md'), params.roadmap);
  await fs.writeFile(path.join(dirPath, 'STATE.md'), '# State\n\n- [ ] Project initialized');
}

export async function loadGsdSpec(): Promise<GsdSpec> {
  const dirPath = await ensurePlanningDir();
  const project = await fs.readFile(path.join(dirPath, 'PROJECT.md'), 'utf-8');
  const requirements = await fs.readFile(path.join(dirPath, 'REQUIREMENTS.md'), 'utf-8');
  const roadmap = await fs.readFile(path.join(dirPath, 'ROADMAP.md'), 'utf-8');
  const state = await fs.readFile(path.join(dirPath, 'STATE.md'), 'utf-8');

  return { project, requirements, roadmap, state };
}

export async function updateState(newState: string): Promise<void> {
  const dirPath = await ensurePlanningDir();
  await fs.writeFile(path.join(dirPath, 'STATE.md'), newState);
}

export async function savePhaseArtifact(phase: string, name: string, content: string): Promise<void> {
  const dirPath = await ensurePlanningDir();
  await fs.writeFile(path.join(dirPath, `${phase}-${name}.md`), content);
}
