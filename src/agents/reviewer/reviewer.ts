import { callLLM, type Message } from '../../model/llm/index.js';
import type { AgentContext, AgentResult } from '../types.js';
import { displayReviewResult } from './displayReview.js';
import { parseReviewerResponse } from './parseReview.js';
import { buildReviewerUserPrompt, REVIEWER_SYSTEM_PROMPT } from './prompt.js';

export async function runReviewerAgent(ctx: AgentContext): Promise<AgentResult> {
  const codeToReview = ctx.fixedCode ?? ctx.code ?? '';
  const taskDescription = ctx.gsdTask ? ctx.gsdTask.action : ctx.userTask;

  const messages: Message[] = [
    { role: 'system', content: REVIEWER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildReviewerUserPrompt({
        taskDescription,
        sourceCode: ctx.sourceCode,
        codeToReview,
      }),
    },
  ];

  const raw = await callLLM(messages, {
    printStream: false,
    llmUrl: ctx.llmUrl,
  });

  const reviewResult = parseReviewerResponse(raw);
  displayReviewResult(reviewResult, ctx.iterationCount);

  return {
    agentName: 'Reviewer',
    output: JSON.stringify(reviewResult),
    messages: [...messages, { role: 'assistant', content: raw }],
  };
}
