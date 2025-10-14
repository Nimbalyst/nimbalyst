/**
 * PlanFilters - Search and filter controls for plans panel
 */

import React from 'react';
import './PlanFilters.css';

interface PlanFiltersProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  priorityFilter: string;
  onPriorityChange: (priority: string) => void;
  hideCompleted: boolean;
  onHideCompletedChange: (hide: boolean) => void;
}

export function PlanFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  hideCompleted,
  onHideCompletedChange
}: PlanFiltersProps): JSX.Element {
  const statusOptions = [
    { value: 'all', label: 'All Status' },
    { value: 'draft', label: 'Draft' },
    { value: 'ready-for-development', label: 'Ready' },
    { value: 'in-development', label: 'In Dev' },
    { value: 'in-review', label: 'Review' },
    { value: 'completed', label: 'Done' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'rejected', label: 'Rejected' },
  ];

  const priorityOptions = [
    { value: 'all', label: 'All Priority' },
    { value: 'critical', label: 'Critical' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  return (
    <div className="plan-filters">
      <div className="plan-search-container">
        <span className="material-symbols-outlined plan-search-icon">
          search
        </span>
        <input
          type="text"
          className="plan-search-input"
          placeholder="Search plans..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchTerm && (
          <button
            className="plan-search-clear"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </div>

      <div className="plan-filter-controls">
        <select
          className="plan-filter-select"
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {statusOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="plan-filter-select"
          value={priorityFilter}
          onChange={(e) => onPriorityChange(e.target.value)}
        >
          {priorityOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="plan-filter-options">
        <label className="plan-filter-checkbox">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => onHideCompletedChange(e.target.checked)}
          />
          <span>Hide completed</span>
        </label>
      </div>
    </div>
  );
}
