# Enterprise Multi-Agent Code Review Orchestrator

Build a production-ready multi-agent system that automates code review using the Claude Agent SDK.

## Project Overview

This system uses multiple specialized AI agents working together to provide comprehensive code reviews:

- **Main Orchestrator** - Coordinates the review process and aggregates results
- **Code Quality Analyzer** - Identifies code smells, anti-patterns, and best practice violations
- **Test Coverage Analyzer** - Evaluates test completeness and suggests missing test cases
- **Refactoring Suggester** - Recommends architectural improvements and refactoring opportunities

## What's Provided

This starter includes the infrastructure you need:

- **Type Definitions** (`src/types/`) - Zod schemas for validation
- **Logger** (`src/utils/logger.ts`) - Winston structured logging
- **Report Generator** (`src/utils/report-generator.ts`) - Markdown/HTML/JSON report generation
- **Project Config** - `package.json`, `tsconfig.json`, `.env.example`
- **Test Skeletons** (`tests/`) - Test file structure
- **Example Skill** (`.claude/skills/`) - Sample Claude skill

## What You Need to Implement

Your tasks:

1. **Agent Definitions** (`src/agents/`)
   - Code Quality Analyzer
   - Test Coverage Analyzer
   - Refactoring Suggester

2. **Prompts** (`src/prompts/`)
   - Orchestrator prompt
   - Agent-specific prompts

3. **MCP Configuration** (`src/config/mcp.config.ts`)
   - GitHub MCP server
   - ESLint MCP server

4. **Orchestrator** (`src/orchestrator.ts`)
   - Main coordination logic
   - Agent spawning and result aggregation

5. **Main Entry Point** (`src/main.ts`)
   - CLI argument parsing
   - Environment validation
   - Report generation

6. **Error Handler** (Recommended) (`src/utils/error-handler.ts`)
   - Custom `ReviewError` class
   - Retry logic with exponential backoff
   - Timeout wrapper

7. **Rate Limiter** (Optional) (`src/utils/rate-limiter.ts`)
   - Token bucket algorithm with sliding window
   - Request and token tracking
   - Concurrent request management

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API access (provided in Vocareum workspace) or [your own API key](https://console.anthropic.com/)
- [GitHub Personal Access Token](https://github.com/settings/tokens) (recommended - scopes: `repo`, `read:org`)

### Installation

**In Vocareum Workspace (Recommended):**

Your workspace comes pre-configured with Anthropic API credentials.

```bash
# Install dependencies from repository root (uses npm workspaces)
cd /voc/work/cd14715-claude-code-classroom
npm install

# Navigate to project and configure
cd project/starter
cp .env.example .env
```

**Local Setup:**

```bash
# Clone the repository
git clone https://github.com/udacity/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom/project/starter

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

**In Vocareum Workspace:**
```bash
# API credentials are already in your environment - don't add them here

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED)
PROJECT_ROOT=/voc/work/cd14715-claude-code-classroom/project/starter

# GitHub Token (RECOMMENDED for higher rate limits)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

**Local Setup with Your Own API Key:**
```bash
# Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED - update to your path)
PROJECT_ROOT=/absolute/path/to/project/starter

# GitHub Token (RECOMMENDED)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

**Local Setup with a Vocareum key (`voc-...`):**
```bash
# The key only works through the Vocareum proxy: copy both values from the workspace
ANTHROPIC_API_KEY=voc-your-key-here
ANTHROPIC_BASE_URL=https://claude.vocareum.com

ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
PROJECT_ROOT=/absolute/path/to/project/starter
```

> Values in `.env` **override** variables already set in your shell (`src/env.ts`),
> so a system-wide `ANTHROPIC_BASE_URL` can't send your key to the wrong endpoint.

### Running

```bash
# Development mode
npm run dev -- <owner> <repo> <pr-number>

# Production build
npm run build
npm start <owner> <repo> <pr-number>

# Example
npm run dev -- facebook react 12345
```

### Report output

Each review writes three files to `reports/` (created in the directory you run the command from,
git-ignored), named `<owner>-<repo>-pr<number>.<ext>`:

```
reports/octocat-Hello-World-pr1.md     # Markdown, ready to paste as a PR comment
reports/octocat-Hello-World-pr1.html   # HTML summary page
reports/octocat-Hello-World-pr1.json   # full structured report (validated with Zod)
```

Re-reviewing the same PR overwrites the previous files. Logs go to `logs/combined.log` and
`logs/error.log`.

### Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- orchestrator.test.ts

# Watch mode
npm test -- --watch
```

## Implementation Notes

- **One orchestrator session.** `CodeReviewOrchestrator` runs a single Agent SDK `query()`
  that registers the three subagents, fetches the PR files through the GitHub MCP server,
  launches the subagents with the `Task` tool (in the foreground, in parallel) and returns the
  aggregated report as structured output (JSON Schema generated from the Zod schemas).
- **Validation.** The result is validated with Zod. Reports with no files, or whose summaries
  say the analysis is still running, are rejected and retried. `metadata.analyzedAt` and
  `metadata.duration` are set by the orchestrator, not by the model.
- **Reliability.** Each review goes through the rate limiter, a timeout (10 min) and a retry
  with exponential backoff (2 attempts). If the GitHub MCP server fails to start, the review
  fails fast. `npx` can take 20-60 s to start an MCP server, so `MCP_TIMEOUT` defaults to 120 s
  (override it in `.env`).
- **Extended thinking.** The review session runs with a thinking budget of 8000 tokens
  (`THINKING_BUDGET_TOKENS` in `.env` or the `maxThinkingTokens` option; minimum 1024, `0`
  disables it). The SDK only exposes this per session, not per subagent, so it applies to the
  orchestrator and all three subagents, including the test-coverage-analyzer. It adds latency
  and cost.
- **Skills.** `.claude/skills/` contains `javascript-best-practices`, `typescript-patterns`,
  `security-analysis` and `python-code-review`. The root `.gitignore` of the starter ignores
  `.claude/`, so new skills need `git add -f`.
- **Dependency versions.** The SDK is `@anthropic-ai/claude-agent-sdk` 0.3.x with Zod 4
  (`z.toJSONSchema`, draft-07, no `$schema` key). With the originally pinned SDK 0.1.77 every
  tool call failed with `400 tool_use ids must be unique` through the Vocareum endpoint.
- **Tests.** `tests/` mocks the SDK `query` function through the `queryFn` option, so no API
  key, network or MCP server is needed. The real-PR test is `it.skip`.

## Key Technologies

- **Claude Agent SDK** - Multi-agent orchestration framework
- **Model Context Protocol (MCP)** - External data integration
- **Zod 4** - Schema validation and type safety
- **TypeScript** - Type-safe development
- **Vitest** - Testing framework
- **Winston** - Structured logging

## Success Criteria

Your implementation is complete when:

- [x] TypeScript compiles without errors: `npm run build`
- [x] All tests pass: `npm test`
- [x] Can review a real PR: `npm start owner repo pr-number` (verified with `npm run dev -- octocat Hello-World 1`)
- [x] Generates reports in at least one format (MD, HTML, JSON)
- [x] Rate limiting prevents API throttling (Optional)
- [x] Errors are handled gracefully (Recommended)

## Resources

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Zod Documentation](https://zod.dev/)

Good luck!