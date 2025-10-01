import { useState, useEffect } from 'react';
import { CardData } from './BoardCardNode';
import './CardEditDialog.css';

interface CardEditDialogProps {
  visible: boolean;
  onHide: () => void;
  onSave: (data: CardData) => void;
  initialData: CardData;
}

export function CardEditDialog({ visible, onHide, onSave, initialData }: CardEditDialogProps) {
  const [title, setTitle] = useState(initialData.title || '');
  const [owner, setOwner] = useState(initialData.owner || '');
  const [dueDate, setDueDate] = useState(initialData.dueDate || '');
  const [priority, setPriority] = useState(initialData.priority || 'medium');
  const [description, setDescription] = useState(initialData.description || '');

  // Update form when initialData changes
  useEffect(() => {
    if (visible) {
      setTitle(initialData.title || '');
      setOwner(initialData.owner || '');
      setDueDate(initialData.dueDate || '');
      setPriority(initialData.priority || 'medium');
      setDescription(initialData.description || '');
    }
  }, [visible, initialData]);

  // Handle escape key to close dialog
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onHide();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onHide]);

  if (!visible) return null;

  const handleSave = () => {
    const data: CardData = {
      title: title || 'Untitled',
      owner: owner || undefined,
      dueDate: dueDate || undefined,
      priority: priority as 'low' | 'medium' | 'high',
      description: description || undefined,
    };
    onSave(data);
    onHide();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleSave();
    }
  };

  return (
    <div className="card-edit-overlay" onClick={handleOverlayClick}>
      <div className="card-edit-dialog">
        <h3 className="card-edit-title">Edit Card</h3>

        <div className="card-edit-field">
          <label className="card-edit-label">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="card-edit-input"
            placeholder="Card title"
          />
        </div>

        <div className="card-edit-field">
          <label className="card-edit-label">
            Owner
          </label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="card-edit-input"
            placeholder="Assigned to"
          />
        </div>

        <div className="card-edit-field">
          <label className="card-edit-label">
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="card-edit-input"
          />
        </div>

        <div className="card-edit-field">
          <label className="card-edit-label">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
            className="card-edit-select"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="card-edit-field">
          <label className="card-edit-label">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="card-edit-textarea"
            placeholder="Add a description..."
          />
        </div>

        <div className="card-edit-actions">
          <button
            onClick={handleSave}
            className="card-edit-button card-edit-button-save"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}