// src/agents/coder.ts
import chalk from 'chalk';
import fs from 'fs';
import { callLLM, type Message } from '../model/llm.js';
import type { AgentContext, AgentResult, TaskType } from './types.js';

const CODER_SYSTEM_PROMPT = `
You are an expert Software Engineer.
Your mission is to execute the requested task perfectly and concisely.

# CRITICAL RULES
1. ALWAYS output the FULL content of the file. 
2. NEVER use placeholders like "// ..." or "// existing code".
3. If multiple files are involved, use multiple markdown code blocks.
4. Your output for each file MUST start exactly with: \`\`\`file:<target_path>\`\`\`
`.trim();

export async function runCoderAgent(ctx: AgentContext): Promise<AgentResult> {
  let targetPath = 'unknown.ts';
  let instructions = 'Execute the task.';

  if (ctx.gsdTask) {
    targetPath = ctx.gsdTask.files.join(', ');
    instructions = ctx.gsdTask.action;
  } else {
    try {
      const planObj = JSON.parse(ctx.plan || '{}');
      targetPath = planObj.file || targetPath;
      instructions = planObj.extractFocus || instructions;
    } catch { 
      targetPath = ctx.plan || targetPath; 
    }
  }

  console.log(chalk.bold.blue(`\n  💻 Executor Agent -> Task: ${ctx.gsdTask?.name || 'Standard Task'}`));

  function buildUserPrompt(): string {
    return `
# CONTEXT
${ctx.sourceCode ?? 'N/A'}

# TASK INSTRUCTIONS (CRITICAL)
Target Files: ${targetPath}
Instructions: ${instructions}

Your output MUST be markdown code blocks starting with: \`\`\`file:<target_path>\`\`\`
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
    llmUrl: ctx.llmUrl,
  });

  return {
    agentName: 'Coder',
    output,
    messages: [{ role: 'system', content: CODER_SYSTEM_PROMPT }, ...messages, { role: 'assistant', content: output }],
  };
}