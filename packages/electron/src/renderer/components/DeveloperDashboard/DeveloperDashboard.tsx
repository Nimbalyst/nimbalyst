import React, { useState, useEffect, useCallback } from 'react';

type TabId = 'atomfamily';

interface AtomFamilyStat {
  name: string;
  count: number;
  file: string;
  params: string[];
}

/**
 * Fetch atomFamily stats from the main app window via IPC.
 * The dashboard runs in a separate BrowserWindow, so it can't access
 * the registry directly -- the main process relays the request.
 */
async function fetchAtomFamilyStats(): Promise<AtomFamilyStat[]> {
  try {
    return await window.electronAPI.invoke('dev:get-atomfamily-stats');
  } catch {
    return [];
  }
}

function AtomFamilyPanel() {
  const [stats, setStats] = useState<AtomFamilyStat[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [filterEmpty, setFilterEmpty] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await fetchAtomFamilyStats());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const displayed = filterEmpty ? stats.filter(s => s.count > 0) : stats;
  const totalInstances = stats.reduce((sum, s) => sum + s.count, 0);
  const nonEmptyCount = stats.filter(s => s.count > 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--nim-border)] text-sm">
        <span className="text-[var(--nim-text-muted)]">
          {stats.length} families registered
        </span>
        <span className="text-[var(--nim-text-muted)]">|</span>
        <span className="text-[var(--nim-text)]">
          <strong>{totalInstances}</strong> live instances across <strong>{nonEmptyCount}</strong> families
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 cursor-pointer text-[var(--nim-text-muted)]">
          <input
            type="checkbox"
            checked={filterEmpty}
            onChange={e => setFilterEmpty(e.target.checked)}
            className="accent-[var(--nim-accent)]"
          />
          Hide empty
        </label>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-3 py-1 rounded text-xs bg-[var(--nim-surface-hover)] text-[var(--nim-text)] hover:bg-[var(--nim-surface-active)] transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-[var(--nim-surface)] z-10">
            <tr className="text-left text-[var(--nim-text-muted)] border-b border-[var(--nim-border)]">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium w-20">File</th>
              <th className="px-4 py-2 font-medium w-24 text-right">Instances</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map(s => {
              const key = `${s.name}-${s.file}`;
              const isExpanded = expandedRow === key;
              return (
                <React.Fragment key={key}>
                  <tr
                    className="border-b border-[var(--nim-border)] hover:bg-[var(--nim-surface-hover)] cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(isExpanded ? null : key)}
                  >
                    <td className="px-4 py-2 font-mono text-[var(--nim-text)]">
                      <span className="mr-1.5 text-[var(--nim-text-muted)] text-xs">
                        {isExpanded ? '\u25BC' : '\u25B6'}
                      </span>
                      {s.name}
                    </td>
                    <td className="px-4 py-2 text-[var(--nim-text-muted)]">{s.file}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      <CountBadge count={s.count} />
                    </td>
                  </tr>
                  {isExpanded && s.params.length > 0 && (
                    <tr className="bg-[var(--nim-surface)]">
                      <td colSpan={3} className="px-8 py-2">
                        <div className="text-xs text-[var(--nim-text-muted)] mb-1">
                          Live params ({s.params.length}):
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto">
                          {s.params.map((p, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded text-xs font-mono bg-[var(--nim-surface-hover)] text-[var(--nim-text)]"
                              title={p}
                            >
                              {p.length > 40 ? p.slice(0, 37) + '...' : p}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[var(--nim-text-muted)]">
                  {filterEmpty ? 'No families with live instances' : 'No families registered'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  const color = count === 0
    ? 'text-[var(--nim-text-muted)]'
    : count > 50
      ? 'text-[var(--nim-error)] font-bold'
      : 'text-[var(--nim-text)]';
  return <span className={color}>{count}</span>;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'atomfamily', label: 'AtomFamily Stats' },
];

export function DeveloperDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('atomfamily');

  return (
    <div className="flex flex-col h-screen bg-[var(--nim-surface)] text-[var(--nim-text)] select-text">
      {/* Title bar drag region (macOS) */}
      <div className="h-8 flex-shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 border-b border-[var(--nim-border)]">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-[var(--nim-accent)] text-[var(--nim-text)]'
                : 'border-transparent text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'atomfamily' && <AtomFamilyPanel />}
      </div>
    </div>
  );
}
