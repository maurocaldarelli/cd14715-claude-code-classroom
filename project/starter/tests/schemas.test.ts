import { describe, it, expect } from 'vitest';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  CodeQualityResultJSONSchema,
  TestCoverageResultJSONSchema,
  RefactoringSuggestionJSONSchema,
  ReviewReportJSONSchema
} from '../src/types';

const codeQuality = {
  file: 'a.ts',
  issues: [
    { line: 1, severity: 'high', category: 'security', description: 'd', suggestion: 's' }
  ],
  overallScore: 80,
  summary: 'ok'
};

const testCoverage = {
  file: 'a.ts',
  hasTests: true,
  testFiles: ['a.test.ts'],
  untestedPaths: [
    { type: 'branch', location: 'foo', priority: 'medium', reasoning: 'r', suggestedTest: 't' }
  ],
  coverageEstimate: 60,
  summary: 'ok'
};

const refactoring = {
  file: 'a.ts',
  suggestions: [
    { type: 'simplify', location: 'foo', impact: 'low', description: 'd', before: 'a', after: 'b', benefits: 'x' }
  ],
  summary: 'ok'
};

const report = {
  pullRequest: { owner: 'o', repo: 'r', number: 1 },
  fileReviews: [{ file: 'a.ts', codeQuality, testCoverage, refactorings: refactoring }],
  summary: { totalFiles: 1, overallScore: 80, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 1 },
  recommendations: [{ priority: 'low', category: 'style', description: 'd', files: ['a.ts'] }],
  metadata: { analyzedAt: '2026-01-01T00:00:00Z', duration: 5, agentVersions: { 'code-quality-analyzer': '1.0.0' } }
};

describe('CodeQualityResultSchema', () => {
  it('accepts a valid result', () => {
    expect(CodeQualityResultSchema.safeParse(codeQuality).success).toBe(true);
  });

  it('rejects unknown severity and category values', () => {
    const badSeverity = { ...codeQuality, issues: [{ ...codeQuality.issues[0], severity: 'urgent' }] };
    const badCategory = { ...codeQuality, issues: [{ ...codeQuality.issues[0], category: 'misc' }] };
    expect(CodeQualityResultSchema.safeParse(badSeverity).success).toBe(false);
    expect(CodeQualityResultSchema.safeParse(badCategory).success).toBe(false);
  });

  it.each([-1, 101])('rejects overallScore %i outside 0-100', score => {
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, overallScore: score }).success).toBe(false);
  });

  it('rejects a missing summary', () => {
    const { summary: _summary, ...withoutSummary } = codeQuality;
    expect(CodeQualityResultSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts a valid result', () => {
    expect(TestCoverageResultSchema.safeParse(testCoverage).success).toBe(true);
  });

  it('rejects unknown path type and priority', () => {
    const path0 = testCoverage.untestedPaths[0];
    expect(
      TestCoverageResultSchema.safeParse({ ...testCoverage, untestedPaths: [{ ...path0, type: 'module' }] }).success
    ).toBe(false);
    expect(
      TestCoverageResultSchema.safeParse({ ...testCoverage, untestedPaths: [{ ...path0, priority: 'urgent' }] }).success
    ).toBe(false);
  });

  it('rejects coverageEstimate above 100 and a non-boolean hasTests', () => {
    expect(TestCoverageResultSchema.safeParse({ ...testCoverage, coverageEstimate: 150 }).success).toBe(false);
    expect(TestCoverageResultSchema.safeParse({ ...testCoverage, hasTests: 'yes' }).success).toBe(false);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts a valid result', () => {
    expect(RefactoringSuggestionSchema.safeParse(refactoring).success).toBe(true);
  });

  it('rejects unknown type and impact', () => {
    const s0 = refactoring.suggestions[0];
    expect(
      RefactoringSuggestionSchema.safeParse({ ...refactoring, suggestions: [{ ...s0, type: 'rewrite' }] }).success
    ).toBe(false);
    expect(
      RefactoringSuggestionSchema.safeParse({ ...refactoring, suggestions: [{ ...s0, impact: 'huge' }] }).success
    ).toBe(false);
  });

  it('requires before and after snippets', () => {
    const { before: _before, ...incomplete } = refactoring.suggestions[0]!;
    expect(
      RefactoringSuggestionSchema.safeParse({ ...refactoring, suggestions: [incomplete] }).success
    ).toBe(false);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(ReviewReportSchema.safeParse(report).success).toBe(true);
  });

  it('accepts a report with no recommendations or file reviews', () => {
    expect(ReviewReportSchema.safeParse({ ...report, fileReviews: [], recommendations: [] }).success).toBe(true);
  });

  it('rejects a non-numeric PR number and non-string agent versions', () => {
    expect(
      ReviewReportSchema.safeParse({ ...report, pullRequest: { ...report.pullRequest, number: '1' } }).success
    ).toBe(false);
    expect(
      ReviewReportSchema.safeParse({ ...report, metadata: { ...report.metadata, agentVersions: { a: 1 } } }).success
    ).toBe(false);
  });

  it('rejects an invalid nested file review', () => {
    const bad = { ...report, fileReviews: [{ ...report.fileReviews[0], codeQuality: { file: 'a.ts' } }] };
    expect(ReviewReportSchema.safeParse(bad).success).toBe(false);
  });
});

describe('JSON Schemas for structured outputs', () => {
  const schemas = {
    CodeQualityResult: [CodeQualityResultJSONSchema, ['file', 'issues', 'overallScore', 'summary']],
    TestCoverageResult: [TestCoverageResultJSONSchema, ['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary']],
    RefactoringSuggestion: [RefactoringSuggestionJSONSchema, ['file', 'suggestions', 'summary']],
    ReviewReport: [ReviewReportJSONSchema, ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']]
  } as const;

  describe.each(Object.entries(schemas))('%s', (_name, [schema, required]) => {
    it('is an inline object schema the SDK validator accepts', () => {
      expect(schema.type).toBe('object');
      // Zod 4 adds a draft 2020-12 "$schema" URI that the CLI rejects
      expect(schema).not.toHaveProperty('$schema');
      expect(JSON.stringify(schema)).not.toContain('$ref');
    });

    it('lists its required properties', () => {
      expect(schema.required).toEqual(expect.arrayContaining([...required]));
    });
  });
});
