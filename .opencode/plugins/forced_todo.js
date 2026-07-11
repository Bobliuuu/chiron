// Plugin entry point. OpenCode's plugin loader calls EVERY export of a file in
// plugins/ as a plugin factory — so this file must export exactly one thing:
// the factory. All logic (state machine, prompts, pruning) and the pure helpers
// unit tests import live in ../lib/forced_todo_core.js, which the loader never
// scans. Do not add exports here.
import { forcedTodoPlugin } from "../lib/forced_todo_core.js"

export const ForcedTodo = forcedTodoPlugin
