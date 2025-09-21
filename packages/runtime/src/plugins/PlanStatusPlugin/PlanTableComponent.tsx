/**
 * PlanTableComponent - Displays all plan documents in a table format
 */

import React, { useEffect, useState, useMemo } from 'react';
import { NodeKey } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { $getNodeByKey } from 'lexical';
import type { DocumentMetadataEntry, MetadataChangeEvent } from '../../core/DocumentService';
import './PlanTable.css';

interface PlanTableComponentProps {
  nodeKey: NodeKey;
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

export default function PlanTableComponent({ nodeKey }: PlanTableComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isSelected] = useLexicalNodeSelection(nodeKey);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  function extractPlanData(metadata: DocumentMetadataEntry[]): PlanData[] {
    // console.log('[PlanTable] Total metadata entries:', metadata.length);
    // console.log('[PlanTable] Sample paths:', metadata.slice(0, 5).map(d => d.path));
    // console.log('[PlanTable] Sample frontmatter:', metadata.slice(0, 3).map(d => ({
    //   path: d.path,
    //   frontmatter: d.frontmatter,
    //   hasPlanStatus: !!d.frontmatter?.planStatus,
    //   frontmatterKeys: Object.keys(d.frontmatter || {})
    // })));

    return metadata
      .filter(doc => {
        // More flexible checking for plan documents
        const pathLower = doc.path.toLowerCase();
        const isInPlansFolder = pathLower.includes('plan') || pathLower.includes('plans/');
        const hasPlanStatus = !!(doc.frontmatter && doc.frontmatter.planStatus);
        const hasPlanInName = pathLower.endsWith('-plan.md') || pathLower.includes('plan-');

        // Also check if the document looks like a plan based on frontmatter
        const hasStatusField = doc.frontmatter && ('status' in doc.frontmatter || 'planStatus' in doc.frontmatter);

        const shouldInclude = hasPlanStatus || (isInPlansFolder && hasStatusField) || hasPlanInName;

        // if (shouldInclude) {
          // console.log('[PlanTable] Including document as plan:', doc.path, {
          //   isInPlansFolder,
          //   hasPlanStatus,
          //   hasPlanInName,
          //   hasStatusField,
          //   frontmatter: doc.frontmatter
          // });
        // }

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
      })
      .sort((a, b) => {
        // Sort by priority first, then by last updated
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const aPriority = priorityOrder[a.priority.toLowerCase() as keyof typeof priorityOrder] ?? 4;
        const bPriority = priorityOrder[b.priority.toLowerCase() as keyof typeof priorityOrder] ?? 4;

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        return b.lastUpdated.getTime() - a.lastUpdated.getTime();
      });
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
            <th className="plan-table-header project">PROJECT</th>
            <th className="plan-table-header status">STATUS</th>
            <th className="plan-table-header owner">OWNER</th>
            <th className="plan-table-header priority">PRIORITY</th>
            <th className="plan-table-header progress">PROGRESS</th>
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
                  <div className="project-meta">
                    <span className="project-id">{plan.id}</span>
                    <span className="separator">•</span>
                    <span className="project-updated">{formatDate(plan.lastUpdated)}</span>
                  </div>
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
              <td className="plan-table-cell owner">
                {plan.owner}
              </td>
              <td className="plan-table-cell priority">
                <span
                  className="priority-badge"
                  style={{ color: getPriorityColor(plan.priority) }}
                >
                  {plan.priority.charAt(0).toUpperCase() + plan.priority.slice(1)}
                </span>
              </td>
              <td className="plan-table-cell progress">
                <div className="progress-container">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${plan.progress}%`,
                        backgroundColor: plan.progress === 100 ? '#22c55e' : '#3b82f6'
                      }}
                    />
                  </div>
                  <span className="progress-text">{plan.progress}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
