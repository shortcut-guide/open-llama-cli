// src/model/agent/gsd/types.ts
import * as readline from 'node:readline/promises';
import { type Message } from '../../llm.js';
import { type GsdContext } from '../../gsd.js';

export type GsdGateResult = 'done' | 'escalated' | 'aborted';

export interface GsdAgentResult {
  output: string;
  gateReached: GsdGateResult;
  planningWrites: string[];
}

export interface GsdAgentOptions {
  context: GsdContext;
  rl: readline.Interface;
  history: Message[];
  args: string;
  maxRevisions?: number;
}
