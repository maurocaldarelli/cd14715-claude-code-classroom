import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/index.js';

export const refactoringSuggester: AgentDefinition = {
  description:
    'Recommends behaviour-preserving refactorings and modernisations for a source file, with before/after examples. Use for every reviewed file.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'mcp__github__get_file_contents'],
  model: 'sonnet'
};
