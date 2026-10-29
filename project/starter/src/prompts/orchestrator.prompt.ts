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
1. Call the GitHub MCP tool mcp__github__get_pull_request_files to list the files changed by the PR (one call is enough).
2. Skip files that are not worth reviewing: lock files, generated or minified files, images and other binaries, and deleted files. If the PR has more than 10 reviewable files, review the 10 with the largest changes.
3. For EACH reviewed file, launch these three subagents with the Task tool. Launch all subagents for all files in parallel (several Task calls in a single message):
   - code-quality-analyzer
   - test-coverage-analyzer
   - refactoring-suggester
   IMPORTANT: run every subagent in the FOREGROUND. Never set run_in_background, never use TaskOutput, and do not poll output files. Parallelism comes from issuing all Task calls in one message; the tool results then contain each subagent's final JSON.
   In each Task prompt include: owner "${owner}", repo "${repo}", PR number ${prNumber}, the file path, and the patch/diff or a note that the file can be fetched with mcp__github__get_file_contents. Each subagent returns a JSON object.
4. Only after ALL Task calls have returned their results, aggregate them into the final report. Never produce the report while any subagent is still pending, and never describe the analysis as "in progress" or "still running": if a subagent truly failed, say so in its summary instead.

## Aggregation rules
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
