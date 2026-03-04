/**
 * TrackerToolWidget - Custom widget for tracker MCP tools.
 *
 * Handles: tracker_list, tracker_get, tracker_create, tracker_update, tracker_link_session
 * Shows compact, readable summaries of tracker operations in the AI transcript.
 */

import React from 'react';
import type { CustomToolWidgetProps } from './index';

// ---------- Helpers ----------

function getResultText(result: unknown): string | null {
  if (!result) return null;
  if (typeof result === 'string') return result;

  if (Array.isArray(result)) {
    for (const block of result) {
      if (block && block.type === 'text' && block.text) return block.text as string;
    }
    return null;
  }

  const r = result as any;
  if (r.content && Array.isArray(r.content)) {
    for (const block of r.content) {
      if (block.type === 'text' && block.text) return block.text as string;
    }
  }
  if (r.result != null) return getResultText(r.result);
  if (r.output != null && typeof r.output === 'string') return r.output;
  return null;
}

const TYPE_COLORS: Record<string, string> = {
  bug: '#f87171',
  task: '#60a5fa',
  plan: '#a78bfa',
  idea: '#fbbf24',
  decision: '#4ade80',
  feature: '#34d399',
};

const getTypeColor = (type: string) => TYPE_COLORS[type] || 'var(--nim-text-muted)';

const TypeBadge: React.FC<{ type: string }> = ({ type }) => (
  <span
    style={{
      fontSize: '10px',
      padding: '0px 6px',
      borderRadius: '10px',
      fontWeight: 600,
      lineHeight: '18px',
      background: `${getTypeColor(type)}22`,
      color: getTypeColor(type),
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }}
  >
    {type}
  </span>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const isDone = status === 'done' || status === 'completed';
  const isInProgress = status === 'in-progress' || status === 'active';
  const color = isDone ? '#4ade80' : isInProgress ? '#60a5fa' : 'var(--nim-text-muted)';
  return (
    <span
      style={{
        fontSize: '10px',
        padding: '0px 6px',
        borderRadius: '10px',
        fontWeight: 500,
        lineHeight: '18px',
        background: `${color}18`,
        color,
        border: `1px solid ${color}30`,
      }}
    >
      {status}
    </span>
  );
};

// ---------- Tool-specific renderers ----------

function getToolLabel(toolName: string): string {
  const base = toolName.replace(/^mcp__[^_]+__/, '');
  switch (base) {
    case 'tracker_list': return 'Tracker List';
    case 'tracker_get': return 'Tracker Get';
    case 'tracker_create': return 'Tracker Create';
    case 'tracker_update': return 'Tracker Update';
    case 'tracker_link_session': return 'Tracker Link';
    default: return 'Tracker';
  }
}

function getBaseName(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, '');
}

// ---------- Main widget ----------

export const TrackerToolWidget: React.FC<CustomToolWidgetProps> = ({ message }) => {
  const tool = message.toolCall;
  if (!tool) return null;

  const resultText = getResultText(tool.result);
  const isError = (tool.result as any)?.isError === true;
  const args = (tool.arguments || {}) as Record<string, any>;
  const baseName = getBaseName(tool.name);
  const label = getToolLabel(tool.name);

  // Pending state (no result yet)
  if (!resultText) {
    return (
      <div
        style={{
          border: '1px solid var(--nim-border)',
          borderRadius: '6px',
          overflow: 'hidden',
          fontSize: '11px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 10px',
            background: 'var(--nim-bg-tertiary)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--nim-text)' }}>{label}</span>
          {args.type && <TypeBadge type={args.type} />}
          {args.title && (
            <span style={{ color: 'var(--nim-text-muted)', fontSize: '10px' }}>
              {args.title}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div
        style={{
          border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: '6px',
          overflow: 'hidden',
          fontSize: '11px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 10px',
            background: 'rgba(248,113,113,0.08)',
            borderBottom: '1px solid rgba(248,113,113,0.15)',
          }}
        >
          <span style={{ fontWeight: 600, color: '#f87171' }}>{label}</span>
        </div>
        <div style={{ padding: '6px 10px', color: '#f87171', fontSize: '10px' }}>
          {resultText}
        </div>
      </div>
    );
  }

  // Render based on tool type
  return (
    <div
      style={{
        border: '1px solid var(--nim-border)',
        borderRadius: '6px',
        overflow: 'hidden',
        fontSize: '11px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 10px',
          background: 'var(--nim-bg-tertiary)',
          borderBottom: '1px solid var(--nim-border)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--nim-text)' }}>{label}</span>
        {baseName === 'tracker_create' && args.type && <TypeBadge type={args.type} />}
        {baseName === 'tracker_create' && args.title && (
          <span style={{ color: 'var(--nim-text-muted)', fontSize: '10px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {args.title}
          </span>
        )}
        {baseName === 'tracker_list' && (
          <span style={{ color: 'var(--nim-text-faint)', fontSize: '10px' }}>
            {args.type ? `type: ${args.type}` : 'all types'}
            {args.status ? `, status: ${args.status}` : ''}
          </span>
        )}
        {baseName === 'tracker_get' && args.id && (
          <span style={{ color: 'var(--nim-text-faint)', fontSize: '10px', fontFamily: 'monospace' }}>
            {args.id}
          </span>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          padding: '6px 10px',
          color: 'var(--nim-text-muted)',
          fontSize: '10px',
          whiteSpace: 'pre-wrap',
          maxHeight: baseName === 'tracker_list' ? '200px' : '300px',
          overflowY: 'auto',
          lineHeight: '1.5',
        }}
      >
        {resultText}
      </div>
    </div>
  );
};

TrackerToolWidget.displayName = 'TrackerToolWidget';
