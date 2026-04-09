# Project: open-llama-cli

## Core Value
A CLI tool that enables seamless interaction with LLMs, focusing on file operations, agentic tasks, and code refactoring.

## Current Milestone: v1.0 リファクタリング １機能1ファイル

**Goal:** Refactor the codebase to follow a "one feature per file" pattern for better maintainability.

**Target features:**
- Split `src/controller/command.ts` into individual command handlers.
- Modularize core logic to ensure each file has a single responsibility.
- Update imports and orchestrator to support the new structure.

## Active Requirements
- [ ] REFACTOR-01: Extract `/search` logic to a separate file.
- [ ] REFACTOR-02: Extract `/read` logic to a separate file.
- [ ] REFACTOR-03: Extract `/write` logic to a separate file.
- [ ] REFACTOR-04: Extract `/replace` logic to a separate file.
- [ ] REFACTOR-05: Extract `/delete` logic to a separate file.
- [ ] REFACTOR-06: Extract `/agent` command handling to a separate file.
- [ ] REFACTOR-07: Ensure all new files follow the project's coding standards and types.

## Key Decisions
- **Decision 1**: Adopt GSD workflow for project planning and execution. (2026-04-09)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-09*
