import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionIndexEntry } from '../contexts/CollabV3SyncContext';

interface SessionCardProps {
  session: SessionIndexEntry;
  compact?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function SessionCard({ session, compact, isSelected, onClick }: SessionCardProps) {
  const navigate = useNavigate();
  const formattedTime = formatRelativeTime(session.lastMessageAt);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/session/${session.id}`);
    }
  };

  // Compact mode for iPad sidebar
  if (compact) {
    return (
      <div
        className={`p-3 rounded-lg ${isSelected ? '' : 'hover:bg-[var(--surface-tertiary)]'} transition-colors cursor-pointer`}
        onClick={handleClick}
      >
        <div className="flex items-center gap-2 mb-1">
          <ProviderIcon provider={session.provider} size="small" />
          <span className={`font-medium text-sm line-clamp-1 ${isSelected ? 'text-[var(--primary-color)]' : 'text-[var(--text-primary)]'}`}>
            {session.title || 'Untitled Session'}
          </span>
          {session.pendingExecution && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-[var(--warning-color)] text-white flex-shrink-0">
              Pending
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] pl-6">
          <span>{formattedTime}</span>
          <span>{session.messageCount || 0} msgs</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-4 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={session.provider} />
          <span className="font-medium text-[var(--text-primary)] line-clamp-1">
            {session.title || 'Untitled Session'}
          </span>
        </div>
        {session.pendingExecution && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--warning-color)] text-white">
            Pending
          </span>
        )}
      </div>

      {session.lastMessagePreview && (
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2 mb-2">
          {session.lastMessagePreview}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
        <span>{formattedTime}</span>
        <div className="flex items-center gap-3">
          {session.mode && (
            <span className="capitalize">{session.mode}</span>
          )}
          <span>{session.messageCount || 0} messages</span>
        </div>
      </div>
    </div>
  );
}

function ProviderIcon({ provider, size = 'normal' }: { provider: string; size?: 'small' | 'normal' }) {
  const sizeClass = size === 'small' ? 'w-4 h-4' : 'w-5 h-5';
  const textClass = size === 'small' ? 'text-[10px]' : 'text-xs';

  // Simple provider icons
  switch (provider?.toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return (
        <div className={`${sizeClass} rounded flex items-center justify-center bg-orange-100 text-orange-600 flex-shrink-0`}>
          <span className={`${textClass} font-bold`}>C</span>
        </div>
      );
    case 'openai':
      return (
        <div className={`${sizeClass} rounded flex items-center justify-center bg-green-100 text-green-600 flex-shrink-0`}>
          <span className={`${textClass} font-bold`}>O</span>
        </div>
      );
    default:
      return (
        <div className={`${sizeClass} rounded flex items-center justify-center bg-gray-100 text-gray-600 flex-shrink-0`}>
          <span className={`${textClass} font-bold`}>AI</span>
        </div>
      );
  }
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';

  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
