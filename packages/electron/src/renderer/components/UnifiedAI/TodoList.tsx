import React from 'react';
import './TodoList.css';

export interface Todo {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm: string;
}

export interface TodoListProps {
  todos: Todo[];
  sessionId: string;
}

export function TodoList({ todos, sessionId }: TodoListProps) {
  console.log(`[TodoList] Rendering with ${todos?.length || 0} todos for session ${sessionId}`);

  if (!todos || todos.length === 0) {
    console.log('[TodoList] No todos, returning null');
    return null;
  }

  console.log('[TodoList] Rendering todo list:', todos);

  return (
    <div className="todo-list" data-session-id={sessionId}>
      <div className="todo-list-header">
        <span className="todo-list-title">Tasks</span>
        <span className="todo-list-count">
          {todos.filter(t => t.status === 'completed').length}/{todos.length}
        </span>
      </div>
      <div className="todo-list-items">
        {todos.map((todo, index) => (
          <TodoItem key={index} todo={todo} />
        ))}
      </div>
    </div>
  );
}

interface TodoItemProps {
  todo: Todo;
}

function TodoItem({ todo }: TodoItemProps) {
  const displayText = todo.status === 'in_progress' ? todo.activeForm : todo.content;

  return (
    <div className={`todo-item todo-item-${todo.status}`} data-status={todo.status}>
      <div className="todo-item-icon">
        {todo.status === 'pending' && <span className="todo-icon-pending">○</span>}
        {todo.status === 'in_progress' && (
          <span className="todo-icon-in-progress">
            <span className="spinner" />
          </span>
        )}
        {todo.status === 'completed' && <span className="todo-icon-completed">●</span>}
      </div>
      <div className="todo-item-text">{displayText}</div>
    </div>
  );
}
