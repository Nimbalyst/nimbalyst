import React from 'react';
import type { TodoItem } from '../types';

interface TodosSidebarProps {
  todos: TodoItem[];
  onTodoClick?: (todo: TodoItem) => void;
}

export const TodosSidebar: React.FC<TodosSidebarProps> = ({
  todos,
  onTodoClick
}) => {
  const getStatusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return (
          <svg className="w-4 h-4 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'in_progress':
        return (
          <svg className="w-4 h-4 text-interactive animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'pending':
        return (
          <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getStatusColor = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-status-success/10 border-status-success/30';
      case 'in_progress':
        return 'bg-interactive/10 border-interactive/30';
      case 'pending':
        return 'bg-surface-tertiary/50 border-border-primary';
    }
  };

  const getStatusLabel = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'in_progress':
        return 'In Progress';
      case 'pending':
        return 'Pending';
    }
  };

  const formatTimeAgo = (timestamp?: string): string => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  // Group todos by status
  const groupedTodos = {
    in_progress: todos.filter(t => t.status === 'in_progress'),
    pending: todos.filter(t => t.status === 'pending'),
    completed: todos.filter(t => t.status === 'completed')
  };

  const completedCount = groupedTodos.completed.length;
  const totalCount = todos.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-surface-secondary border-r border-border-primary">
      <div className="p-4 border-b border-border-primary">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <svg className="w-4 h-4" style={{ width: '1rem', height: '1rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          Tasks
        </h3>
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-text-tertiary mb-1">
            <span>{completedCount} of {totalCount} completed</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-surface-tertiary rounded-full h-1.5">
            <div
              className="bg-status-success rounded-full h-1.5 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="p-4 text-text-tertiary text-sm text-center">
            No tasks yet
          </div>
        ) : (
          <div className="p-2 space-y-3">
            {/* In Progress */}
            {groupedTodos.in_progress.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 mb-1">
                  In Progress ({groupedTodos.in_progress.length})
                </div>
                <div className="space-y-1">
                  {groupedTodos.in_progress.map(todo => (
                    <button
                      key={todo.id}
                      onClick={() => onTodoClick?.(todo)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-bg-hover ${getStatusColor(todo.status)}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {getStatusIcon(todo.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary">
                            {todo.activeForm}
                          </div>
                          {todo.timestamp && (
                            <div className="text-xs text-text-tertiary mt-1">
                              {formatTimeAgo(todo.timestamp)}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pending */}
            {groupedTodos.pending.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 mb-1">
                  Pending ({groupedTodos.pending.length})
                </div>
                <div className="space-y-1">
                  {groupedTodos.pending.map(todo => (
                    <button
                      key={todo.id}
                      onClick={() => onTodoClick?.(todo)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-bg-hover ${getStatusColor(todo.status)}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {getStatusIcon(todo.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary">
                            {todo.content}
                          </div>
                          {todo.timestamp && (
                            <div className="text-xs text-text-tertiary mt-1">
                              {formatTimeAgo(todo.timestamp)}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Completed */}
            {groupedTodos.completed.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 mb-1">
                  Completed ({groupedTodos.completed.length})
                </div>
                <div className="space-y-1">
                  {groupedTodos.completed.map(todo => (
                    <button
                      key={todo.id}
                      onClick={() => onTodoClick?.(todo)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-bg-hover ${getStatusColor(todo.status)}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {getStatusIcon(todo.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary line-through opacity-60">
                            {todo.content}
                          </div>
                          {todo.timestamp && (
                            <div className="text-xs text-text-tertiary mt-1">
                              {formatTimeAgo(todo.timestamp)}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
