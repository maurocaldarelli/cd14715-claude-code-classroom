import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/index.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Evaluates test completeness for a source file and identifies untested functions, branches and edge cases with prioritised test suggestions. Use for every reviewed file.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  tools: [
    'Read',
    'Grep',
    'Glob',
    'mcp__github__get_file_contents',
    'mcp__github__search_code'
  ],
  model: 'sonnet'
};
