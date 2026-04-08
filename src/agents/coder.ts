// src/agents/coder.ts
import chalk from 'chalk';
import fs from 'fs';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, TaskType } from './types.js';

const CODER_SYSTEM_PROMPT = `
You are a Ruthless React Refactoring Engineer.
Your mission is to extract ONLY what is requested and DELETE EVERYTHING ELSE.

# CRITICAL RULES
1. NEVER output a full copy of the source code unless specifically asked to.
2. NEVER duplicate type/interface definitions (like \`type Product = {...}\`) if they are meant to be in a \`types.ts\` file. Use \`import\` instead.
3. When extracting a sub-component from a file with \`if/else\` layout branches, DO NOT copy the branches. Extract the core JSX elements and merge them into a simple, single return statement.
4. Your output MUST start exactly with: \`\`\`file:<target_path>\`\`\`
`.trim();

export async function runCoderAgent(ctx: AgentContext): Promise<AgentResult> {
  let targetPath = 'unknown.tsx';
  let extractFocus = 'Extract logic.';
  try {
    const planObj = JSON.parse(ctx.plan || '{}');
    targetPath = planObj.file || targetPath;
    extractFocus = planObj.extractFocus || extractFocus;
  } catch { targetPath = ctx.plan || targetPath; }

  console.log(chalk.bold.blue(`\n  💻 Coder Agent -> Target: ${targetPath.split('/').pop()}`));

  function buildUserPrompt(): string {
    return `
# SOURCE CONTENT
${ctx.sourceCode ?? 'N/A'}

# TASK INSTRUCTIONS (CRITICAL)
Target File: ${targetPath}
Instructions: ${extractFocus}

-> IF EXTRACTING: Be ruthless. Output ONLY the parts mentioned in the instructions. DO NOT define types; import them.
-> IF REBUILDING MAIN WRAPPER: Completely rewrite it to import and use the new sub-components. Replace the old bloated JSX with clean component tags (e.g., \`<ImageDisplay product={product} />\`).

Your output MUST be ONLY a single markdown code block starting with: \`\`\`file:${targetPath}\`\`\`
`.trim();
  }

  const messages: Message[] = [{ role: 'user', content: buildUserPrompt() }];

  if (ctx.reviewResult && !ctx.reviewResult.approved) {
    messages.push({ role: 'assistant', content: ctx.code ?? '' });
    
    let refixContent = `# REFIX REQUIRED\n[Issues]:\n${ctx.reviewResult.issues.join('\n')}`;
    if (ctx.reviewResult.hints && ctx.reviewResult.hints.length > 0) {
      refixContent += `\n\n# REVIEWER HINTS (USE THESE):\n${ctx.reviewResult.hints.join('\n')}`;
    }
    refixContent += `\n\nOutput ONLY the corrected markdown code block starting with \`\`\`file:${targetPath}\`\`\``;
    
    messages.push({ role: 'user', content: refixContent });
  }

  const output = await callLLM(messages, {
    printStream: true,
    label: '💻 Coder',
    systemPrompt: CODER_SYSTEM_PROMPT,
    temperature: 0.1, 
  });

  return {
    agentName: 'Coder',
    output,
    messages: [{ role: 'system', content: CODER_SYSTEM_PROMPT }, ...messages, { role: 'assistant', content: output }],
  };
}