import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  NodeKey,
  LexicalEditor,
} from 'lexical';
import './TrackerItem.css';
import {
  TrackerItemData,
  TrackerItemType,
  TrackerItemStatus,
  TrackerItemPriority,
  $getTrackerItemNode,
} from './TrackerItemNode';

interface TrackerItemComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
  data: TrackerItemData;
}

const statusOptions: { value: TrackerItemStatus; label: string; color: string; icon: string }[] = [
  { value: 'to-do', label: 'To Do', color: '#6b7280', icon: 'radio_button_unchecked' },
  { value: 'in-progress', label: 'In Progress', color: '#f59e0b', icon: 'sync' },
  { value: 'in-review', label: 'In Review', color: '#8b5cf6', icon: 'rate_review' },
  { value: 'done', label: 'Done', color: '#10b981', icon: 'check_circle' },
  { value: 'blocked', label: 'Blocked', color: '#ef4444', icon: 'block' },
];

const priorityOptions: { value: TrackerItemPriority; label: string; color: string; icon: string }[] = [
  { value: 'low', label: 'Low', color: '#10b981', icon: 'arrow_downward' },
  { value: 'medium', label: 'Medium', color: '#f59e0b', icon: 'drag_handle' },
  { value: 'high', label: 'High', color: '#ef4444', icon: 'arrow_upward' },
  { value: 'critical', label: 'Critical', color: '#dc2626', icon: 'error' },
];

const typeOptions: { value: TrackerItemType; label: string; icon: string }[] = [
  { value: 'task', label: 'Task', icon: 'check_box' },
  { value: 'bug', label: 'Bug', icon: 'bug_report' },
  { value: 'plan', label: 'Plan', icon: 'assignment' },
];

export default function TrackerItemComponent({ nodeKey, editor, data: initialData }: TrackerItemComponentProps): JSX.Element {
  // UI State
  const [showPopover, setShowPopover] = useState(false);

  // Data fields - initialize from props
  const [data, setData] = useState<TrackerItemData>(initialData);

  // Refs for click outside handling
  const containerRef = useRef<HTMLDivElement>(null);

  // Load data from node state
  useEffect(() => {
    const loadFromNodeState = () => {
      editor.getEditorState().read(() => {
        const node = $getTrackerItemNode(nodeKey);
        if (node) {
          const nodeData = node.getData();
          setData(nodeData);
        }
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

  // Update node state helper
  const updateNodeState = useCallback((updates: Partial<TrackerItemData>) => {
    const now = new Date().toISOString();

    editor.update(() => {
      const node = $getTrackerItemNode(nodeKey);
      if (node) {
        const currentData = node.getData();
        const nextData: TrackerItemData = {
          ...currentData,
          ...updates,
          updated: now,
        };
        node.setData(nextData);
        setData(nextData);
      }
    });
  }, [editor, nodeKey]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setShowPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Field edit handlers
  const handleFieldEdit = (field: keyof TrackerItemData, value: any) => {
    updateNodeState({ [field]: value });
  };

  const selectedStatus = statusOptions.find(opt => opt.value === data.status) || statusOptions[0];
  const selectedPriority = priorityOptions.find(opt => opt.value === data.priority) || priorityOptions[1];
  const selectedType = typeOptions.find(opt => opt.value === data.type) || typeOptions[0];

  return (
    <span className="tracker-item-wrapper" ref={containerRef}>
      <span
        className={`tracker-item-badge ${data.type} ${data.status === 'done' ? 'done' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setShowPopover(!showPopover);
        }}
        title={`${selectedType.label}: ${data.title || 'Untitled'} (${selectedStatus.label})`}
      >
        <span className="tracker-item-type-label">@{data.type}</span>
        {data.priority && (
          <span
            className={`tracker-item-icon priority-${data.priority}`}
            title={selectedPriority.label}
          >
            <span className="material-symbols-outlined">{selectedPriority.icon}</span>
          </span>
        )}
        <span
          className={`tracker-item-icon status-${data.status}`}
          title={selectedStatus.label}
        >
          <span className="material-symbols-outlined">{selectedStatus.icon}</span>
        </span>
      </span>

      {showPopover && (
        <div className="tracker-item-popover">
          <div className="tracker-item-popover-header">
            <span className="material-symbols-outlined">{selectedType.icon}</span>
            <span>{selectedType.label}</span>
          </div>

          <div className="tracker-item-popover-field">
            <label>Title</label>
            <input
              type="text"
              value={data.title}
              onChange={(e) => handleFieldEdit('title', e.target.value)}
              placeholder="Enter title"
            />
          </div>

          <div className="tracker-item-popover-field">
            <label>Status</label>
            <select
              value={data.status}
              onChange={(e) => handleFieldEdit('status', e.target.value)}
            >
              {statusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="tracker-item-popover-field">
            <label>Priority</label>
            <select
              value={data.priority || ''}
              onChange={(e) => handleFieldEdit('priority', e.target.value || undefined)}
            >
              <option value="">None</option>
              {priorityOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="tracker-item-popover-field">
            <label>Owner</label>
            <input
              type="text"
              value={data.owner || ''}
              onChange={(e) => handleFieldEdit('owner', e.target.value || undefined)}
              placeholder="Assign to..."
            />
          </div>

          <div className="tracker-item-popover-field">
            <label>Due Date</label>
            <input
              type="date"
              value={data.dueDate || ''}
              onChange={(e) => handleFieldEdit('dueDate', e.target.value || undefined)}
            />
          </div>

          <div className="tracker-item-popover-footer">
            <span className="tracker-item-id">ID: {data.id}</span>
          </div>
        </div>
      )}
    </span>
  );
}
