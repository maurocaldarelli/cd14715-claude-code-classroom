import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from '../src/agents';
import {
  CODE_QUALITY_ANALYZER_PROMPT,
  TEST_COVERAGE_ANALYZER_PROMPT,
  REFACTORING_SUGGESTER_PROMPT,
  buildOrchestratorPrompt
} from '../src/prompts';

const agents: Record<string, { agent: AgentDefinition; prompt: string }> = {
  'code-quality-analyzer': { agent: codeQualityAnalyzer, prompt: CODE_QUALITY_ANALYZER_PROMPT },
  'test-coverage-analyzer': { agent: testCoverageAnalyzer, prompt: TEST_COVERAGE_ANALYZER_PROMPT },
  'refactoring-suggester': { agent: refactoringSuggester, prompt: REFACTORING_SUGGESTER_PROMPT }
};

const skillsDir = path.resolve(__dirname, '../.claude/skills');

describe.each(Object.entries(agents))('subagent %s', (_name, { agent, prompt }) => {
  it('has a description and its own prompt', () => {
    expect(agent.description.length).toBeGreaterThan(20);
    expect(agent.prompt).toBe(prompt);
  });

  it('pins an explicit model', () => {
    expect(agent.model).toBe('sonnet');
  });

  it('can read code and invoke Skills', () => {
    expect(agent.tools).toEqual(expect.arrayContaining(['Read', 'Skill']));
  });

  it('is told which Skills to invoke by file type', () => {
    expect(agent.prompt).toContain('Skill "typescript-patterns"');
    expect(agent.prompt).toContain('Skill "javascript-best-practices"');
    expect(agent.prompt).toContain('Skill "python-code-review"');
  });

  it('asks for JSON-only output', () => {
    expect(agent.prompt).toContain('Return ONLY a JSON object');
  });
});

describe('subagent roles', () => {
  it('have distinct descriptions and prompts', () => {
    const descriptions = Object.values(agents).map(a => a.agent.description);
    const prompts = Object.values(agents).map(a => a.agent.prompt);
    expect(new Set(descriptions).size).toBe(3);
    expect(new Set(prompts).size).toBe(3);
  });

  it('only the code-quality analyzer uses the ESLint MCP tool', () => {
    expect(codeQualityAnalyzer.tools).toContain('mcp__eslint__lint-files');
    expect(testCoverageAnalyzer.tools).not.toContain('mcp__eslint__lint-files');
    expect(refactoringSuggester.tools).not.toContain('mcp__eslint__lint-files');
  });
});

describe('Skills referenced by prompts', () => {
  const referenced = new Set(
    Object.values(agents).flatMap(({ prompt }) =>
      [...prompt.matchAll(/Skill "([^"]+)"/g)].map(m => m[1]!)
    )
  );

  it('references at least the language skills and security-analysis', () => {
    expect([...referenced]).toEqual(
      expect.arrayContaining([
        'typescript-patterns',
        'javascript-best-practices',
        'python-code-review',
        'security-analysis'
      ])
    );
  });

  it.each([...referenced])('%s exists with a description', skill => {
    const file = path.join(skillsDir, skill, 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toMatch(/^---\r?\ndescription: .+/);
  });
});

describe('GitHub file access instructions', () => {
  it.each(Object.entries(agents))('%s fetches files at the PR head SHA, not main/master', (_n, { prompt }) => {
    expect(prompt).toContain('commit SHA');
    expect(prompt).toContain('never "main"/"master"');
  });

  it('test-coverage-analyzer falls back when search_code needs authentication', () => {
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('mcp__github__search_code');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('authentication error');
  });
});

describe('output size limits', () => {
  it('cap the items each subagent returns, to keep aggregation fast', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('at most 5 issues');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('at most 5 untested paths');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('at most 3 suggestions');
  });
});

describe('orchestrator prompt', () => {
  const prompt = buildOrchestratorPrompt('octocat', 'Hello-World', 7);

  it('names all three subagents and the target PR', () => {
    for (const name of Object.keys(agents)) expect(prompt).toContain(name);
    expect(prompt).toContain('octocat/Hello-World');
    expect(prompt).toContain('#7');
  });

  it('asks for the PR head SHA and passes it to the subagents', () => {
    expect(prompt).toContain('mcp__github__get_pull_request ');
    expect(prompt).toContain('head commit SHA');
  });

  it('lists the allowed enum values for aggregation', () => {
    for (const value of ['critical | high | medium | low | info', 'function | class | branch | edge-case']) {
      expect(prompt).toContain(value);
    }
  });

  it('requires foreground, parallel subagents', () => {
    expect(prompt).toContain('FOREGROUND');
    expect(prompt).toContain('in parallel');
  });
});
