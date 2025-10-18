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
import './DecisionStatus.css';
import { DecisionStatusConfig, DecisionStatus, DecisionType, DecisionOption } from './DecisionStatusDecoratorNode';

interface DecisionStatusComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
}

const statusOptions = [
  { value: 'proposed', label: 'Proposed', color: '#6b7280' },
  { value: 'in-discussion', label: 'In Discussion', color: '#f59e0b' },
  { value: 'decided', label: 'Decided', color: '#3b82f6' },
  { value: 'implemented', label: 'Implemented', color: '#10b981' },
  { value: 'rejected', label: 'Rejected', color: '#ef4444' },
  { value: 'superseded', label: 'Superseded', color: '#9ca3af' },
];

const decisionTypeOptions = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'product', label: 'Product' },
  { value: 'technical', label: 'Technical' },
  { value: 'process', label: 'Process' },
];

type FrontmatterWithDecisionStatus = FrontmatterData & {
  decisionStatus?: DecisionStatusConfig;
};

const DEFAULT_CREATED_DATE = new Date().toISOString().split('T')[0];

export default function DecisionStatusComponent({ nodeKey, editor }: DecisionStatusComponentProps): JSX.Element {

  // UI State
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showDecisionTypeDropdown, setShowDecisionTypeDropdown] = useState(false);

  // Data fields
  const [decisionId, setDecisionId] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('proposed');
  const [decisionType, setDecisionType] = useState('architecture');
  const [chosen, setChosen] = useState('');
  const [options, setOptions] = useState<DecisionOption[]>([]);
  const [owner, setOwner] = useState('');
  const [stakeholders, setStakeholders] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [created, setCreated] = useState(DEFAULT_CREATED_DATE);
  const [updated, setUpdated] = useState('');

  // New option input state
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionDescription, setNewOptionDescription] = useState('');

  // Refs for click outside handling
  const containerRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Load initial data from node state
  useEffect(() => {
    const loadFromNodeState = () => {
      editor.getEditorState().read(() => {
        const frontmatter = $getFrontmatter() as FrontmatterWithDecisionStatus | null;
        const config = frontmatter?.decisionStatus;

        setDecisionId(config?.decisionId ?? '');
        setTitle(config?.title ?? '');
        setStatus(config?.status ?? 'proposed');
        setDecisionType(config?.decisionType ?? 'architecture');
        setChosen(config?.chosen ?? '');
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

        // Parse options - support both string[] and DecisionOption[]
        const optionsValue = config?.options;
        if (Array.isArray(optionsValue)) {
          const parsedOptions = optionsValue.map(opt => {
            if (typeof opt === 'string') {
              return { name: opt };
            }
            return opt as DecisionOption;
          });
          setOptions(parsedOptions);
        } else {
          setOptions([]);
        }

        setCreated(config?.created ?? DEFAULT_CREATED_DATE);
        setUpdated(config?.updated ?? '');
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
  const updateNodeState = useCallback((updates: Partial<DecisionStatusConfig>) => {
    const now = new Date().toISOString();

    editor.update(() => {
      const frontmatter = $getFrontmatter() as FrontmatterWithDecisionStatus | null;
      const currentConfig = (frontmatter?.decisionStatus ?? {}) as DecisionStatusConfig;

      const nextConfig: DecisionStatusConfig = {
        ...currentConfig,
        ...updates,
        updated: now,
      };

      const nextFrontmatter: FrontmatterData = {
        ...(frontmatter ?? {}),
        decisionStatus: nextConfig,
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
        setShowDecisionTypeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Field edit handlers
  const handleFieldEdit = (field: string, value: string) => {
    switch(field) {
      case 'decisionId':
        setDecisionId(value);
        updateNodeState({ decisionId: value });
        break;
      case 'title':
        setTitle(value);
        updateNodeState({ title: value });
        break;
      case 'chosen':
        setChosen(value);
        updateNodeState({ chosen: value });
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
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  const handleAddOption = () => {
    if (newOptionName.trim()) {
      const newOption: DecisionOption = {
        name: newOptionName.trim(),
        description: newOptionDescription.trim() || undefined,
      };
      const updatedOptions = [...options, newOption];
      setOptions(updatedOptions);
      updateNodeState({ options: updatedOptions });
      setNewOptionName('');
      setNewOptionDescription('');
      setEditingField(null);
    }
  };

  const handleRemoveOption = (optionName: string) => {
    const updatedOptions = options.filter(opt => opt.name !== optionName);
    setOptions(updatedOptions);
    updateNodeState({ options: updatedOptions });
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

  return (
    <div className="decision-status-decorator-container" ref={containerRef}>
      <div className="decision-status-container">
        {/* Header row with main fields */}
        <div className="decision-status-header" onClick={() => setIsExpanded(!isExpanded)}>
          {/* Decision icon */}
          <div className="decision-status-icon">⚖️</div>

          {/* Decision ID - Click to edit */}
          <div
            className={`decision-status-id ${editingField === 'decisionId' ? 'editing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditingField('decisionId');
            }}
          >
            {editingField === 'decisionId' ? (
              <input
                className="decision-status-inline-input"
                value={decisionId}
                onChange={(e) => handleFieldEdit('decisionId', e.target.value)}
                onBlur={() => setEditingField(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    setEditingField(null);
                  }
                }}
                autoFocus
                placeholder="decision-id"
              />
            ) : (
              decisionId || 'decision-id'
            )}
          </div>

          {/* Title - Click to edit */}
          <div
            className={`decision-status-title ${editingField === 'title' ? 'editing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditingField('title');
            }}
          >
            {editingField === 'title' ? (
              <input
                className="decision-status-inline-input"
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
                placeholder="Untitled Decision"
              />
            ) : (
              title || 'Untitled Decision'
            )}
          </div>

          {/* Status Badge - Click for dropdown */}
          <div className={`decision-status-badge ${status}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowStatusDropdown(!showStatusDropdown);
            }}
          >
            {selectedStatus.label}
            {showStatusDropdown && (
              <div className="decision-status-select" ref={statusDropdownRef}>
                {statusOptions.map(option => (
                  <div
                    key={option.value}
                    className={`decision-status-select-option ${option.value === status ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(option.value);
                      updateNodeState({ status: option.value as DecisionStatus });
                      setShowStatusDropdown(false);
                    }}
                  >
                    <span
                      className="decision-status-select-dot"
                      style={{ background: option.color }}
                    />
                    {option.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expand/Collapse icon */}
          <div className={`decision-status-expand-icon ${isExpanded ? 'expanded' : ''}`}>
            ▶
          </div>
        </div>

        {/* Summary row - always visible */}
        <div className="decision-status-summary">
          <div className="decision-status-summary-item">
            <span className="decision-status-summary-label">Type:</span>
            <span
              className="decision-status-type"
              onClick={(e) => {
                e.stopPropagation();
                setShowDecisionTypeDropdown(!showDecisionTypeDropdown);
              }}
              style={{ position: 'relative' }}
            >
              {decisionTypeOptions.find(opt => opt.value === decisionType)?.label || 'Architecture'}
              {showDecisionTypeDropdown && (
                <div className="decision-status-select">
                  {decisionTypeOptions.map(option => (
                    <div
                      key={option.value}
                      className={`decision-status-select-option ${option.value === decisionType ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDecisionType(option.value);
                        updateNodeState({ decisionType: option.value as DecisionType });
                        setShowDecisionTypeDropdown(false);
                      }}
                    >
                      {option.label}
                    </div>
                  ))}
                </div>
              )}
            </span>
          </div>

          <div className="decision-status-summary-item">
            <span className="decision-status-summary-label">Owner:</span>
            <span
              className={`decision-status-owner ${editingField === 'owner' ? 'editing' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditingField('owner');
              }}
            >
              {editingField === 'owner' ? (
                <input
                  className="decision-status-inline-input"
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

          {chosen && (
            <div className="decision-status-summary-item decision-status-chosen">
              <span className="decision-status-summary-label">Chosen:</span>
              <span className="decision-status-chosen-value">{chosen}</span>
            </div>
          )}
        </div>

        {/* Tags row - if tags exist */}
        {tags.length > 0 && (
          <div className="decision-status-tags-row">
            {tags.map((tag, index) => (
              <span key={index} className="decision-status-tag">
                {tag}
                <span
                  className="decision-status-tag-remove"
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
                className="decision-status-tag-input"
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
                className="decision-status-tag decision-status-tag-add"
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
          <div className="decision-status-tags-row">
            <span
              className="decision-status-tag decision-status-tag-add"
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
          <div className="decision-status-tags-row">
            <input
              className="decision-status-tag-input"
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
          <div className="decision-status-expanded">
            {/* Chosen option field */}
            <div className="decision-status-detail-item decision-status-chosen-field">
              <div className="decision-status-detail-label">Chosen Option</div>
              <div
                className={`decision-status-detail-value ${editingField === 'chosen' ? 'editing' : ''}`}
                onClick={() => setEditingField('chosen')}
              >
                {editingField === 'chosen' ? (
                  <input
                    className="decision-status-inline-input"
                    value={chosen}
                    onChange={(e) => handleFieldEdit('chosen', e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        setEditingField(null);
                      }
                    }}
                    autoFocus
                    placeholder="Option name"
                  />
                ) : (
                  chosen || 'Not yet decided'
                )}
              </div>
            </div>

            {/* Options considered */}
            <div className="decision-status-options-section">
              <div className="decision-status-detail-label">Options Considered</div>
              <div className="decision-status-options-list">
                {options.map((option, index) => (
                  <div key={index} className="decision-status-option-item">
                    <div className="decision-status-option-header">
                      <span className="decision-status-option-name">{option.name}</span>
                      <span
                        className="decision-status-option-remove"
                        onClick={() => handleRemoveOption(option.name)}
                      >
                        ×
                      </span>
                    </div>
                    {option.description && (
                      <div className="decision-status-option-description">{option.description}</div>
                    )}
                  </div>
                ))}
                {editingField === 'options' ? (
                  <div className="decision-status-option-form">
                    <input
                      className="decision-status-inline-input"
                      value={newOptionName}
                      onChange={(e) => setNewOptionName(e.target.value)}
                      placeholder="Option name"
                      autoFocus
                    />
                    <input
                      className="decision-status-inline-input"
                      value={newOptionDescription}
                      onChange={(e) => setNewOptionDescription(e.target.value)}
                      placeholder="Description (optional)"
                    />
                    <div className="decision-status-option-form-buttons">
                      <button onClick={handleAddOption}>Add</button>
                      <button onClick={() => {
                        setEditingField(null);
                        setNewOptionName('');
                        setNewOptionDescription('');
                      }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="decision-status-option-add"
                    onClick={() => setEditingField('options')}
                  >
                    + Add option
                  </div>
                )}
              </div>
            </div>

            <div className="decision-status-details-grid">
              {/* Stakeholders */}
              <div className="decision-status-detail-item">
                <div className="decision-status-detail-label">Stakeholders</div>
                <div
                  className={`decision-status-detail-value ${editingField === 'stakeholders' ? 'editing' : ''}`}
                  onClick={() => setEditingField('stakeholders')}
                >
                  {editingField === 'stakeholders' ? (
                    <input
                      className="decision-status-inline-input"
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
              <div className="decision-status-detail-item">
                <div className="decision-status-detail-label">Created</div>
                <div className="decision-status-detail-value decision-status-readonly">
                  {created || 'Not set'}
                </div>
              </div>

              {/* Updated Date - Read Only */}
              <div className="decision-status-detail-item">
                <div className="decision-status-detail-label">Updated</div>
                <div className="decision-status-detail-value decision-status-readonly">
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
