import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  NodeKey,
  LexicalEditor,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical';
import {
  $getFrontmatter,
  $setFrontmatter,
  type FrontmatterData,
} from 'rexical';
import './PlanStatus.css';
import { PlanStatusConfig, PlanStatus, PlanPriority, AgentSession } from './PlanStatusDecoratorNode';

// Extend window type to include globals
declare global {
  interface Window {
    workspacePath?: string | null;
    currentFilePath?: string | null;
  }
}

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
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [created, setCreated] = useState(DEFAULT_CREATED_DATE);
  const [updated, setUpdated] = useState('');
  const [progress, setProgress] = useState(0);
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);

  // Refs for click outside handling
  const containerRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);

  // Store the file path this component belongs to (captured at mount time)
  const componentFilePathRef = useRef<string | null>(null);

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
            ? tagsValue
            : typeof tagsValue === 'string' && tagsValue
            ? (tagsValue as string).split(',').map(t => t.trim()).filter(Boolean)
            : []
        );

        setCreated(config?.created ?? DEFAULT_CREATED_DATE);
        setUpdated(config?.updated ?? '');
        setProgress(config?.progress ?? 0);
        setAgentSessions(config?.agentSessions ?? []);
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

  // Capture this component's file path at mount
  useEffect(() => {
    componentFilePathRef.current = window.currentFilePath;
  }, []); // Only run once at mount

  // Listen for agent session creation events from electron
  useEffect(() => {
    if (!window.electronAPI?.on) return;

    const handleSessionCreated = (sessionId: string, planPath: string) => {
      // Check if this event is for THIS component's document (not the currently active tab)
      if (componentFilePathRef.current === planPath) {
        const newSession: AgentSession = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          status: 'active'
        };

        setAgentSessions(prev => {
          // Check if session already exists
          if (prev.some(s => s.id === sessionId)) {
            return prev;
          }
          const updated = [...prev, newSession];
          // Update frontmatter
          editor.update(() => {
            const frontmatter = $getFrontmatter() as FrontmatterWithPlanStatus | null;
            const currentConfig = (frontmatter?.planStatus ?? {}) as PlanStatusConfig;
            const nextConfig: PlanStatusConfig = {
              ...currentConfig,
              agentSessions: updated,
              updated: new Date().toISOString()
            };
            const nextFrontmatter: FrontmatterData = {
              ...(frontmatter ?? {}),
              planStatus: nextConfig
            };
            $setFrontmatter(nextFrontmatter);
          }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });
          return updated;
        });
      }
    };

    const cleanup = window.electronAPI.on('plan-status:agent-session-created', handleSessionCreated);

    return () => {
      if (cleanup && typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [editor]);

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
    }, { tag: SKIP_SCROLL_INTO_VIEW_TAG });

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

  const handleAddTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const newTags = [...tags, trimmedTag];
      setTags(newTags);
      updateNodeState({ tags: newTags });
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const newTags = tags.filter(tag => tag !== tagToRemove);
    setTags(newTags);
    updateNodeState({ tags: newTags });
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagInput.trim()) {
        handleAddTag(tagInput);
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      // Remove last tag when backspace is pressed on empty input
      handleRemoveTag(tags[tags.length - 1]);
    }
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

  // Agent session handlers
  const handleLaunchAgentSession = async () => {
    if (!window.electronAPI || !window.workspacePath || !window.currentFilePath) {
      console.warn('[PlanStatus] Cannot launch agent session: missing electronAPI, workspace or file path');
      return;
    }

    try {
      const result = await window.electronAPI.invoke('plan-status:launch-agent-session', {
        workspacePath: window.workspacePath,
        planDocumentPath: window.currentFilePath
      });

      if (result.success && result.sessionId) {
        // Add the new session to the plan status
        const newSession: AgentSession = {
          id: result.sessionId,
          createdAt: new Date().toISOString(),
          status: 'active'
        };

        const updatedSessions = [...agentSessions, newSession];
        setAgentSessions(updatedSessions);
        updateNodeState({ agentSessions: updatedSessions });
      }
    } catch (error) {
      console.error('[PlanStatus] Failed to launch agent session:', error);
    }
  };

  const handleOpenAgentSession = async (sessionId: string) => {
    if (!window.electronAPI || !window.workspacePath) {
      console.warn('[PlanStatus] Cannot open agent session: missing electronAPI or workspace');
      return;
    }

    try {
      await window.electronAPI.invoke('plan-status:open-agent-session', {
        sessionId,
        workspacePath: window.workspacePath,
        planDocumentPath: window.currentFilePath
      });
    } catch (error) {
      console.error('[PlanStatus] Failed to open agent session:', error);
    }
  };

  const selectedStatus = statusOptions.find(opt => opt.value === status) || statusOptions[0];
  const selectedPriority = priorityOptions.find(opt => opt.value === priority) || priorityOptions[1];
  const activeSessions = agentSessions.filter(s => s.status !== 'closed');
  const hasActiveSessions = activeSessions.length > 0;

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
                      updateNodeState({ status: option.value as PlanStatus });
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
                        updateNodeState({ priority: option.value as PlanPriority });
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
            <span
              className={`plan-status-owner ${editingField === 'owner' ? 'editing' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditingField('owner');
              }}
            >
              {editingField === 'owner' ? (
                <input
                  className="plan-status-inline-input"
                  value={owner}
                  onChange={(e) => handleFieldEdit('owner', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      setEditingField(null);
                    }
                  }}
                  autoFocus
                  placeholder="Unassigned"
                />
              ) : (
                owner || 'Unassigned'
              )}
            </span>
          </div>

          <div className="plan-status-summary-item plan-status-progress-bar">
            <span className="plan-status-summary-label">Progress:</span>
            <div
              className={`plan-status-progress-wrapper ${editingField === 'progress' ? 'editing' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditingField('progress');
              }}
            >
              {editingField === 'progress' ? (
                <>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(e) => handleProgressChange(Number(e.target.value))}
                    onBlur={() => setEditingField(null)}
                    className="plan-status-progress-slider"
                    autoFocus
                  />
                  <span className="plan-status-progress-text">{progress}%</span>
                </>
              ) : (
                <>
                  <div className="plan-status-progress-track">
                    <div
                      className="plan-status-progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="plan-status-progress-text">{progress}%</span>
                </>
              )}
            </div>
          </div>

          {/* Agent Session Button */}
          <div className="plan-status-summary-item" style={{ position: 'relative' }}>
            {!hasActiveSessions ? (
              <button
                className="plan-status-agent-launch-button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLaunchAgentSession();
                }}
                title="Launch Agent Coding Session"
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.75rem',
                  backgroundColor: 'var(--primary-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                Launch Agent
              </button>
            ) : (
              <div style={{ position: 'relative' }}>
                <button
                  className="plan-status-agent-session-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeSessions.length === 1) {
                      handleOpenAgentSession(activeSessions[0].id);
                    } else {
                      setShowSessionDropdown(!showSessionDropdown);
                    }
                  }}
                  title="Open Agent Coding Session"
                  style={{
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.75rem',
                    backgroundColor: 'var(--surface-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  Agent Session{activeSessions.length > 1 ? 's' : ''} ({activeSessions.length})
                  {activeSessions.length > 1 && <span style={{ fontSize: '0.625rem' }}>▼</span>}
                </button>
                {showSessionDropdown && activeSessions.length > 1 && (
                  <div
                    className="plan-status-session-dropdown"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '0.25rem',
                      backgroundColor: 'var(--surface-secondary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '0.25rem',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                      zIndex: 1000,
                      minWidth: '12rem'
                    }}
                  >
                    {activeSessions.map((session, idx) => (
                      <div
                        key={session.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenAgentSession(session.id);
                          setShowSessionDropdown(false);
                        }}
                        style={{
                          padding: '0.5rem 0.75rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)',
                          borderBottom: idx < activeSessions.length - 1 ? '1px solid var(--border-primary)' : 'none'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        Session {idx + 1}
                        <div style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)', marginTop: '0.125rem' }}>
                          {formatDate(session.createdAt)}
                        </div>
                      </div>
                    ))}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLaunchAgentSession();
                        setShowSessionDropdown(false);
                      }}
                      style={{
                        padding: '0.5rem 0.75rem',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        color: 'var(--primary-color)',
                        fontWeight: 500,
                        borderTop: '1px solid var(--border-primary)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      + New Session
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Tags row - if tags exist */}
        {tags.length > 0 && (
          <div className="plan-status-tags-row">
            {tags.map((tag, index) => (
              <span key={index} className="plan-status-tag">
                {tag}
                <span
                  className="plan-status-tag-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveTag(tag);
                  }}
                >
                  ×
                </span>
              </span>
            ))}
            {editingField === 'tags' && (
              <input
                className="plan-status-tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                onBlur={() => {
                  if (tagInput.trim()) {
                    handleAddTag(tagInput);
                  }
                  setEditingField(null);
                }}
                placeholder="Add tag..."
                autoFocus
              />
            )}
            {editingField !== 'tags' && (
              <span
                className="plan-status-tag plan-status-tag-add"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingField('tags');
                }}
              >
                + Add tag
              </span>
            )}
          </div>
        )}
        {tags.length === 0 && editingField !== 'tags' && (
          <div className="plan-status-tags-row">
            <span
              className="plan-status-tag plan-status-tag-add"
              onClick={(e) => {
                e.stopPropagation();
                setEditingField('tags');
              }}
            >
              + Add tag
            </span>
          </div>
        )}
        {tags.length === 0 && editingField === 'tags' && (
          <div className="plan-status-tags-row">
            <input
              className="plan-status-tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              onBlur={() => {
                if (tagInput.trim()) {
                  handleAddTag(tagInput);
                }
                setEditingField(null);
              }}
              placeholder="Add tag..."
              autoFocus
            />
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

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
