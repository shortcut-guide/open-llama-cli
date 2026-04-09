# Roadmap: Milestone v1.0 - リファクタリング １機能1ファイル

## Overview
This roadmap outlines the phases for milestone v1.0, focusing on refactoring the monolithic `handleCommand` function into a modular structure with one feature per file.

## Phase 1: Core Command Extraction
### Goal
Extract the core command logic for `/search`, `/read`, `/write`, `/replace`, `/delete`, and `/agent` into dedicated, separate files.
### Requirements
- REFACTOR-01: Extract `/search` command logic to `src/controller/commands/search.ts`.
- REFACTOR-02: Extract `/read` command logic to `src/controller/commands/read.ts`.
- REFACTOR-03: Extract `/write` command logic to `src/controller/commands/write.ts`.
- REFACTOR-04: Extract `/replace` command logic to `src/controller/commands/replace.ts`.
- REFACTOR-05: Extract `/delete` command logic to `src/controller/commands/delete.ts`.
- REFACTOR-06: Extract `/agent` command handling to `src/controller/commands/agent.ts`.
### Success Criteria
- The `/search` command successfully executes its intended logic from `src/controller/commands/search.ts`.
- The `/read` command successfully executes its intended logic from `src/controller/commands/read.ts`.
- The `/write` command successfully executes its intended logic from `src/controller/commands/write.ts`.
- The `/replace` command successfully executes its intended logic from `src/controller/commands/replace.ts`.
- The `/delete` command successfully executes its intended logic from `src/controller/commands/delete.ts`.
- The `/agent` command successfully executes its intended logic from `src/controller/commands/agent.ts`.

## Phase 2: Utility Command Extraction
### Goal
Extract utility command logic for `/autowrite`, `/clear`, `/help`, and `/exit` into their own separate handler functions or files.
### Requirements
- REFACTOR-07: Extract `/autowrite` toggle logic to a separate handler.
- REFACTOR-08: Extract `/clear` history logic to a separate handler.
- REFACTOR-09: Extract `/help` and `/exit` logic to separate handlers.
### Success Criteria
- The `/autowrite` toggle functions independently and correctly.
- The `/clear` history command functions independently and correctly.
- The `/help` command displays help information correctly from its new handler.
- The `/exit` command terminates the application correctly from its new handler.

## Phase 3: Integration and Verification
### Goal
Update the `handleCommand` dispatcher, ensure type safety, implement consistent error handling, and thoroughly verify all refactored commands.
### Requirements
- REFACTOR-10: Update `handleCommand` to act as a clean dispatcher using the new command modules.
- REFACTOR-11: Ensure type safety and consistent error handling across all new modules.
- REFACTOR-12: Verify all commands still function correctly after refactoring.
### Success Criteria
- The `handleCommand` function correctly dispatches all existing commands to their respective new modules/handlers.
- The entire codebase compiles without any TypeScript type errors related to the refactoring.
- All commands (core and utility) execute their functions correctly and as expected, with no observable regressions.
- Error handling logic is uniformly applied and consistent across all newly created command modules.
