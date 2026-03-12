import React from 'react';

export interface CommitDetail {
  body: string;
  files: Array<{ status: string; path: string; added: number; deleted: number }>;
  summary: { filesChanged: number; insertions: number; deletions: number };
}

interface CommitDetailContentProps {
  detail: CommitDetail | null;
  loading: boolean;
  author: string;
  date: string;
  layout: 'horizontal' | 'vertical';
}

// --- Directory tree (matches FileEditsSidebar's collapsing algorithm) ---

interface DirectoryNode {
  path: string;
  displayPath: string;
  files: Array<CommitDetail['files'][number]>;
  subdirectories: Map<string, DirectoryNode>;
}

function buildDirectoryTree(files: CommitDetail['files']): DirectoryNode {
  const root: DirectoryNode = { path: '', displayPath: '', files: [], subdirectories: new Map() };

  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) { root.files.push(file); continue; }
    let current = root;
    parts.slice(0, -1).forEach((part, index) => {
      const pathSoFar = parts.slice(0, index + 1).join('/');
      if (!current.subdirectories.has(part)) {
        current.subdirectories.set(part, { path: pathSoFar, displayPath: part, files: [], subdirectories: new Map() });
      }
      current = current.subdirectories.get(part)!;
    });
    current.files.push(file);
  }
  return collapseDirectoryTree(root);
}

function collapseDirectoryTree(node: DirectoryNode): DirectoryNode {
  node.subdirectories.forEach((subdir, key) => {
    node.subdirectories.set(key, collapseDirectoryTree(subdir));
  });
  if (node.subdirectories.size === 1 && node.files.length === 0) {
    const [, child] = Array.from(node.subdirectories.entries())[0];
    return { ...child, displayPath: node.displayPath ? `${node.displayPath}/${child.displayPath}` : child.displayPath };
  }
  return node;
}

const STATUS_CLASS: Record<string, string> = {
  M: 'git-hover-status--modified',
  A: 'git-hover-status--added',
  D: 'git-hover-status--deleted',
  R: 'git-hover-status--renamed',
};

function renderDirNode(node: DirectoryNode, depth: number): React.ReactNode {
  const subdirs = Array.from(node.subdirectories.values()).sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  const sortedFiles = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  const childDepth = node.displayPath ? depth + 1 : depth;
  return (
    <>
      {node.displayPath && (
        <div className="git-hover-file-row git-hover-file-row--dir" style={{ paddingLeft: depth * 10 + 6 }}>
          <span className="git-hover-dir-name">{node.displayPath}/</span>
        </div>
      )}
      {subdirs.map(sub => <React.Fragment key={sub.path}>{renderDirNode(sub, childDepth)}</React.Fragment>)}
      {sortedFiles.map(file => {
        const name = file.path.split('/').pop() ?? file.path;
        return (
          <div key={file.path} className="git-hover-file-row" style={{ paddingLeft: childDepth * 10 + 6 }}>
            <span className={`git-hover-status ${STATUS_CLASS[file.status] ?? ''}`}>{file.status}</span>
            <span className="git-hover-file-name">{name}</span>
            <span className="git-hover-file-stats">
              {file.added > 0 && <span className="git-hover-stat-added">+{file.added}</span>}
              {file.deleted > 0 && <span className="git-hover-stat-deleted">-{file.deleted}</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}

export function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function SummaryBar({ detail, author, date }: { detail: CommitDetail; author: string; date: string }) {
  return (
    <div className="git-hover-summary">
      <span className="git-hover-summary-author">{author}</span>
      <span className="git-hover-summary-sep">·</span>
      <span className="git-hover-summary-date" title={formatAbsolute(date)}>{formatRelative(date)}</span>
      <span className="git-hover-summary-date git-hover-summary-date--abs">{formatAbsolute(date)}</span>
      <span className="git-hover-summary-sep">·</span>
      <span className="git-hover-summary-files">
        {detail.summary.filesChanged} file{detail.summary.filesChanged !== 1 ? 's' : ''} changed
      </span>
      {detail.summary.insertions > 0 && <span className="git-hover-stat-added">+{detail.summary.insertions}</span>}
      {detail.summary.deletions > 0 && <span className="git-hover-stat-deleted">-{detail.summary.deletions}</span>}
    </div>
  );
}

export function CommitDetailContent({ detail, loading, author, date, layout }: CommitDetailContentProps) {
  if (loading) return <div className="git-hover-loading">Loading...</div>;
  if (!detail) return null;

  const tree = buildDirectoryTree(detail.files);

  if (layout === 'horizontal') {
    return (
      <>
        <div className="git-hover-body-row">
          <pre className="git-hover-body">{detail.body}</pre>
          <div className="git-hover-files">{renderDirNode(tree, 0)}</div>
        </div>
        <SummaryBar detail={detail} author={author} date={date} />
      </>
    );
  }

  // Vertical layout for selection panel
  return (
    <div className="git-detail-vertical">
      <pre className="git-detail-message">{detail.body}</pre>
      <div className="git-detail-files">{renderDirNode(tree, 0)}</div>
      <SummaryBar detail={detail} author={author} date={date} />
    </div>
  );
}
