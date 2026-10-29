// Load environment variables first: imports are hoisted, and the MCP config
// reads process.env at module load time.
import './env.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator, formatError } from './utils/index.js';

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev -- <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // Validate command line arguments
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev -- <owner> <repo> <pr-number>');
    console.error('Example: npm run dev -- facebook react 12345');
    process.exit(1);
  }

  const prNumber = Number(prStr);
  if (!/^\d+$/.test(prStr) || !Number.isSafeInteger(prNumber) || prNumber <= 0) {
    console.error(`Error: pr-number must be a positive integer (got "${prStr}")`);
    process.exit(1);
  }

  // Validate authentication (Anthropic API or AWS Bedrock)
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsKeys = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (hasAwsKeys && !hasAnthropicKey) {
    if (!process.env.AWS_REGION) {
      console.error('Error: AWS_REGION must be set when using AWS Bedrock.');
      process.exit(1);
    }
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    console.log('🔐 Using AWS Bedrock authentication');
  } else if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else {
    console.error('Error: no authentication configured. Set one of:');
    console.error('  - ANTHROPIC_API_KEY (Anthropic API)');
    console.error('  - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (AWS Bedrock)');
    process.exit(1);
  }

  // Validate model (required for both methods)
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('Error: ANTHROPIC_MODEL is not set.');
    console.error('  - Anthropic API: claude-sonnet-4-5-20250929');
    console.error('  - AWS Bedrock:   us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    process.exit(1);
  }

  try {
    console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} ...`);

    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // Generate reports in all formats
    const generator = new ReportGenerator();
    const reportsDir = path.resolve('reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const baseName = `${owner}-${repo}-pr${prNumber}`;
    const outputs: Array<[string, string]> = [
      [`${baseName}.md`, generator.generateMarkdownReport(report)],
      [`${baseName}.html`, generator.generateHTMLReport(report)],
      [`${baseName}.json`, generator.generateJSONReport(report)]
    ];

    for (const [fileName, content] of outputs) {
      const filePath = path.join(reportsDir, fileName);
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`📄 Saved ${filePath}`);
    }

    console.log(
      `✅ Done. Score ${report.summary.overallScore}/100, ` +
        `${report.summary.criticalIssues} critical issue(s), ` +
        `${report.summary.totalFiles} file(s) reviewed.`
    );
  } catch (error) {
    console.error(`Error: ${formatError(error)}`);
    process.exit(1);
  }
}

main();
