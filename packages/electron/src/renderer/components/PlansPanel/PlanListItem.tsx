/**
 * PlanListItem - Individual plan item in the sidebar plans list
 */

import React from 'react';
import './PlanListItem.css';

export interface PlanData {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  progress: number;
  path: string;
  lastUpdated: Date;
  tags?: string[];
  planType?: string;
}

interface PlanListItemProps {
  plan: PlanData;
  isActive?: boolean;
  onClick: (plan: PlanData) => void;
}

function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    'completed': '#22c55e',
    'in-progress': '#eab308',
    'in-development': '#eab308',
    'active': '#22c55e',
    'cancelled': '#ef4444',
    'blocked': '#ef4444',
    'draft': '#6b7280',
    'ready-for-development': '#3b82f6',
    'in-review': '#8b5cf6',
    'rejected': '#dc2626',
  };
  return statusColors[status.toLowerCase()] || '#6b7280';
}

function getPriorityColor(priority: string): string {
  const priorityColors: Record<string, string> = {
    'critical': '#dc2626',
    'high': '#ef4444',
    'medium': '#f59e0b',
    'low': '#6b7280',
  };
  return priorityColors[priority.toLowerCase()] || '#6b7280';
}

function getPlanTypeIcon(planType?: string): string {
  const icons: Record<string, string> = {
    'feature': 'add_circle',
    'bug-fix': 'bug_report',
    'refactor': 'construction',
    'system-design': 'architecture',
    'research': 'science',
  };
  return icons[planType?.toLowerCase() || ''] || 'description';
}

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours < 1) return 'now';
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PlanListItem({ plan, isActive, onClick }: PlanListItemProps): JSX.Element {
  const statusColor = getStatusColor(plan.status);
  const priorityColor = getPriorityColor(plan.priority);
  const planTypeIcon = getPlanTypeIcon(plan.planType);

  return (
    <div
      className={`plan-list-item ${isActive ? 'active' : ''}`}
      onClick={() => onClick(plan)}
    >
      <div className="plan-list-item-header">
        <span
          className="plan-priority-indicator"
          style={{ color: priorityColor }}
          title={`Priority: ${plan.priority}`}
        >
          {plan.priority === 'critical' && '!!!'}
          {plan.priority === 'high' && '!!'}
          {plan.priority === 'medium' && '!'}
        </span>
        <span className="material-symbols-outlined plan-type-icon" title={plan.planType || 'plan'}>
          {planTypeIcon}
        </span>
        <div className="plan-list-item-title">{plan.title}</div>
      </div>

      {plan.progress > 0 && (
        <div className="plan-progress-bar">
          <div
            className="plan-progress-fill"
            style={{
              width: `${plan.progress}%`,
              backgroundColor: plan.progress === 100 ? '#22c55e' : '#60a5fa'
            }}
          />
        </div>
      )}

      <div className="plan-list-item-footer">
        <span className="plan-updated-time">{formatDate(plan.lastUpdated)}</span>
        <span
          className="plan-status-badge"
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            borderColor: statusColor
          }}
        >
          {plan.status.replace('-', ' ')}
        </span>
      </div>
    </div>
  );
}
