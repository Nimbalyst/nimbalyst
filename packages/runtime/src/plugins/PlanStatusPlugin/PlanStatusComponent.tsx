import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  NodeKey,
  LexicalEditor,
} from 'lexical';
import {
  $getFrontmatter,
  $setFrontmatter,
  type FrontmatterData,
} from 'rexical';
import './PlanStatus.css';
import { PlanStatusConfig } from './PlanStatusDecoratorNode';

interface PlanStatusComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
}

const statusOptions = [
  { value: 'draft', label: 'Draft', color: '#6b7280' },
  { value: 'ready-for-development', label: 'Ready for Dev', color: '#3b82f6' },
  { value: 'in-development', label: 'In Development', color: '#f59e0b' },
  { value: 'in-review', label: 'In Review', color: '#8b5cf6' },
  { value: 'completed', label: 'Completed', color: '#10b981' },
  { value: 'rejected', label: 'Rejected', color: '#ef4444' },
  { value: 'blocked', label: 'Blocked', color: '#dc2626' },
];

const priorityOptions = [
  { value: 'low', label: 'Low', color: '#10b981' },
  { value: 'medium', label: 'Medium', color: '#f59e0b' },
  { value: 'high', label: 'High', color: '#ef4444' },
  { value: 'critical', label: 'Critical', color: '#dc2626' },
];

const planTypeOptions = [
  { value: 'system-design', label: 'System Design' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug-fix', label: 'Bug Fix' },
  { value: 'refactor', label: 'Refactor' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'research', label: 'Research' },
];

type FrontmatterWithPlanStatus = FrontmatterData & {
  planStatus?: PlanStatusConfig;
};

const DEFAULT_CREATED_DATE = new Date().toISOString().split('T')[0];

export default function PlanStatusComponent({ nodeKey, editor }: PlanStatusComponentProps): JSX.Element {

  // UI State
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [showPlanTypeDropdown, setShowPlanTypeDropdown] = useState(false);

  // Data fields
  const [planId, setPlanId] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [planType, setPlanType] = useState('feature');
  const [priority, setPriority] = useState('medium');
  const [owner, setOwner] = useState('');
  const [stakeholders, setStakeholders] = useState('');
  const [tags, setTags] = useState('');
  const [created, setCreated] = useState(DEFAULT_CREATED_DATE);
  const [updated, setUpdated] = useState('');
  const [progress, setProgress] = useState(0);

  // Refs for click outside handling
  const containerRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);

  // Load initial data from node state
  useEffect(() => {
    const loadFromNodeState = () => {
      editor.getEditorState().read(() => {
        const frontmatter = $getFrontmatter() as FrontmatterWithPlanStatus | null;
        const config = frontmatter?.planStatus;

        setPlanId(config?.planId ?? '');
        setTitle(config?.title ?? '');
        setStatus(config?.status ?? 'draft');
        setPlanType(config?.planType ?? 'feature');
        setPriority(config?.priority ?? 'medium');
        setOwner(config?.owner ?? '');

        const stakeholdersValue = config?.stakeholders;
        setStakeholders(
          Array.isArray(stakeholdersValue)
            ? stakeholdersValue.join(', ')
            : (stakeholdersValue as string | undefined) ?? ''
        );

        const tagsValue = config?.tags;
        setTags(
          Array.isArray(tagsValue)
            ? tagsValue.join(', ')
            : (tagsValue as string | undefined) ?? ''
        );

        setCreated(config?.created ?? DEFAULT_CREATED_DATE);
        setUpdated(config?.updated ?? '');
        setProgress(config?.progress ?? 0);
      });
    };

    loadFromNodeState();

    // Listen for updates from other sources
    const removeListener = editor.registerUpdateListener(() => {
      loadFromNodeState();
    });

    return () => {
      removeListener();
    };
  }, [editor, nodeKey]);

  // Update node state helper - always updates the 'updated' timestamp
  const updateNodeState = useCallback((updates: Partial<PlanStatusConfig>) => {
    const now = new Date().toISOString();

    editor.update(() => {
      const frontmatter = $getFrontmatter() as FrontmatterWithPlanStatus | null;
      const currentConfig = (frontmatter?.planStatus ?? {}) as PlanStatusConfig;

      const nextConfig: PlanStatusConfig = {
        ...currentConfig,
        ...updates,
        updated: now,
      };

      const nextFrontmatter: FrontmatterData = {
        ...(frontmatter ?? {}),
        planStatus: nextConfig,
      };

      $setFrontmatter(nextFrontmatter);
    });

    setUpdated(now);
  }, [editor]);

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setEditingField(null);
        setShowStatusDropdown(false);
        setShowPriorityDropdown(false);
        setShowPlanTypeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Field edit handlers
  const handleFieldEdit = (field: string, value: string) => {
    switch(field) {
      case 'planId':
        setPlanId(value);
        updateNodeState({ planId: value });
        break;
      case 'title':
        setTitle(value);
        updateNodeState({ title: value });
        break;
      case 'owner':
        setOwner(value);
        updateNodeState({ owner: value });
        break;
      case 'stakeholders':
        setStakeholders(value);
        updateNodeState({
          stakeholders: value.split(',').map(s => s.trim()).filter(s => s)
        });
        break;
      case 'tags':
        setTags(value);
        updateNodeState({
          tags: value.split(',').map(t => t.trim()).filter(t => t)
        });
        break;
    }
  };

  const handleDateChange = (field: string, value: string) => {
    if (field === 'created') {
      setCreated(value);
      updateNodeState({ created: value });
    }
  };

  const handleProgressChange = (value: number) => {
    setProgress(value);
    updateNodeState({ progress: value });
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  };

  const selectedStatus = statusOptions.find(opt => opt.value === status) || statusOptions[0];
  const selectedPriority = priorityOptions.find(opt => opt.value === priority) || priorityOptions[1];

  return (
    <div className="plan-status-decorator-container" ref={containerRef}>
      <div className="plan-status-container">
        {/* Header row with main fields */}
        <div className="plan-status-header" onClick={() => setIsExpanded(!isExpanded)}>
          {/* Plan ID - Click to edit */}
          <div
            className={`plan-status-id ${editingField === 'planId' ? 'editing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditingField('planId');
            }}
          >
            {editingField === 'planId' ? (
              <input
                className="plan-status-inline-input"
                value={planId}
                onChange={(e) => handleFieldEdit('planId', e.target.value)}
                onBlur={() => setEditingField(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    setEditingField(null);
                  }
                }}
                autoFocus
                placeholder="plan-id"
              />
            ) : (
              planId || 'plan-id'
            )}
          </div>

          {/* Title - Click to edit */}
          <div
            className={`plan-status-title ${editingField === 'title' ? 'editing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditingField('title');
            }}
          >
            {editingField === 'title' ? (
              <input
                className="plan-status-inline-input"
                value={title}
                onChange={(e) => handleFieldEdit('title', e.target.value)}
                onBlur={() => setEditingField(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    setEditingField(null);
                  }
                }}
                autoFocus
                placeholder="Untitled Plan"
              />
            ) : (
              title || 'Untitled Plan'
            )}
          </div>

          {/* Status Badge - Click for dropdown */}
          <div className={`plan-status-badge ${status}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowStatusDropdown(!showStatusDropdown);
            }}
          >
            {selectedStatus.label}
            {showStatusDropdown && (
              <div className="plan-status-select" ref={statusDropdownRef}>
                {statusOptions.map(option => (
                  <div
                    key={option.value}
                    className={`plan-status-select-option ${option.value === status ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(option.value);
                      updateNodeState({ status: option.value });
                      setShowStatusDropdown(false);
                    }}
                  >
                    <span
                      className="plan-status-select-dot"
                      style={{ background: option.color }}
                    />
                    {option.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expand/Collapse icon */}
          <div className={`plan-status-expand-icon ${isExpanded ? 'expanded' : ''}`}>
            ▶
          </div>
        </div>

        {/* Summary row - always visible */}
        <div className="plan-status-summary">
          <div className="plan-status-summary-item">
            <span className="plan-status-summary-label">Priority:</span>
            <span
              className={`plan-status-priority ${priority}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowPriorityDropdown(!showPriorityDropdown);
              }}
            >
              {selectedPriority.label}
              {showPriorityDropdown && (
                <div className="plan-status-select">
                  {priorityOptions.map(option => (
                    <div
                      key={option.value}
                      className={`plan-status-select-option ${option.value === priority ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPriority(option.value);
                        updateNodeState({ priority: option.value });
                        setShowPriorityDropdown(false);
                      }}
                    >
                      <span
                        className="plan-status-select-dot"
                        style={{ background: option.color }}
                      />
                      {option.label}
                    </div>
                  ))}
                </div>
              )}
            </span>
          </div>

          <div className="plan-status-summary-item">
            <span className="plan-status-summary-label">Owner:</span>
            <span>{owner || 'Unassigned'}</span>
          </div>

          <div className="plan-status-summary-item plan-status-progress-bar">
            <span className="plan-status-summary-label">Progress:</span>
            <div className="plan-status-progress-track">
              <div
                className="plan-status-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="plan-status-progress-text">{progress}%</span>
          </div>

        </div>

        {/* Tags row - if tags exist */}
        {tags && (
          <div className="plan-status-tags-row">
            {tags.split(',').map((tag, index) => (
              tag.trim() && (
                <span key={index} className="plan-status-tag">
                  {tag.trim()}
                </span>
              )
            ))}
          </div>
        )}

        {/* Expanded details */}
        {isExpanded && (
          <div className="plan-status-expanded">
            <div className="plan-status-details-grid">
              {/* Type field */}
              <div className="plan-status-detail-item">
                <div className="plan-status-detail-label">Type</div>
                <div
                  className={`plan-status-detail-value ${editingField === 'planType' ? 'editing' : ''}`}
                  onClick={() => setShowPlanTypeDropdown(!showPlanTypeDropdown)}
                  style={{ position: 'relative' }}
                >
                  {planTypeOptions.find(opt => opt.value === planType)?.label || 'Feature'}
                  {showPlanTypeDropdown && (
                    <div className="plan-status-select">
                      {planTypeOptions.map(option => (
                        <div
                          key={option.value}
                          className={`plan-status-select-option ${option.value === planType ? 'selected' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlanType(option.value);
                            updateNodeState({ planType: option.value });
                            setShowPlanTypeDropdown(false);
                          }}
                        >
                          {option.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Stakeholders */}
              <div className="plan-status-detail-item">
                <div className="plan-status-detail-label">Stakeholders</div>
                <div
                  className={`plan-status-detail-value ${editingField === 'stakeholders' ? 'editing' : ''}`}
                  onClick={() => setEditingField('stakeholders')}
                >
                  {editingField === 'stakeholders' ? (
                    <input
                      className="plan-status-inline-input"
                      value={stakeholders}
                      onChange={(e) => handleFieldEdit('stakeholders', e.target.value)}
                      onBlur={() => setEditingField(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          setEditingField(null);
                        }
                      }}
                      autoFocus
                      placeholder="team1, team2"
                    />
                  ) : (
                    stakeholders || 'None'
                  )}
                </div>
              </div>

              {/* Created Date - Read Only */}
              <div className="plan-status-detail-item">
                <div className="plan-status-detail-label">Created</div>
                <div className="plan-status-detail-value plan-status-readonly">
                  {created || 'Not set'}
                </div>
              </div>

              {/* Updated Date - Read Only */}
              <div className="plan-status-detail-item">
                <div className="plan-status-detail-label">Updated</div>
                <div className="plan-status-detail-value plan-status-readonly">
                  {updated ? formatDate(updated.split('T')[0]) : 'Never'}
                </div>
              </div>

              {/* Progress slider in expanded view */}
              <div className="plan-status-detail-item" style={{ gridColumn: 'span 2' }}>
                <div className="plan-status-detail-label">Progress: {progress}%</div>
                <div className="plan-status-detail-value" style={{ padding: '8px' }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => handleProgressChange(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Tags editor in expanded view */}
              <div className="plan-status-detail-item" style={{ gridColumn: 'span 2' }}>
                <div className="plan-status-detail-label">Tags</div>
                <div
                  className={`plan-status-detail-value ${editingField === 'tags' ? 'editing' : ''}`}
                  onClick={() => setEditingField('tags')}
                >
                  {editingField === 'tags' ? (
                    <input
                      className="plan-status-inline-input"
                      value={tags}
                      onChange={(e) => handleFieldEdit('tags', e.target.value)}
                      onBlur={() => setEditingField(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          setEditingField(null);
                        }
                      }}
                      autoFocus
                      placeholder="tag1, tag2, tag3"
                    />
                  ) : (
                    tags || 'No tags'
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
