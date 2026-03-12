import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import type { TestNode } from '../types';
import { TestRunner, setRunner } from '../testRunner';
import { HistoryStore, setHistoryStore } from '../historyStore';
import { TestTreeNode } from './TestTreeNode';
import { ErrorDetail } from './ErrorDetail';
import { SummaryBar } from './SummaryBar';
import { TabBar, type TabId } from './TabBar';
import { TraceViewer } from './TraceViewer';
import { HistoryPanel } from './HistoryPanel';

export function TestExplorerPanel({ host }: PanelHostProps) {
  const runnerRef = useRef<TestRunner | null>(null);
  const historyStoreRef = useRef<HistoryStore | null>(null);
  const [tree, setTree] = useState<TestNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<TestNode | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastRun, setLastRun] = useState<{ passed: number; failed: number; skipped: number; flaky: number; durationMs: number } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('tests');
  const [tracePath, setTracePath] = useState<string | undefined>();
  const [, setFailedCount] = useState(0);

  // Initialize runner and history store
  useEffect(() => {
    const configPath = host.storage.get<string>('configPath') ?? 'playwright.config.ts';
    const runner = new TestRunner(host.workspacePath, configPath);
    runnerRef.current = runner;
    setRunner(runner);

    const historyStore = new HistoryStore();
    historyStoreRef.current = historyStore;
    setHistoryStore(historyStore);

    const unsub = runner.subscribe((state) => {
      setTree(state.tree);
      setIsRunning(state.isRunning);
      setError(state.error);
      if (state.lastRun) {
        setLastRun({
          passed: state.lastRun.passed,
          failed: state.lastRun.failed,
          skipped: state.lastRun.skipped,
          flaky: state.lastRun.flaky,
          durationMs: state.lastRun.durationMs,
        });
        setFailedCount(state.lastRun.failed);

        // Record to history
        historyStore.recordRun(state.lastRun);
      }
    });

    // Load persisted state from storage
    runner.connectStorage(host.storage);
    historyStore.connectStorage(host.storage);

    // Auto-discover tests on mount
    discoverTests(runner);

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.workspacePath]);

  async function discoverTests(runner: TestRunner) {
    setIsDiscovering(true);
    setError(null);
    try {
      const cmd = runner.getDiscoverCommand();
      const result = await host.exec(cmd, { timeout: 30000 });
      // Playwright outputs JSON to stdout regardless of exit code
      const output = result.stdout || result.stderr;
      if (output && output.includes('"suites"')) {
        runner.parseDiscoveryOutput(output);
      } else if (!result.success) {
        runner.setError(result.stderr || 'Test discovery failed');
      }
    } catch (e) {
      runner.setError(e instanceof Error ? e.message : 'Test discovery failed');
    } finally {
      setIsDiscovering(false);
    }
  }

  async function runTests(scope?: string) {
    const runner = runnerRef.current;
    if (!runner || isRunning) return;

    runner.setRunning(true);
    try {
      // Use extension file storage for test artifacts (screenshots, traces)
      const outputDir = await host.files.getBasePath();
      const cmd = runner.getRunCommand(scope, `${outputDir}/test-results`);
      const result = await host.exec(cmd, { timeout: 300000 }); // 5min timeout for test runs
      // Playwright outputs JSON to stdout even on test failures (non-zero exit)
      const output = result.stdout || result.stderr;
      if (output && output.includes('"stats"')) {
        runner.parseRunOutput(output);
      } else {
        runner.setRunning(false);
        runner.setError(result.stderr || 'Test run failed');
      }
    } catch (e) {
      runner.setRunning(false);
      runner.setError(e instanceof Error ? e.message : 'Test run failed');
    }
  }

  // Update AI context when state changes
  useEffect(() => {
    host.ai?.setContext({
      testCount: countTests(tree),
      isRunning,
      lastRun,
      historyRuns: historyStoreRef.current?.getHistory().runs.length ?? 0,
    });
  }, [tree, isRunning, lastRun, host.ai]);

  const handleRun = useCallback((node: TestNode) => {
    const scope = node.filePath || undefined;
    runTests(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  const handleRunAll = useCallback(() => {
    runTests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  const handleRefresh = useCallback(() => {
    const runner = runnerRef.current;
    if (runner) discoverTests(runner);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback((node: TestNode) => {
    setSelectedNode(node);
  }, []);

  const handleOpenFile = useCallback((filePath: string, _line?: number) => {
    const fullPath = filePath.startsWith('/')
      ? filePath
      : `${host.workspacePath}/${filePath}`;
    host.openFile(fullPath);
  }, [host]);

  const handleViewTrace = useCallback((path: string) => {
    setTracePath(path);
    setActiveTab('traces');
  }, []);

  // Filter tree by search query
  const filteredTree = searchQuery ? filterTree(tree, searchQuery.toLowerCase()) : tree;

  const tabs = [
    { id: 'tests' as const, label: 'Tests', icon: 'science' },
    { id: 'traces' as const, label: 'Traces', icon: 'timeline' },
    {
      id: 'history' as const,
      label: 'History',
      icon: 'analytics',
      badge: historyStoreRef.current?.getHistory().runs.length,
    },
  ];

  return (
    <div className="pw-panel">
      {/* Toolbar */}
      <div className="pw-toolbar">
        <div className="pw-toolbar-left">
          <span className="pw-toolbar-title">Playwright</span>
          {activeTab === 'tests' && (
            <>
              {!isRunning ? (
                <button className="pw-icon-btn pw-run-all" onClick={handleRunAll} title="Run all tests">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    play_arrow
                  </span>
                </button>
              ) : (
                <span className="pw-running-indicator">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14, animation: 'spin 1s linear infinite', color: '#60a5fa' }}
                  >
                    progress_activity
                  </span>
                  <span style={{ fontSize: 11, color: '#60a5fa' }}>Running...</span>
                </span>
              )}
              <button
                className="pw-icon-btn"
                onClick={handleRefresh}
                disabled={isDiscovering}
                title="Refresh test list"
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 18,
                    animation: isDiscovering ? 'spin 1s linear infinite' : undefined,
                  }}
                >
                  refresh
                </span>
              </button>
            </>
          )}
        </div>
        {activeTab === 'tests' && (
          <div className="pw-toolbar-right">
            <input
              type="text"
              className="pw-search-input"
              placeholder="Filter tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
        {lastRun && activeTab === 'tests' && (
          <div className="pw-toolbar-summary">
            <SummaryBar {...lastRun} />
          </div>
        )}
      </div>

      {/* Tab bar */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Error banner */}
      {error && activeTab === 'tests' && (
        <div className="pw-error-banner">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'tests' && (
        <div className="pw-content">
          {/* Left: Test tree */}
          <div className="pw-tree-pane">
            {filteredTree.length === 0 && !isDiscovering && !error && (
              <div className="pw-empty-state">
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#666' }}>
                  science
                </span>
                <p>No Playwright tests found</p>
                <p className="pw-hint">
                  Make sure playwright.config.ts exists in your workspace
                </p>
              </div>
            )}
            {isDiscovering && filteredTree.length === 0 && (
              <div className="pw-empty-state">
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 32, color: '#60a5fa', animation: 'spin 1s linear infinite' }}
                >
                  progress_activity
                </span>
                <p>Discovering tests...</p>
              </div>
            )}
            {filteredTree.map((node) => (
              <TestTreeNode
                key={node.id}
                node={node}
                depth={0}
                onRun={handleRun}
                onSelect={handleSelect}
                selectedId={selectedNode?.id ?? null}
                onOpenFile={handleOpenFile}
              />
            ))}
          </div>

          {/* Right: Detail pane */}
          <div className="pw-detail-pane">
            {selectedNode ? (
              <ErrorDetail
                node={selectedNode}
                onOpenFile={handleOpenFile}
                onViewTrace={handleViewTrace}
              />
            ) : (
              <div className="pw-detail-placeholder">
                <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#4a4a4a' }}>
                  science
                </span>
                <p>Select a test to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'traces' && (
        <TraceViewer host={host} tracePath={tracePath} />
      )}

      {activeTab === 'history' && historyStoreRef.current && (
        <HistoryPanel store={historyStoreRef.current} onOpenFile={handleOpenFile} />
      )}
    </div>
  );
}

function countTests(tree: TestNode[]): number {
  let count = 0;
  for (const node of tree) {
    if (node.type === 'test') count++;
    count += countTests(node.children);
  }
  return count;
}

function filterTree(tree: TestNode[], query: string): TestNode[] {
  return tree
    .map((node) => {
      if (node.type === 'test') {
        return node.name.toLowerCase().includes(query) ? node : null;
      }
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    })
    .filter((n): n is TestNode => n !== null);
}
