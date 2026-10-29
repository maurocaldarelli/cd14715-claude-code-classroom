import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/index.js';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import {
  logger,
  RateLimiter,
  RateLimiterConfig,
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout
} from './utils/index.js';
import {
  logReviewStart,
  logReviewComplete,
  logReviewError
} from './utils/logger.js';

/**
 * Signature of the SDK `query` function (injectable for tests)
 */
export type QueryFn = (params: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Rate limit overrides (defaults: 50 req/min, 100k tokens/min, 5 concurrent) */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Model used by the orchestrator (defaults to ANTHROPIC_MODEL) */
  model?: string;
  /** Directory containing .claude/skills/ (defaults to PROJECT_ROOT or cwd) */
  projectRoot?: string;
  /** Timeout for a whole review, in ms (default: 20 minutes) */
  timeoutMs?: number;
  /** Max attempts for a review before giving up (default: 2) */
  maxRetries?: number;
  /** Base retry delay in ms (default: 1000) */
  retryDelayMs?: number;
  /** Max agent turns for the orchestrator session (default: 100) */
  maxTurns?: number;
  /**
   * Extended thinking budget in tokens (default: THINKING_BUDGET_TOKENS or 8000; 0 disables).
   * The SDK only exposes this per session, so it applies to the orchestrator and its
   * subagents, including the test-coverage-analyzer that benefits most from it.
   */
  maxThinkingTokens?: number;
  /** Override the SDK query function (used by tests) */
  queryFn?: QueryFn;
}

// A 4-file PR took ~9 minutes (the final structured-output aggregation dominates)
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_THINKING_TOKENS = 8000;
/** Smallest thinking budget accepted by the API */
const MIN_THINKING_TOKENS = 1024;
const ESTIMATED_TOKENS_PER_REVIEW = 10000;

const GITHUB_TOOLS = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__search_code'
];
const ESLINT_TOOLS = ['mcp__eslint__lint-files'];

/**
 * Turn a requested thinking budget into the value passed to the SDK:
 * undefined (disabled) for 0, negative or non-numeric values, otherwise
 * at least the API minimum.
 */
function resolveThinkingBudget(requested: number): number | undefined {
  if (!Number.isFinite(requested) || requested <= 0) return undefined;
  return Math.max(MIN_THINKING_TOKENS, Math.floor(requested));
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly rateLimiter: RateLimiter;
  private readonly queryFn: QueryFn;
  private readonly model: string | undefined;
  private readonly projectRoot: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxTurns: number;
  private readonly maxThinkingTokens: number | undefined;
  private readonly rateLimits: Partial<RateLimiterConfig>;

  constructor(options: OrchestratorOptions = {}) {
    this.rateLimits = options.rateLimits ?? {};
    this.rateLimiter = new RateLimiter(this.rateLimits);
    this.queryFn = options.queryFn ?? (query as unknown as QueryFn);
    this.model = options.model ?? process.env.ANTHROPIC_MODEL;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.maxTurns = options.maxTurns ?? 100;
    this.maxThinkingTokens = resolveThinkingBudget(
      options.maxThinkingTokens ?? Number(process.env.THINKING_BUDGET_TOKENS ?? DEFAULT_THINKING_TOKENS)
    );
  }

  /** Extended thinking budget in tokens, or undefined when disabled */
  getThinkingBudget(): number | undefined {
    return this.maxThinkingTokens;
  }

  /** Rate limiter used by this orchestrator */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /** Rate limit overrides this orchestrator was created with */
  getRateLimitConfig(): Partial<RateLimiterConfig> {
    return { ...this.rateLimits };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const rawReport = await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs}ms`
          ),
        this.maxRetries,
        this.retryDelayMs
      );

      const duration = Date.now() - startedAt;
      const report = this.validateReport({
        ...rawReport,
        pullRequest: { owner, repo, number: prNumber },
        metadata: { ...rawReport.metadata, analyzedAt: new Date().toISOString(), duration }
      });

      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, duration);
      return report;
    } catch (error) {
      logReviewError(
        owner,
        repo,
        prNumber,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Run a single orchestrator session, rate limited, and return the structured report
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    await this.rateLimiter.acquire(ESTIMATED_TOKENS_PER_REVIEW);
    let tokensUsed: number | undefined;

    try {
      const stream = this.queryFn({
        prompt: buildOrchestratorPrompt(owner, repo, prNumber),
        options: this.buildOptions()
      });

      for await (const message of stream) {
        this.logMessage(message);

        // Without the GitHub MCP server the review cannot work: fail (and retry)
        // instead of producing an empty report
        if (message.type === 'system' && message.subtype === 'init') {
          const github = message.mcp_servers?.find(s => s.name === 'github');
          if (github?.status === 'failed') {
            throw new ReviewError(
              'GitHub MCP server failed to start (is npx able to download @modelcontextprotocol/server-github?)',
              ErrorCodes.GITHUB_API_ERROR,
              { server: 'github', status: github.status }
            );
          }
        }

        // Fail fast on API-level errors: the SDK would otherwise keep re-prompting
        // until maxTurns is reached
        if (message.type === 'assistant' && message.error) {
          const text = (message.message?.content ?? [])
            .map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text : ''))
            .join(' ')
            .trim();
          throw new ReviewError(
            `Claude API error (${message.error})${text ? `: ${text}` : ''}`,
            message.error === 'authentication_failed'
              ? ErrorCodes.MISSING_API_KEY
              : ErrorCodes.AGENT_FAILED,
            { apiError: message.error }
          );
        }

        if (message.type !== 'result') continue;

        const usage = message.usage;
        tokensUsed = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

        if (message.subtype !== 'success') {
          throw new ReviewError(
            `Orchestrator failed (${message.subtype}): ${message.errors?.join('; ') ?? 'unknown error'}`,
            ErrorCodes.AGENT_FAILED,
            { subtype: message.subtype }
          );
        }

        if (message.structured_output === undefined) {
          throw new ReviewError(
            'Orchestrator finished without structured output',
            ErrorCodes.STRUCTURED_OUTPUT_FAILED
          );
        }

        const report = this.validateReport(message.structured_output);
        this.assertComplete(report);
        return report;
      }

      throw new ReviewError(
        'Orchestrator stream ended without a result message',
        ErrorCodes.AGENT_FAILED
      );
    } finally {
      this.rateLimiter.release(tokensUsed);
    }
  }

  /**
   * SDK options for the orchestrator session
   */
  private buildOptions(): Options {
    return {
      model: this.model,
      cwd: this.projectRoot,
      // `npx -y` can take 20-60s to start an MCP server; the default connect timeout is 30s
      env: { ...process.env, MCP_TIMEOUT: process.env.MCP_TIMEOUT ?? '120000' },
      // Load .claude/skills/ from the project so subagents can invoke Skills
      settingSources: ['project'],
      maxTurns: this.maxTurns,
      ...(this.maxThinkingTokens ? { maxThinkingTokens: this.maxThinkingTokens } : {}),
      systemPrompt:
        'You are the orchestrator of a multi-agent code review. Delegate per-file analysis to subagents using the Task tool and aggregate their results.',
      agents: {
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester
      },
      mcpServers: mcpServersConfig,
      // "Agent" is the subagent tool's name since SDK 0.3 ("Task" in older versions)
      allowedTools: ['Agent', 'Task', 'Skill', 'Read', 'Grep', 'Glob', ...GITHUB_TOOLS, ...ESLINT_TOOLS],
      permissionMode: 'dontAsk',
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema
      }
    };
  }

  /**
   * Validate unknown data against the ReviewReport schema
   */
  private validateReport(data: unknown): ReviewReport {
    const parsed = ReviewReportSchema.safeParse(data);
    if (!parsed.success) {
      throw new ReviewError(
        `Report validation failed: ${parsed.error.issues
          .slice(0, 5)
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        ErrorCodes.VALIDATION_FAILED,
        { issues: parsed.error.issues }
      );
    }
    return parsed.data;
  }

  /**
   * Reject reports produced before the subagents finished (e.g. started in
   * background): their summaries say the analysis is still running.
   */
  private assertComplete(report: ReviewReport): void {
    if (report.fileReviews.length === 0) {
      throw new ReviewError(
        'Report is incomplete: no files were reviewed (PR files could not be fetched)',
        ErrorCodes.AGENT_FAILED
      );
    }

    const pending = /still running|in progress|not (yet )?returned/i;
    const incomplete = report.fileReviews.filter(
      r =>
        pending.test(r.codeQuality.summary) ||
        pending.test(r.testCoverage.summary) ||
        pending.test(r.refactorings.summary)
    );

    if (incomplete.length > 0) {
      throw new ReviewError(
        `Report is incomplete: subagents had not finished for ${incomplete.map(r => r.file).join(', ')}`,
        ErrorCodes.AGENT_FAILED,
        { files: incomplete.map(r => r.file) }
      );
    }
  }

  /**
   * Log tool calls, tool errors and permission denials at debug level
   */
  private logMessage(message: SDKMessage): void {
    if (message.type === 'result') {
      if (message.permission_denials?.length) {
        logger.warn('Tool permission denied', {
          tools: message.permission_denials.map(d => d.tool_name)
        });
      }
      return;
    }

    if (message.type !== 'assistant' && message.type !== 'user') return;
    const content = message.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_use') {
        const input = block.input as { subagent_type?: string; description?: string };
        logger.debug('Tool call', {
          tool: block.name,
          agent: input?.subagent_type,
          description: input?.description
        });
      } else if (block.type === 'tool_result' && block.is_error) {
        logger.debug('Tool error', { content: JSON.stringify(block.content).slice(0, 300) });
      }
    }
  }
}
