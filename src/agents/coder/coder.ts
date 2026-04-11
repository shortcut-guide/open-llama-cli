import chalk from 'chalk';
import { callLLM, type Message } from '../../model/llm/index.js';
import type { AgentContext, AgentResult } from '../types.js';
import { buildRefixPrompt, buildUserPrompt, CODER_SYSTEM_PROMPT } from './prompt.js';

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

  const messages: Message[] = [{
    role: 'user',
    content: buildUserPrompt({
      sourceCode: ctx.sourceCode,
      targetPath,
      instructions,
    }),
  }];

  if (ctx.reviewResult && !ctx.reviewResult.approved) {
    messages.push({ role: 'assistant', content: ctx.code ?? '' });
    messages.push({
      role: 'user',
      content: buildRefixPrompt({
        reviewResult: ctx.reviewResult,
        targetPath,
      }),
    });
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
