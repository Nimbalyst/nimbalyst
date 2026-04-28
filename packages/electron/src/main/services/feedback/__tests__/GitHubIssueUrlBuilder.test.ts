import { describe, it, expect } from 'vitest';
import { buildIssueUrl, FEEDBACK_REPO } from '../GitHubIssueUrlBuilder';

describe('GitHubIssueUrlBuilder', () => {
  it('builds a bug-report URL with the bug template and label', () => {
    const r = buildIssueUrl({ kind: 'bug', title: 'Crash on save', body: 'Steps...' });
    expect(r.ok).toBe(true);
    expect(r.url).toContain(`github.com/${FEEDBACK_REPO}/issues/new`);
    expect(r.url).toContain('template=bug_report.md');
    expect(r.url).toContain('labels=bug');
    expect(r.url).toContain('title=Crash+on+save');
    expect(r.url).toContain('body=Steps...');
  });

  it('builds a feature-request URL with the feature template and label', () => {
    const r = buildIssueUrl({ kind: 'feature', title: 'Add multi-cursor', body: 'Why...' });
    expect(r.ok).toBe(true);
    expect(r.url).toContain('template=feature_request.md');
    expect(r.url).toContain('labels=enhancement');
  });

  it('returns ok=false with a title-only fallback URL when the body is too long', () => {
    const longBody = 'x'.repeat(7000);
    const r = buildIssueUrl({ kind: 'bug', title: 'Big report', body: longBody });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too-long');
    expect(r.url).toContain('title=Big+report');
    expect(r.url).not.toContain('body=');
    expect(r.url.length).toBeLessThan(7000);
  });

  it('keeps URL-safe encoding intact', () => {
    const r = buildIssueUrl({
      kind: 'bug',
      title: 'Issue with paths & ?query',
      body: 'Body has\nnewlines',
    });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/title=Issue\+with\+paths\+%26\+%3Fquery/);
    expect(r.url).toMatch(/body=Body\+has%0Anewlines/);
  });
});
