/**
 * Build the user prompt for the main orchestrator
 */
export function buildOrchestratorPrompt(
  owner: string,
  repo: string,
  prNumber: number
): string {
  return `You are the orchestrator of a multi-agent code review system.
Review pull request #${prNumber} of ${owner}/${repo}.

## Steps
1. Use the GitHub MCP tools mcp__github__get_pull_request (to learn the head branch name and head commit SHA) and mcp__github__get_pull_request_files (to list the changed files). Both are needed.
2. Skip files that are not worth reviewing: lock files, generated or minified files, images and other binaries, and deleted files. If the PR has more than 10 reviewable files, review the 10 with the largest changes.
3. For EACH reviewed file, launch these three subagents with the Agent tool (called Task in older SDK versions). Launch all subagents for all files in parallel (several Task calls in a single message):
   - code-quality-analyzer
   - test-coverage-analyzer
   - refactoring-suggester
   IMPORTANT: run every subagent in the FOREGROUND. Never set run_in_background, never use TaskOutput, and do not poll output files. Parallelism comes from issuing all Task calls in one message; the tool results then contain each subagent's final JSON.
   In each Task prompt include: owner "${owner}", repo "${repo}", PR number ${prNumber}, the file path, the PR head commit SHA, and the patch/diff. Tell the subagent to fetch the file with mcp__github__get_file_contents using that SHA as the \`branch\` argument: the PR files do NOT exist on the default branch, so never use "main" or "master". Each subagent returns a JSON object.
4. Only after ALL Task calls have returned their results, aggregate them into the final report. Never produce the report while any subagent is still pending, and never describe the analysis as "in progress" or "still running": if a subagent truly failed, say so in its summary instead.

## Aggregation rules
- Copy the subagent results verbatim: do not rewrite, shorten or re-order them. Every enum field must use exactly one of the allowed values below; if a subagent returned something else, replace it with the closest allowed value:
  - issues[].severity: critical | high | medium | low | info
  - issues[].category: security | performance | maintainability | style | bug-risk | best-practice
  - untestedPaths[].type: function | class | branch | edge-case
  - untestedPaths[].priority: critical | high | medium | low
  - suggestions[].type: extract-function | rename | modernize | simplify | pattern-improvement
  - suggestions[].impact: low | medium | high
  - recommendations[].priority: critical | high | medium | low
- fileReviews: one entry per reviewed file with codeQuality, testCoverage and refactorings exactly as returned by the subagents. If a subagent failed, fill its entry with an empty result (no issues / no gaps / no suggestions), score 0 or coverage 0, and explain the failure in its summary.
- summary.totalFiles: number of reviewed files.
- summary.overallScore: mean of the files' codeQuality.overallScore, rounded.
- summary.criticalIssues: count of issues with severity "critical" across all files.
- summary.highPriorityTests: count of untestedPaths with priority "critical" or "high".
- summary.refactoringOpportunities: total number of refactoring suggestions.
- recommendations: up to 10 cross-file recommendations ordered by priority (critical first), each with priority, category, description and the affected files.
- pullRequest: { owner: "${owner}", repo: "${repo}", number: ${prNumber} }.
- metadata.analyzedAt: current ISO timestamp; metadata.duration: 0 (it is overwritten later); metadata.agentVersions: { "code-quality-analyzer": "1.0.0", "test-coverage-analyzer": "1.0.0", "refactoring-suggester": "1.0.0" }.

Return the final report as structured output matching the provided JSON schema.`;
}
