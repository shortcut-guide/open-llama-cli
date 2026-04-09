// src/gsd/orchestrator.ts
import chalk from 'chalk';
import { getConfig } from '../config.js';
import { callLLM } from '../model/llm.js';
import { loadGsdSpec, initializeGsdProject, updateState, savePhaseArtifact } from './spec.js';
import { runAnalyzer } from '../agents/analyzer.js';
import { runPlanner, type MicroPlan } from '../agents/planner.js';
import { runCoderAgent } from '../agents/coder.js';
import { runReviewerAgent, parseReviewResult } from '../agents/reviewer.js';

export async function gsdInitialize(userGoal: string): Promise<void> {
  console.log(chalk.bold.cyan('\n🚀 GSD Initialize Phase'));
  const config = getConfig();

  // Step 1: Researcher (Analyzer)
  console.log(chalk.yellow('🔍 Researching goal...'));
  const analysis = await runAnalyzer({
    code: 'N/A', // Initialize may not have code yet
    filePath: 'PROJECT_ROOT',
    llmUrl: config.LLM_API_URL,
  });

  // Step 2: Create Specs
  const prompt = `
Generate GSD project specs for the following goal: ${userGoal}
Codebase Analysis: ${analysis.analysis}

Output format:
---PROJECT.md---
[Content]
---REQUIREMENTS.md---
[Content]
---ROADMAP.md---
[Content]
`.trim();

  const response = await callLLM([{ role: 'user', content: prompt }], { label: 'GSD Architect' });

  const projectMatch = response.match(/---PROJECT\.md---([\s\S]*?)---/);
  const requirementsMatch = response.match(/---REQUIREMENTS\.md---([\s\S]*?)---/);
  const roadmapMatch = response.match(/---ROADMAP\.md---([\s\S]*?)$/);

  await initializeGsdProject({
    project: projectMatch ? projectMatch[1].trim() : 'Project Vision',
    requirements: requirementsMatch ? requirementsMatch[1].trim() : 'Requirements List',
    roadmap: roadmapMatch ? roadmapMatch[1].trim() : 'Roadmap Phases',
  });

  console.log(chalk.green('✅ GSD Project Initialized in .planning/'));
}

export async function gsdPlanPhase(phaseNumber: string): Promise<void> {
  console.log(chalk.bold.cyan(`\n📋 GSD Planning Phase ${phaseNumber}`));
  const config = getConfig();
  const spec = await loadGsdSpec();

  const prompt = `
Current Phase: ${phaseNumber}
Project: ${spec.project}
Requirements: ${spec.requirements}
Roadmap: ${spec.roadmap}
State: ${spec.state}

Design 2-3 atomic tasks for this phase.
Output each task using the XML format:
<task>
  <name>Task Name</name>
  <files>
    <file>path/to/file</file>
  </files>
  <action>Detailed description of what to do</action>
  <verification>Steps to verify the task</verification>
</task>
`.trim();

  const response = await callLLM([{ role: 'user', content: prompt }], { label: 'GSD Planner' });
  await savePhaseArtifact(phaseNumber, 'PLAN', response);
  console.log(chalk.green(`✅ Phase ${phaseNumber} plan saved.`));
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GsdTask } from '../agents/types.js';

function parseXmlTasks(xml: string): GsdTask[] {
  const tasks: GsdTask[] = [];
  const taskRegex = /<task>([\s\S]*?)<\/task>/g;
  let match;
  while ((match = taskRegex.exec(xml)) !== null) {
    const content = match[1];
    const name = content.match(/<name>(.*?)<\/name>/)?.[1] || 'Unknown Task';
    const action = content.match(/<action>([\s\S]*?)<\/action>/)?.[1] || '';
    const verification = content.match(/<verification>([\s\S]*?)<\/verification>/)?.[1] || '';
    
    const files: string[] = [];
    const fileRegex = /<file>(.*?)<\/file>/g;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(content)) !== null) {
      files.push(fileMatch[1]);
    }
    
    tasks.push({ name, action, verification, files });
  }
  return tasks;
}

import { writeFile as fsWriteFile } from 'node:fs/promises';
import { handleFileEditProposals } from '../controller/fileProposal.js';

export async function gsdDiscussPhase(phaseNumber: string): Promise<void> {
  console.log(chalk.bold.cyan(`\n💬 GSD Discuss Phase ${phaseNumber}`));
  const config = getConfig();
  const spec = await loadGsdSpec();

  const prompt = `
Current Phase: ${phaseNumber}
Project: ${spec.project}
Requirements: ${spec.requirements}
Roadmap: ${spec.roadmap}

Discuss implementation details, UI/UX preferences, and technical constraints for this phase.
Output a summary of decisions as a CONTEXT document.
`.trim();

  const response = await callLLM([{ role: 'user', content: prompt }], { label: 'GSD Researcher' });
  await savePhaseArtifact(phaseNumber, 'CONTEXT', response);
  console.log(chalk.green(`✅ Phase ${phaseNumber} context saved.`));
}

export async function gsdExecutePhase(phaseNumber: string): Promise<void> {
  console.log(chalk.bold.cyan(`\n⚡ GSD Execute Phase ${phaseNumber}`));
  const config = getConfig();
  const dirPath = join(config.WORKSPACE_ROOT, '.planning');
  const planXml = await readFile(join(dirPath, `${phaseNumber}-PLAN.md`), 'utf-8');
  const tasks = parseXmlTasks(planXml);

  for (const task of tasks) {
    console.log(chalk.bold.magenta(`\n🏃 Executing Task: ${task.name}`));
    
    let sourceCode = '';
    for (const file of task.files) {
      try {
        const content = await readFile(join(config.WORKSPACE_ROOT, file), 'utf-8');
        sourceCode += `\n\n--- FILE: ${file} ---\n${content}`;
      } catch (e) {
        sourceCode += `\n\n--- FILE: ${file} (NEW) ---`;
      }
    }

    let codeOutput = '';
    let localApproved = false;
    let currentReviewResult: any;

    for (let i = 0; i < config.MAX_REVIEW_ITERATIONS; i++) {
      const coderResult = await runCoderAgent({
        userTask: task.action,
        gsdTask: task,
        sourceCode,
        code: codeOutput,
        reviewResult: currentReviewResult,
        iterationCount: i,
        taskType: 'gsd',
      });
      
      codeOutput = coderResult.output;

      const reviewerResult = await runReviewerAgent({
        userTask: task.action,
        gsdTask: task,
        sourceCode,
        code: codeOutput,
        iterationCount: i,
        taskType: 'gsd',
      });

      currentReviewResult = parseReviewResult(reviewerResult.output);
      
      if (currentReviewResult.approved) {
        localApproved = true;
        console.log(chalk.green(`  ✅ Task Approved: ${task.name}`));
        break;
      }
      
      console.log(chalk.yellow(`  🔧 Retrying task (Iteration ${i + 1})...`));
    }

    if (localApproved) {
      // Parse out the files and write them
      const fileBlocks = codeOutput.matchAll(/```file:([^\n]+)\n([\s\S]*?)```/g);
      for (const match of fileBlocks) {
        const filePath = match[1].trim();
        const content = match[2];
        await fsWriteFile(join(config.WORKSPACE_ROOT, filePath), content);
        console.log(chalk.green(`  💾 Saved: ${filePath}`));
      }
    } else {
      console.log(chalk.red(`  ❌ Task failed to gain approval: ${task.name}`));
    }
  }
  
  await updateState(`# State\n\n- [x] Phase ${phaseNumber} executed`);
}

export async function gsdVerifyWork(phaseNumber: string): Promise<void> {
  console.log(chalk.bold.cyan(`\n🔍 GSD Verify Phase ${phaseNumber}`));
  const config = getConfig();
  const spec = await loadGsdSpec();
  const dirPath = join(config.WORKSPACE_ROOT, '.planning');
  const planXml = await readFile(join(dirPath, `${phaseNumber}-PLAN.md`), 'utf-8');
  const tasks = parseXmlTasks(planXml);

  for (const task of tasks) {
    console.log(chalk.bold.magenta(`\n🧪 Verifying Task: ${task.name}`));
    console.log(chalk.gray(`Verification Steps: ${task.verification}`));
    
    // In a real implementation, this would run automated tests or check file existence.
    // For now, we simulate a check.
  }
  
  await updateState(`# State\n\n- [x] Phase ${phaseNumber} verified`);
  console.log(chalk.green(`✅ Phase ${phaseNumber} verification complete.`));
}
