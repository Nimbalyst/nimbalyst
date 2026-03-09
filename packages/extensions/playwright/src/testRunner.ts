import type {
  TestNode,
  TestRunResult,
  TestStatus,
  PlaywrightListOutput,
  PlaywrightRunOutput,
  PlaywrightSuite,
} from './types';
import type { ExtensionStorage } from '@nimbalyst/extension-sdk';

const STORAGE_KEY_TREE = 'testTree';
const STORAGE_KEY_LAST_RUN = 'lastRun';

/** State shared between panel UI and AI tools */
export interface TestRunnerState {
  tree: TestNode[];
  lastRun: TestRunResult | null;
  isRunning: boolean;
  configPath: string;
  workspacePath: string;
  error: string | null;
}

type StateListener = (state: TestRunnerState) => void;

/**
 * Core test runner state manager.
 *
 * Since extensions run in the renderer and can't spawn subprocesses,
 * the actual test execution happens through AI tools (which have Bash
 * access via the agent). This class manages the state:
 * - Parses Playwright JSON output (called by AI tools after running commands)
 * - Persists results to extension storage
 * - Notifies the UI panel of state changes
 */
export class TestRunner {
  private state: TestRunnerState;
  private listeners = new Set<StateListener>();
  private storage: ExtensionStorage | null = null;

  constructor(workspacePath: string, configPath: string) {
    this.state = {
      tree: [],
      lastRun: null,
      isRunning: false,
      configPath,
      workspacePath,
      error: null,
    };
  }

  /** Connect to extension storage and load persisted state */
  async connectStorage(storage: ExtensionStorage) {
    this.storage = storage;
    const savedTree = storage.get<TestNode[]>(STORAGE_KEY_TREE);
    const savedRun = storage.get<TestRunResult>(STORAGE_KEY_LAST_RUN);
    if (savedTree) {
      this.setState({ tree: savedTree });
    }
    if (savedRun) {
      this.setState({ lastRun: savedRun });
    }
  }

  getState(): TestRunnerState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<TestRunnerState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l(this.state));
  }

  private async persist() {
    if (!this.storage) return;
    await this.storage.set(STORAGE_KEY_TREE, this.state.tree);
    if (this.state.lastRun) {
      await this.storage.set(STORAGE_KEY_LAST_RUN, this.state.lastRun);
    }
  }

  setConfigPath(configPath: string) {
    this.setState({ configPath });
  }

  /**
   * Parse the JSON output from `npx playwright test --list --reporter=json`.
   * Called by AI tools after they run the command via Bash.
   */
  parseDiscoveryOutput(jsonOutput: string): TestNode[] {
    try {
      const parsed = JSON.parse(jsonOutput) as PlaywrightListOutput;
      const tree = this.parseSuites(parsed.suites);
      this.setState({ tree, error: null });
      this.persist();
      return tree;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState({ error: `Failed to parse test list: ${msg}` });
      return [];
    }
  }

  /**
   * Parse the JSON output from `npx playwright test --reporter=json`.
   * Called by AI tools after they run the command via Bash.
   */
  parseRunOutput(jsonOutput: string): TestRunResult | null {
    try {
      const parsed = JSON.parse(jsonOutput) as PlaywrightRunOutput;
      const resultTree = this.parseSuitesWithResults(parsed.suites);

      const result: TestRunResult = {
        timestamp: Date.now(),
        configPath: this.state.configPath,
        totalTests: parsed.stats.expected + parsed.stats.unexpected + parsed.stats.skipped + parsed.stats.flaky,
        passed: parsed.stats.expected,
        failed: parsed.stats.unexpected,
        skipped: parsed.stats.skipped,
        flaky: parsed.stats.flaky,
        durationMs: parsed.stats.duration,
        tree: resultTree,
      };

      this.setState({ tree: resultTree, lastRun: result, isRunning: false, error: null });
      this.persist();
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setState({ isRunning: false, error: `Failed to parse test results: ${msg}` });
      return null;
    }
  }

  /** Mark the runner as currently running (for UI state) */
  setRunning(running: boolean) {
    this.setState({ isRunning: running });
  }

  /** Set an error message */
  setError(error: string | null) {
    this.setState({ error });
  }

  /** Get the command string for discovering tests */
  getDiscoverCommand(): string {
    const parts = ['npx playwright test --list --reporter=json'];
    if (this.state.configPath && this.state.configPath !== 'playwright.config.ts') {
      parts.push(`--config ${this.state.configPath}`);
    }
    return parts.join(' ');
  }

  /** Get the command string for running tests */
  getRunCommand(scope?: string, outputDir?: string): string {
    const parts = ['npx playwright test --reporter=json'];
    if (this.state.configPath && this.state.configPath !== 'playwright.config.ts') {
      parts.push(`--config ${this.state.configPath}`);
    }
    if (outputDir) {
      parts.push(`--output ${outputDir}`);
    }
    if (scope) {
      parts.push(scope);
    }
    return parts.join(' ');
  }

  /** Parse suite hierarchy from Playwright JSON output into TestNode tree */
  private parseSuites(suites: PlaywrightSuite[]): TestNode[] {
    return suites.map((suite) => this.parseSuite(suite, []));
  }

  private parseSuite(suite: PlaywrightSuite, parentPath: string[]): TestNode {
    const path = [...parentPath, suite.title];
    const id = path.join(' > ');

    const children: TestNode[] = [];

    if (suite.suites) {
      for (const child of suite.suites) {
        children.push(this.parseSuite(child, path));
      }
    }

    if (suite.specs) {
      for (const spec of suite.specs) {
        children.push({
          id: [...path, spec.title].join(' > '),
          type: 'test',
          name: spec.title,
          filePath: spec.file,
          line: spec.line,
          column: spec.column,
          children: [],
          status: 'pending',
        });
      }
    }

    const type: TestNode['type'] = suite.file && parentPath.length === 0 ? 'file'
      : parentPath.length === 0 ? 'project'
      : 'describe';

    return {
      id,
      type,
      name: suite.title,
      filePath: suite.file,
      line: suite.line,
      column: suite.column,
      children,
      status: 'pending',
    };
  }

  /** Parse suites with test results */
  private parseSuitesWithResults(suites: PlaywrightSuite[]): TestNode[] {
    return suites.map((suite) => this.parseSuiteWithResults(suite, []));
  }

  private parseSuiteWithResults(suite: PlaywrightSuite, parentPath: string[]): TestNode {
    const path = [...parentPath, suite.title];
    const id = path.join(' > ');

    const children: TestNode[] = [];

    if (suite.suites) {
      for (const child of suite.suites) {
        children.push(this.parseSuiteWithResults(child, path));
      }
    }

    if (suite.specs) {
      for (const spec of suite.specs) {
        const lastResult = spec.tests?.[0]?.results?.[spec.tests[0].results.length - 1];
        const status = this.mapStatus(lastResult?.status);
        const screenshot = lastResult?.attachments?.find(
          (a) => a.contentType.startsWith('image/') && a.path
        );
        const trace = lastResult?.attachments?.find(
          (a) => (a.name === 'trace' || a.contentType === 'application/zip') && a.path?.endsWith('.zip')
        );

        children.push({
          id: [...path, spec.title].join(' > '),
          type: 'test',
          name: spec.title,
          filePath: spec.file,
          line: spec.line,
          column: spec.column,
          children: [],
          status,
          duration: lastResult?.duration,
          error: lastResult?.error ? {
            message: lastResult.error.message,
            stack: lastResult.error.stack,
            screenshotPath: screenshot?.path,
            tracePath: trace?.path,
          } : undefined,
          retries: spec.tests?.[0]?.results ? spec.tests[0].results.length - 1 : 0,
        });
      }
    }

    const statuses = children.map((c) => c.status);
    let computedStatus: TestStatus = 'pending';
    if (statuses.includes('failed')) computedStatus = 'failed';
    else if (statuses.includes('flaky')) computedStatus = 'flaky';
    else if (statuses.includes('running')) computedStatus = 'running';
    else if (statuses.every((s) => s === 'passed')) computedStatus = 'passed';
    else if (statuses.every((s) => s === 'skipped')) computedStatus = 'skipped';
    else if (statuses.some((s) => s === 'passed')) computedStatus = 'passed';

    const type: TestNode['type'] = suite.file && parentPath.length === 0 ? 'file'
      : parentPath.length === 0 ? 'project'
      : 'describe';

    return {
      id,
      type,
      name: suite.title,
      filePath: suite.file,
      line: suite.line,
      column: suite.column,
      children,
      status: computedStatus,
    };
  }

  private mapStatus(status?: string): TestStatus {
    switch (status) {
      case 'passed': case 'expected': return 'passed';
      case 'failed': case 'unexpected': return 'failed';
      case 'skipped': return 'skipped';
      case 'flaky': return 'flaky';
      default: return 'pending';
    }
  }
}

/** Singleton registry for sharing runner between panel and AI tools */
let activeRunner: TestRunner | null = null;

export function getRunner(): TestRunner | null {
  return activeRunner;
}

export function setRunner(runner: TestRunner) {
  activeRunner = runner;
}
