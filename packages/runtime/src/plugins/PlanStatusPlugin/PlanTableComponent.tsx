/**
 * PlanTableComponent - Displays all plan documents in a table format
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { NodeKey, $getNodeByKey } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import type { DocumentMetadataEntry, MetadataChangeEvent } from '../../core/DocumentService';
import type { SortColumn, SortDirection } from './PlanTableNode';
import { $getPlanStatusNode } from './PlanStatusDecoratorNode';
import { PlanTableNode } from './PlanTableNode';
import './PlanTable.css';

interface PlanTableComponentProps {
  nodeKey: NodeKey;
  sortBy?: SortColumn;
  sortDirection?: SortDirection;
}

interface PlanData {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  progress: number;
  path: string;
  lastUpdated: Date;
  tags?: string[];
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

function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours < 1) return 'Updated just now';
  if (hours < 24) return `Updated ${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return `Updated ${days} days ago`;
  if (days < 30) return `Updated ${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

export default function PlanTableComponent({
  nodeKey,
  sortBy = 'lastUpdated',
  sortDirection = 'desc'
}: PlanTableComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isSelected] = useLexicalNodeSelection(nodeKey);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSortBy, setCurrentSortBy] = useState<SortColumn>(sortBy);
  const [currentSortDirection, setCurrentSortDirection] = useState<SortDirection>(sortDirection);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    async function loadPlans() {
      try {
        // Get document service from window context
        const documentService = (window as any).documentService;
        // console.log('[PlanTable] window.api available:', !!(window as any).api);
        // console.log('[PlanTable] window.documentService available:', !!documentService);

        if (!documentService) {
          console.log('[PlanTable] Document service not available yet');
          setError('Document service not available');
          setLoading(false);
          return;
        }

        if (!documentService.listDocumentMetadata) {
          setError('Document metadata not supported');
          setLoading(false);
          return;
        }

        // Load initial metadata
        // console.log('[PlanTable] About to call listDocumentMetadata');
        const metadata = await documentService.listDocumentMetadata();
        // console.log('[PlanTable] Loaded metadata:', metadata?.length || 0, 'entries');
        // console.log('[PlanTable] First metadata item:', metadata && metadata[0]);

        if (metadata && metadata.length > 0) {
          // Debug: Show what we got
          const sample = metadata[0];
          // console.log('[PlanTable] Sample metadata:', {
          //   path: sample.path,
          //   hasFrontmatter: Object.keys(sample.frontmatter || {}).length > 0,
          //   frontmatter: sample.frontmatter
          // });
        }

        const planDocs = extractPlanData(metadata || []);
        setPlans(planDocs);
        setLoading(false);

        // Subscribe to changes
        if (documentService.watchDocumentMetadata) {
          unsubscribe = documentService.watchDocumentMetadata((change: MetadataChangeEvent) => {
            // Re-fetch all metadata on change for simplicity
            documentService.listDocumentMetadata().then((updatedMetadata: DocumentMetadataEntry[]) => {
              const updatedPlans = extractPlanData(updatedMetadata);
              setPlans(updatedPlans);
            });
          });
        }
      } catch (err) {
        console.error('Failed to load plan documents:', err);
        setError('Failed to load plans');
        setLoading(false);
      }
    }

    loadPlans();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const sortPlans = useCallback((plansToSort: PlanData[], sortColumn: SortColumn, sortDir: SortDirection) => {
    const sorted = [...plansToSort].sort((a, b) => {
      let compareValue = 0;

      switch (sortColumn) {
        case 'title':
          compareValue = a.title.localeCompare(b.title);
          break;
        case 'status':
          compareValue = a.status.localeCompare(b.status);
          break;
        case 'progress':
          compareValue = a.progress - b.progress;
          break;
        case 'priority': {
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          const aPriority = priorityOrder[a.priority.toLowerCase() as keyof typeof priorityOrder] ?? 4;
          const bPriority = priorityOrder[b.priority.toLowerCase() as keyof typeof priorityOrder] ?? 4;
          compareValue = aPriority - bPriority;
          break;
        }
        case 'lastUpdated':
        default:
          compareValue = a.lastUpdated.getTime() - b.lastUpdated.getTime();
          break;
      }

      return sortDir === 'asc' ? compareValue : -compareValue;
    });

    return sorted;
  }, []);

  function extractPlanData(metadata: DocumentMetadataEntry[]): PlanData[] {
    const filteredData = metadata
      .filter(doc => {
        // More flexible checking for plan documents
        const pathLower = doc.path.toLowerCase();
        const isInPlansFolder = pathLower.includes('plan') || pathLower.includes('plans/');
        const hasPlanStatus = !!(doc.frontmatter && doc.frontmatter.planStatus);
        const hasPlanInName = pathLower.endsWith('-plan.md') || pathLower.includes('plan-');

        // Also check if the document looks like a plan based on frontmatter
        const hasStatusField = doc.frontmatter && ('status' in doc.frontmatter || 'planStatus' in doc.frontmatter);

        const shouldInclude = hasPlanStatus || (isInPlansFolder && hasStatusField) || hasPlanInName;

        return shouldInclude;
      })
      .map(doc => {
        const planStatus = doc.frontmatter.planStatus as any || {};
        const frontmatter = doc.frontmatter;

        return {
          id: planStatus.planId || doc.id,
          title: planStatus.title || frontmatter.title || doc.path.split('/').pop()?.replace('.md', '') || 'Untitled',
          status: planStatus.status || frontmatter.status || 'draft',
          owner: planStatus.owner || frontmatter.owner || 'unassigned',
          priority: planStatus.priority || frontmatter.priority || 'medium',
          progress: planStatus.progress || frontmatter.progress || 0,
          path: doc.path,
          lastUpdated: doc.lastModified,
          tags: planStatus.tags || frontmatter.tags,
        } as PlanData;
      });

    return sortPlans(filteredData, currentSortBy, currentSortDirection);
  }

  const handleRowClick = (plan: PlanData) => {
    // Open the document when clicked
    const documentService = (window as any).documentService;
    if (documentService && documentService.openDocument) {
      documentService.getDocumentByPath(plan.path).then((doc: any) => {
        if (doc) {
          documentService.openDocument(doc.id);
        }
      });
    }
  };

  const handleColumnClick = (column: SortColumn) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as PlanTableNode | null;
      if (node) {
        const newDirection = currentSortBy === column && currentSortDirection === 'desc' ? 'asc' : 'desc';
        node.setSorting(column, newDirection);
        setCurrentSortBy(column);
        setCurrentSortDirection(newDirection);
        // Re-sort existing plans immediately
        setPlans(prevPlans => sortPlans(prevPlans, column, newDirection));
      }
    });
  };

  const getSortIndicator = (column: SortColumn) => {
    if (currentSortBy !== column) {
      return <span className="sort-indicator">⇅</span>;
    }
    return currentSortDirection === 'desc'
      ? <span className="sort-indicator active">↓</span>
      : <span className="sort-indicator active">↑</span>;
  };

  if (loading) {
    return (
      <div className="plan-table-loading">
        <div className="spinner"></div>
        <span>Loading plans...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="plan-table-error">
        <span>⚠️ {error}</span>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="plan-table-empty">
        <span>No plan documents found</span>
      </div>
    );
  }

  return (
    <div className={`plan-table-wrapper ${isSelected ? 'selected' : ''}`}>
      <table className="plan-table">
        <thead>
          <tr>
            <th
              className="plan-table-header project sortable"
              onClick={() => handleColumnClick('title')}
            >
              <span>PROJECT</span>
              {getSortIndicator('title')}
            </th>
            <th
              className="plan-table-header status sortable"
              onClick={() => handleColumnClick('status')}
            >
              <span>STATUS</span>
              {getSortIndicator('status')}
            </th>
            <th
              className="plan-table-header priority sortable"
              onClick={() => handleColumnClick('priority')}
            >
              <span>PRIORITY</span>
              {getSortIndicator('priority')}
            </th>
            <th
              className="plan-table-header updated sortable"
              onClick={() => handleColumnClick('lastUpdated')}
            >
              <span>LAST UPDATED</span>
              {getSortIndicator('lastUpdated')}
            </th>
            <th
              className="plan-table-header progress sortable"
              onClick={() => handleColumnClick('progress')}
            >
              <span>PROGRESS</span>
              {getSortIndicator('progress')}
            </th>
          </tr>
        </thead>
        <tbody>
          {plans.map(plan => (
            <tr
              key={plan.id}
              className="plan-table-row"
              onClick={() => handleRowClick(plan)}
            >
              <td className="plan-table-cell project">
                <div className="project-info">
                  <div className="project-title">{plan.title}</div>
                </div>
              </td>
              <td className="plan-table-cell status">
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: `${getStatusColor(plan.status)}20`,
                    color: getStatusColor(plan.status),
                    borderColor: getStatusColor(plan.status)
                  }}
                >
                  {plan.status.charAt(0).toUpperCase() + plan.status.slice(1).replace('-', ' ')}
                </span>
              </td>
              <td className="plan-table-cell priority">
                <span
                  className="priority-badge"
                  style={{ color: getPriorityColor(plan.priority) }}
                >
                  {plan.priority.charAt(0).toUpperCase() + plan.priority.slice(1)}
                </span>
              </td>
              <td className="plan-table-cell updated">
                <span className="updated-text">{formatDate(plan.lastUpdated)}</span>
              </td>
              <td className="plan-table-cell progress">
                <div className="progress-compact">
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${plan.progress}%`,
                        backgroundColor: plan.progress === 100 ? '#22c55e' : plan.progress > 0 ? '#60a5fa' : 'transparent'
                      }}
                    />
                    <span className="progress-value">{plan.progress}%</span>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
