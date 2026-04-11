import chalk from 'chalk';
import { callLLM, type Message } from '../../model/llm/index.js';
import type { AgentContext, AgentResult } from '../types.js';
import { buildFixerUserPrompt, FIXER_SYSTEM_PROMPT } from './prompt.js';

export async function runFixerAgent(ctx: AgentContext): Promise<AgentResult> {
  console.log(chalk.bold.red('\n╔══════════════════════════════════════╗'));
  console.log(chalk.bold.red('║  🔧 Fixer Agent                     ║'));
  console.log(chalk.bold.red('╚══════════════════════════════════════╝'));

  if (!ctx.reviewResult) {
    throw new Error('Fixer Agent requires reviewResult in context');
  }

  const messages: Message[] = [
    { role: 'system', content: FIXER_SYSTEM_PROMPT },
    { role: 'user', content: buildFixerUserPrompt(ctx) },
  ];

  const output = await callLLM(messages, {
    printStream: true,
    label: '🔧 Fixer',
    llmUrl: ctx.llmUrl,
  });

  return {
    agentName: 'Fixer',
    output,
    messages: [...messages, { role: 'assistant', content: output }],
  };
}
