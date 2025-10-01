import { useState, useEffect } from 'react';
import './BoardConfigDialog.css';

export interface BoardConfig {
  entityTypeId?: string;
  entityTypeName?: string;
  statusPropertyId?: string;
  statusPropertyName?: string;
  filter?: string;
  visibleFields?: {
    owner: boolean;
    dueDate: boolean;
    priority: boolean;
    description: boolean;
  };
}

interface BoardConfigDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelect: (config: BoardConfig) => void;
  initialConfig?: BoardConfig;
}

export function BoardConfigDialog({ visible, onHide, onSelect, initialConfig }: BoardConfigDialogProps) {
  const [visibleFields, setVisibleFields] = useState({
    owner: initialConfig?.visibleFields?.owner ?? true,
    dueDate: initialConfig?.visibleFields?.dueDate ?? true,
    priority: initialConfig?.visibleFields?.priority ?? true,
    description: initialConfig?.visibleFields?.description ?? false,
  });

  // Update state when dialog reopens with different initial config
  useEffect(() => {
    if (visible) {
      setVisibleFields({
        owner: initialConfig?.visibleFields?.owner ?? true,
        dueDate: initialConfig?.visibleFields?.dueDate ?? true,
        priority: initialConfig?.visibleFields?.priority ?? true,
        description: initialConfig?.visibleFields?.description ?? false,
      });
    }
  }, [visible, initialConfig]);

  if (!visible) return null;
  
  const handleSave = () => {
    const config: BoardConfig = {
      ...initialConfig,
      visibleFields
    };
    onSelect(config);
    onHide();
  };

  const handleFieldToggle = (field: keyof typeof visibleFields) => {
    setVisibleFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  return (
    <div className="board-config-overlay">
      <div className="board-config-dialog">
        <h3 className="board-config-title">Board Configuration</h3>
        
        <div className="board-config-section">
          <label className="board-config-label">
            Visible Card Fields:
          </label>
          
          <div className="board-config-fields">
            {[
              { key: 'owner', icon: 'person', label: 'Owner', desc: 'Show card owner' },
              { key: 'dueDate', icon: 'calendar_today', label: 'Due Date', desc: 'Show due dates' },
              { key: 'priority', icon: 'priority_high', label: 'Priority', desc: 'Show priority indicators' },
              { key: 'description', icon: 'description', label: 'Description', desc: 'Show description field' }
            ].map(({ key, icon, label, desc }) => (
              <label 
                key={key} 
                className={`board-config-field-option ${visibleFields[key as keyof typeof visibleFields] ? 'active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={visibleFields[key as keyof typeof visibleFields]}
                  onChange={() => handleFieldToggle(key as keyof typeof visibleFields)}
                  className="board-config-field-checkbox"
                />
                <div className="board-config-field-info">
                  <div className="board-config-field-label">
                    <span className="material-symbols-outlined">{icon}</span>
                    {label}
                  </div>
                  <div className="board-config-field-desc">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="board-config-actions">
          <button 
            onClick={onHide}
            className="board-config-button board-config-button-cancel"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="board-config-button board-config-button-save"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}