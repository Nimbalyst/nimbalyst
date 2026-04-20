import { describe, it, expect, vi } from 'vitest';
import { resolveImmediateToolDecision, type ToolDecision } from '../immediateToolDecision';

function createDeps(overrides?: Partial<Parameters<typeof resolveImmediateToolDecision>[0]>) {
  return {
    internalMcpTools: ['mcp__nimbalyst-mcp__display_to_user', 'mcp__nimbalyst-mcp__capture_editor_screenshot'],
    teamTools: ['TeamCreate', 'TeamDelete', 'TeamList'],
    trustChecker: vi.fn().mockReturnValue({ trusted: true, mode: 'ask' }),
    resolveTeamContext: vi.fn().mockResolvedValue(undefined),
    handleAskUserQuestion: vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} }),
    handleExitPlanMode: vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} }),
    setCurrentMode: vi.fn(),
    logSecurity: vi.fn(),
    ...overrides,
  };
}

function createParams(overrides?: Partial<Parameters<typeof resolveImmediateToolDecision>[1]>) {
  return {
    toolName: 'Bash',
    input: { command: 'echo hello' },
    options: { signal: new AbortController().signal },
    sessionId: 'test-session',
    pathForTrust: '/test/workspace',
    ...overrides,
  };
}

function assertZodCompliantAllow(result: ToolDecision | null) {
  expect(result).not.toBeNull();
  expect(result!.behavior).toBe('allow');
  expect(result!.updatedInput).toBeDefined();
}

function assertZodCompliantDeny(result: ToolDecision | null) {
  expect(result).not.toBeNull();
  expect(result!.behavior).toBe('deny');
  expect(result!.message).toBeDefined();
  expect(typeof result!.message).toBe('string');
}

describe('resolveImmediateToolDecision', () => {
  describe('Zod schema compliance: allow always includes updatedInput', () => {
    it('internal MCP tool returns updatedInput', async () => {
      const deps = createDeps();
      const params = createParams({ toolName: 'mcp__nimbalyst-mcp__display_to_user', input: { chart: {} } });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
      expect(result!.updatedInput).toEqual({ chart: {} });
    });

    it('team tool returns updatedInput', async () => {
      const deps = createDeps();
      const params = createParams({ toolName: 'TeamCreate', input: { team_name: 'alpha' } });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
    });

    it('TeamDelete with inferred team context returns updatedInput with team_name', async () => {
      const deps = createDeps({ resolveTeamContext: vi.fn().mockResolvedValue('inferred-team') });
      const params = createParams({ toolName: 'TeamDelete', input: {} });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
      expect(result!.updatedInput.team_name).toBe('inferred-team');
    });

    it('TeamDelete with explicit team_name returns updatedInput', async () => {
      const deps = createDeps();
      const params = createParams({ toolName: 'TeamDelete', input: { team_name: 'explicit' } });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
    });

    it('bypass-all mode returns updatedInput', async () => {
      const deps = createDeps({ trustChecker: vi.fn().mockReturnValue({ trusted: true, mode: 'bypass-all' }) });
      const params = createParams({ toolName: 'Bash' });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
    });

    it('allow-all mode with file tool returns updatedInput', async () => {
      const deps = createDeps({ trustChecker: vi.fn().mockReturnValue({ trusted: true, mode: 'allow-all' }) });
      const params = createParams({ toolName: 'Edit', input: { file_path: '/test/file.ts' } });
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantAllow(result);
    });
  });

  describe('Zod schema compliance: deny always includes message', () => {
    it('untrusted workspace returns message', async () => {
      const deps = createDeps({ trustChecker: vi.fn().mockReturnValue({ trusted: false, mode: null }) });
      const params = createParams();
      const result = await resolveImmediateToolDecision(deps, params);
      assertZodCompliantDeny(result);
    });
  });

  describe('delegation to sub-handlers', () => {
    it('AskUserQuestion delegates to handleAskUserQuestion', async () => {
      const mockResult: ToolDecision = { behavior: 'allow', updatedInput: { answers: { q1: 'yes' } } };
      const deps = createDeps({ handleAskUserQuestion: vi.fn().mockResolvedValue(mockResult) });
      const params = createParams({ toolName: 'AskUserQuestion', input: { questions: [{ id: 'q1', text: 'proceed?' }] } });
      const result = await resolveImmediateToolDecision(deps, params);
      expect(deps.handleAskUserQuestion).toHaveBeenCalledWith('test-session', params.input, params.options, undefined);
      expect(result).toEqual(mockResult);
    });

    it('ExitPlanMode delegates to handleExitPlanMode', async () => {
      const mockResult: ToolDecision = { behavior: 'allow', updatedInput: { planFilePath: '/plan.md' } };
      const deps = createDeps({ handleExitPlanMode: vi.fn().mockResolvedValue(mockResult) });
      const params = createParams({ toolName: 'ExitPlanMode', input: { planFilePath: '/plan.md' } });
      const result = await resolveImmediateToolDecision(deps, params);
      expect(deps.handleExitPlanMode).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('EnterPlanMode sets mode and returns null (SDK handles natively)', async () => {
      const deps = createDeps();
      const params = createParams({ toolName: 'EnterPlanMode' });
      const result = await resolveImmediateToolDecision(deps, params);
      expect(result).toBeNull();
      expect(deps.setCurrentMode).toHaveBeenCalledWith('planning');
    });
  });

  describe('fallthrough to permission system', () => {
    it('returns null for unknown tool in ask mode', async () => {
      const deps = createDeps();
      const params = createParams({ toolName: 'Bash' });
      const result = await resolveImmediateToolDecision(deps, params);
      expect(result).toBeNull();
    });

    it('allow-all mode does NOT auto-approve non-file tools', async () => {
      const deps = createDeps({ trustChecker: vi.fn().mockReturnValue({ trusted: true, mode: 'allow-all' }) });
      const params = createParams({ toolName: 'Bash' });
      const result = await resolveImmediateToolDecision(deps, params);
      expect(result).toBeNull();
    });
  });
});
