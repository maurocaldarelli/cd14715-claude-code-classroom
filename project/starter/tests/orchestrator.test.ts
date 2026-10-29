import { describe, it, expect, vi, afterEach } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import type { QueryFn } from '../src/orchestrator';
import { ReviewReportSchema } from '../src/types';
import { ReviewError, ErrorCodes } from '../src/utils';

/**
 * Tests for CodeReviewOrchestrator
 *
 * The Claude Agent SDK `query` function is replaced by an injected mock,
 * so no API key, network or MCP server is needed.
 */

const validReport = {
  pullRequest: { owner: 'o', repo: 'r', number: 1 },
  fileReviews: [
    {
      file: 'src/a.ts',
      codeQuality: {
        file: 'src/a.ts',
        issues: [
          { line: 3, severity: 'critical', category: 'security', description: 'eval', suggestion: 'remove eval' }
        ],
        overallScore: 70,
        summary: 'ok'
      },
      testCoverage: {
        file: 'src/a.ts',
        hasTests: false,
        testFiles: [],
        untestedPaths: [
          { type: 'function', location: 'foo', priority: 'high', reasoning: 'core', suggestedTest: 'test foo' }
        ],
        coverageEstimate: 10,
        summary: 'no tests'
      },
      refactorings: {
        file: 'src/a.ts',
        suggestions: [
          { type: 'simplify', location: 'foo', impact: 'low', description: 'd', before: 'a', after: 'b', benefits: 'x' }
        ],
        summary: 'one'
      }
    }
  ],
  summary: { totalFiles: 1, overallScore: 70, criticalIssues: 1, highPriorityTests: 1, refactoringOpportunities: 1 },
  recommendations: [{ priority: 'critical', category: 'security', description: 'remove eval', files: ['src/a.ts'] }],
  metadata: { analyzedAt: '2025-01-01T00:00:00Z', duration: 0, agentVersions: { 'code-quality-analyzer': '1.0.0' } }
};

const usage = { input_tokens: 100, output_tokens: 50 };

function mockQuery(messages: unknown[]): QueryFn {
  return vi.fn(async function* () {
    for (const m of messages) yield m;
  }) as unknown as QueryFn;
}

const successResult = (structured: unknown) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  usage,
  structured_output: structured
});

const fastOptions = { maxRetries: 1, retryDelayMs: 1 };

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator({ queryFn: mockQuery([]) });
      expect(orchestrator.getRateLimitConfig()).toEqual({});
      expect(orchestrator.getRateLimiter().getStatus()).toMatchObject({
        activeRequests: 0,
        requestsInWindow: 0,
        availableRequests: 50,
        availableTokens: 100000
      });
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([]),
        rateLimits: { maxRequestsPerMinute: 10, maxTokensPerMinute: 5000, maxConcurrent: 2 }
      });
      expect(orchestrator.getRateLimitConfig()).toEqual({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 5000,
        maxConcurrent: 2
      });
      const status = orchestrator.getRateLimiter().getStatus();
      expect(status.availableRequests).toBe(10);
      expect(status.availableTokens).toBe(5000);
    });
  });

  describe('Extended thinking', () => {
    const originalEnv = process.env.THINKING_BUDGET_TOKENS;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.THINKING_BUDGET_TOKENS;
      else process.env.THINKING_BUDGET_TOKENS = originalEnv;
    });

    const budgetOf = (options: ConstructorParameters<typeof CodeReviewOrchestrator>[0] = {}) =>
      new CodeReviewOrchestrator({ queryFn: mockQuery([]), ...options }).getThinkingBudget();

    it('should enable extended thinking by default', () => {
      delete process.env.THINKING_BUDGET_TOKENS;
      expect(budgetOf()).toBe(8000);
    });

    it('should read the budget from THINKING_BUDGET_TOKENS', () => {
      process.env.THINKING_BUDGET_TOKENS = '5000';
      expect(budgetOf()).toBe(5000);
    });

    it('should prefer the explicit option over the environment', () => {
      process.env.THINKING_BUDGET_TOKENS = '5000';
      expect(budgetOf({ maxThinkingTokens: 12000 })).toBe(12000);
    });

    it('should clamp small budgets to the API minimum', () => {
      expect(budgetOf({ maxThinkingTokens: 100 })).toBe(1024);
    });

    it('should disable thinking with 0 or an invalid value', () => {
      expect(budgetOf({ maxThinkingTokens: 0 })).toBeUndefined();
      process.env.THINKING_BUDGET_TOKENS = 'abc';
      expect(budgetOf()).toBeUndefined();
    });

    it('should pass maxThinkingTokens to the SDK only when enabled', async () => {
      const enabled = mockQuery([successResult(validReport)]);
      await new CodeReviewOrchestrator({ queryFn: enabled, maxThinkingTokens: 6000, ...fastOptions })
        .reviewPullRequest('o', 'r', 1);
      expect((enabled as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0].options.maxThinkingTokens).toBe(6000);

      const disabled = mockQuery([successResult(validReport)]);
      await new CodeReviewOrchestrator({ queryFn: disabled, maxThinkingTokens: 0, ...fastOptions })
        .reviewPullRequest('o', 'r', 1);
      expect((disabled as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0].options).not.toHaveProperty(
        'maxThinkingTokens'
      );
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      const queryFn = mockQuery([successResult(validReport)]);
      const orchestrator = new CodeReviewOrchestrator({ queryFn, ...fastOptions });

      await orchestrator.reviewPullRequest('o', 'r', 1);

      const call = (queryFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.prompt).toContain('mcp__github__get_pull_request_files');
      expect(call.prompt).toContain('o/r');
      expect(call.options.mcpServers.github.args).toContain('@modelcontextprotocol/server-github');
      expect(call.options.allowedTools).toContain('mcp__github__get_pull_request_files');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      const queryFn = mockQuery([successResult(validReport)]);
      const orchestrator = new CodeReviewOrchestrator({ queryFn, ...fastOptions });

      await orchestrator.reviewPullRequest('o', 'r', 1);

      const call = (queryFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(Object.keys(call.options.agents).sort()).toEqual([
        'code-quality-analyzer',
        'refactoring-suggester',
        'test-coverage-analyzer'
      ]);
      expect(call.options.allowedTools).toEqual(expect.arrayContaining(['Agent', 'Task']));
      expect(call.prompt).toContain('in parallel');
    });

    it('should aggregate results into ReviewReport', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([{ type: 'system', subtype: 'init' }, successResult(validReport)]),
        ...fastOptions
      });

      const report = await orchestrator.reviewPullRequest('o', 'r', 1);

      expect(report.summary.totalFiles).toBe(1);
      expect(report.fileReviews[0]!.codeQuality.issues).toHaveLength(1);
      expect(report.pullRequest).toEqual({ owner: 'o', repo: 'r', number: 1 });
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
      // analyzedAt is set by the orchestrator, not taken from the model output
      expect(new Date(report.metadata.analyzedAt).getFullYear()).toBeGreaterThan(2025);
    });

    it('should validate output with Zod schema', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult(validReport)]),
        ...fastOptions
      });
      const report = await orchestrator.reviewPullRequest('o', 'r', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });

    it('should reject output that fails schema validation', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult({ summary: 'nope' })]),
        ...fastOptions
      });

      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
        code: ErrorCodes.RETRY_EXHAUSTED
      });
    });

    it('should fail when the SDK reports an error result', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([
          { type: 'result', subtype: 'error_max_turns', is_error: true, usage, errors: ['too many turns'] }
        ]),
        ...fastOptions
      });

      const promise = orchestrator.reviewPullRequest('o', 'r', 1);
      await expect(promise).rejects.toBeInstanceOf(ReviewError);
      await expect(promise).rejects.toThrow(/too many turns/);
    });

    it('should reject a report produced before the subagents finished', async () => {
      const incomplete = structuredClone(validReport);
      incomplete.fileReviews[0]!.codeQuality.summary =
        'Analysis in progress - agent is still running and has not returned results yet.';
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult(incomplete)]),
        ...fastOptions
      });

      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow(/incomplete/);
    });

    it('should reject a report with no reviewed files', async () => {
      const empty = { ...structuredClone(validReport), fileReviews: [] };
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult(empty)]),
        ...fastOptions
      });

      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow(/no files were reviewed/);
    });

    it('should fail fast when the GitHub MCP server failed to start', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([
          { type: 'system', subtype: 'init', mcp_servers: [{ name: 'github', status: 'failed' }] },
          successResult(validReport)
        ]),
        ...fastOptions
      });

      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow(/GitHub MCP server failed/);
    });

    it('should fail when no structured output is returned', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult(undefined)]),
        ...fastOptions
      });
      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow(/structured output/);
    });

    it('should retry after a transient failure', async () => {
      let calls = 0;
      const queryFn = vi.fn(async function* () {
        calls++;
        if (calls === 1) throw new Error('network down');
        yield successResult(validReport);
      }) as unknown as QueryFn;
      const orchestrator = new CodeReviewOrchestrator({ queryFn, maxRetries: 2, retryDelayMs: 1 });

      const report = await orchestrator.reviewPullRequest('o', 'r', 1);
      expect(report.summary.totalFiles).toBe(1);
      expect(calls).toBe(2);
    });

    it('should time out a stuck review', async () => {
      const queryFn = vi.fn(async function* () {
        await new Promise(() => {});
        yield successResult(validReport);
      }) as unknown as QueryFn;
      const orchestrator = new CodeReviewOrchestrator({
        queryFn,
        timeoutMs: 20,
        maxRetries: 1,
        retryDelayMs: 1
      });

      await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toThrow(/timed out/);
    });

    it('should release the rate limiter slot after a review', async () => {
      const orchestrator = new CodeReviewOrchestrator({
        queryFn: mockQuery([successResult(validReport)]),
        ...fastOptions
      });
      await orchestrator.reviewPullRequest('o', 'r', 1);
      expect(orchestrator.getRateLimiter().getStatus().activeRequests).toBe(0);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      const orchestrator = new CodeReviewOrchestrator();
      const report = await orchestrator.reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });
  });
});
