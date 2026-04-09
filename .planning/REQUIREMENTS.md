# Milestone v1.0 Requirements: リファクタリング １機能1ファイル

## Overview
The goal is to deconstruct the monolithic `handleCommand` in `src/controller/command.ts` into a modular structure where each command handler resides in its own file or is a cleanly separated function.

## 1. Core Command Refactoring
- [ ] **REFACTOR-01**: Extract `/search` command logic to `src/controller/commands/search.ts`.
- [ ] **REFACTOR-02**: Extract `/read` command logic to `src/controller/commands/read.ts`.
- [ ] **REFACTOR-03**: Extract `/write` command logic to `src/controller/commands/write.ts`.
- [ ] **REFACTOR-04**: Extract `/replace` command logic to `src/controller/commands/replace.ts`.
- [ ] **REFACTOR-05**: Extract `/delete` command logic to `src/controller/commands/delete.ts`.
- [ ] **REFACTOR-06**: Extract `/agent` command handling to `src/controller/commands/agent.ts`.

## 2. Utility Command Refactoring
- [ ] **REFACTOR-07**: Extract `/autowrite` toggle logic to a separate handler.
- [ ] **REFACTOR-08**: Extract `/clear` history logic to a separate handler.
- [ ] **REFACTOR-09**: Extract `/help` and `/exit` logic to separate handlers.

## 3. Integration & Cleanup
- [ ] **REFACTOR-10**: Update `handleCommand` to act as a clean dispatcher using the new command modules.
- [ ] **REFACTOR-11**: Ensure type safety and consistent error handling across all new modules.
- [ ] **REFACTOR-12**: Verify all commands still function correctly after refactoring.

## Future Requirements
- [ ] REFACTOR-FUTURE-01: Implement dynamic command loading/plugins.
- [ ] REFACTOR-FUTURE-02: Add unit tests for each individual command handler.

## Out of Scope
- Adding new commands or features not present in the current `command.ts`.
- Major architectural changes to the `model` or `view` layers.

## Traceability
*(To be filled by the roadmapper)*
