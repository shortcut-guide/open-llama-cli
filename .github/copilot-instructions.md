# Copilot Instructions for open-llama-cli

## Build & Development Commands

- **Build**: `npm run build` (TypeScript compilation to `dist/`)
- **Start**: `npm start` or `node dist/src/index.js` (runs the CLI)
- **Lint/Format**: No linter configured; use TypeScript strict mode (`tsconfig.json` enforces ES2022 + strict type checking)

There are no tests in this project—all code changes should be manually verified by running the CLI and testing relevant commands.

## High-Level Architecture

**open-llama-cli** is a TypeScript CLI chat tool that integrates with local/custom LLM APIs and includes a multi-agent orchestrator. It follows **MVC architecture**:

### Core Layers

1. **Model** (`src/model/`)
   - `llm.ts`: LLM API calls with SSE streaming (fetch-based)
   - `history.ts`: Chat history persistence (`chat_history.json` in CWD)
   - `file.ts`: File system operations with path traversal protection (`resolveSafe()`)

2. **View** (`src/view/`)
   - `display.ts`: CLI rendering with chalk (banners, status, hints)

3. **Controller** (`src/controller/`)
   - `command.ts`: Command router (entry point for all CLI commands)
   - `state.ts`: App state (`AUTO_WRITE`, `pendingContext`)
   - `fileProposal.ts` & `fileProposal/*`: Parse ` ```file:` blocks from LLM output and persist to disk
   - `command/`: Command handlers
     - `agentCommand.ts`: Dispatches to multi-agent orchestrator
     - `fileCommands.ts`: `/search`, `/read`, `/write`, `/replace`, `/delete`
     - `systemCommands.ts`: `/help`, `/clear`, `/exit`, `/autowrite`
     - `gsdCommand.ts`: GSD workflow commands

4. **Orchestrator** (`src/orchestrator.ts`)
   - Multi-agent pipeline: Analyzer → Planner → (Coder → Reviewer) × N files
   - Planner returns `MacroPlan` with `MicroPlan[]` — one plan per output file
   - Each `MicroPlan` has `{ file, responsibility, extractFocus }` (enforces 1-feature-1-file)
   - `isGarbageCode()` validates LLM output has real `` ```file: `` blocks before accepting it
   - Agents are stateless functions; orchestrator controls flow

5. **Agents** (`src/agents/`)
   - Pure functions that wrap LLM calls with specific prompts
   - `analyzer.ts`: Static code analysis (exports, dependencies, functions) → returns `FileAnalysis`
   - `planner.ts`: Architecture design → returns `MacroPlan` (JSON); falls back to single-file plan on parse failure
   - `coder.ts`: Code generation
   - `reviewer.ts`: Code review & approval (returns `{ approved, issues, hints }`)
   - `fixer.ts`: Error fixes
   - `types.ts`: Shared types (`TaskType`, `AgentContext`, `ReviewResult`)

   **Agent → LLM endpoint routing** (defined in `orchestrator.ts`):
   | Agent role | LLM endpoint |
   |---|---|
   | analyzer, planner, coder | `LLM_GEMMA_URL` |
   | reviewer, fixer | `LLM_BONSAI_URL` |
   | default | `LLM_API_URL` |

6. **Config** (`src/config.ts`)
   - Custom `loadEnvFile()` (not the dotenv npm package) reads `~/.lcli.env` then `.env` (cwd)
   - Exports `Config` interface: `LLM_API_URL`, `LLM_BONSAI_URL`, `LLM_GEMMA_URL`, `TEMPERATURE`, `MAX_TOKENS`, `WORKSPACE_ROOT`, `AUTO_WRITE_DEFAULT`, `SYSTEM_PROMPT`, `MAX_REVIEW_ITERATIONS`

### Entry Point
- `src/index.ts`: Main REPL loop, coordinates view/controller/model

## Key Conventions

### Type System
- All types exported from module root (e.g., `src/agents/types.ts` exports `TaskType`, `AgentContext`)
- Shared controller types in `src/controller/command/types.ts`
- Use `export type` and `export interface` for clear public API

### LLM Integration
- All LLM calls go through `callLLM(messages, config)` in `src/model/llm.ts`
- Returns AsyncGenerator<string> (SSE streaming)
- Three endpoints: `LLM_API_URL` (default), `LLM_BONSAI_URL`, `LLM_GEMMA_URL` (configurable via env)
- Temperature and max tokens controlled by config; default 0.7 and 4096

### File Operations
- All file I/O must use `resolveSafe(filePath, workspaceRoot)` to prevent path traversal attacks
- File paths passed to agents should be relative to workspace root
- Use `src/model/file.ts` for all FS operations

### Command Handling
- Commands are routed through `handleCommand()` in `src/controller/command.ts`
- Agent commands (`/agent <task>`) trigger orchestrator pipeline
  - Valid explicit task types: `new`, `refactor`, `fix`, `extend`, `analyze`, `gsd`
  - If type is unrecognized, it falls back to keyword-based auto-detection
  - Multi-line input: after `/agent`, enter content then `/end` to submit
- File commands (`/read`, `/write`, etc.) modify state and trigger `fileProposal.ts` to persist LLM suggestions
- All state changes go through `src/controller/state.ts`

### LLM Output Processing
- `fileProposal.ts` parses `` ```file:<path> `` blocks from LLM responses (exact syntax: backtick-backtick-backtick + `file:` + path, no space)
- `extractFileBlocks()` in `src/controller/fileProposal/extractFileBlocks.ts` is the canonical parser
- `isGarbageCode()` in orchestrator rejects output that has no valid file blocks or content < 50 chars
- Supports code fence markers (` ``` `, `~~~`) and optional language hints
- Applies sanity checks (e.g., prevents overwriting files if `AUTO_WRITE` is off)
- Caches line counts for diff visualization

### Multi-Agent Orchestrator
- Pipeline: `Analyzer(code)` → `Planner(task, analysis)` → `(Coder → Reviewer)` × file count
- Planner outputs `MacroPlan.plans: MicroPlan[]` — each plan targets one file (1-feature-1-file principle)
- Coder-Reviewer loop: Reviewer returns `{ approved: boolean, issues?, hints? }`
- Hints are fed back to Coder for refinement (max 3 iterations by default, configurable via `MAX_REVIEW_ITERATIONS`)
- All agents receive `AgentContext` with task, role, filePath, and codeContext
- Task type is inferred from keywords if not explicitly specified (`refactor`/リファクタ, `fix`/修正, etc.)

### Error Handling
- JSON parse failures in `reviewer.ts` fall back to `approved: false` (consider improving)
- `resolveSafe()` throws on path traversal attempts
- LLM streaming errors are logged; REPL continues

### Global State
- `src/controller/state.ts` uses global variables (process-wide, not thread-safe)
- Not designed for multi-session concurrency
- Call `setAutoWrite()`, `getAutoWrite()`, `setPendingFileContext()`, `getPendingFileContext()`, `clearPendingFileContext()` to mutate state

## Language & Build Details

- **Language**: TypeScript 5.x, ES2022 target, ESM modules
- **Node.js**: Runtime environment
- **CLI Library**: chalk 5.x for color/formatting
- **File Globbing**: glob 10.x for workspace file discovery
- **Config Loading**: dotenv-like pattern (custom, not the npm package)
- **Chat History**: JSON lines format in `chat_history.json`

## GSD Workflow

`/gsd:` commands use a gate-based pipeline in `src/model/agent/gsdAgent.ts`:
**Abort Gate → Pre-flight Gate → LLM + Revision loop → Escalation Gate**

Submodules in `src/model/agent/gsd/`:
- `abortGate.ts`: Prevents running if preconditions unmet
- `preflightGate.ts`: Validates planning files exist
- `revisionGate.ts`: Assesses output quality; triggers retry
- `planningWriter.ts`: Writes `.planning/` artifacts
- `discussPhase.ts`: Interactive multi-turn dialogue phase
- `interactiveLoop.ts`: Shared interactive session loop

## Important Notes

- **No Tests**: Add unit tests to `src/agents/*` if possible (most functions are pure)
- **Config Externalization**: All env vars configurable via `~/.lcli.env` or `.env` — loaded by custom `loadEnvFile()`, NOT the dotenv npm package
- **Multi-Session**: Not supported; state is process-global
- **Path Security**: `resolveSafe()` is always mandatory for user-provided paths
- **GSD Workflow**: Full project management pipeline (see `/gsd:` commands in README); uses `src/controller/gsdState.ts` and `src/model/agent/gsdAgent.ts`
