import React, { useState } from 'react';

export interface BoardConfig {
  entityTypeId?: string;
  entityTypeName?: string;
  statusPropertyId?: string;
  statusPropertyName?: string;
  title?: string;
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
  const [title, setTitle] = useState(initialConfig?.title || 'My Board');
  const [visibleFields, setVisibleFields] = useState({
    owner: initialConfig?.visibleFields?.owner ?? true,
    dueDate: initialConfig?.visibleFields?.dueDate ?? true,
    priority: initialConfig?.visibleFields?.priority ?? true,
    description: initialConfig?.visibleFields?.description ?? false,
  });

  if (!visible) return null;
  
  const handleSave = () => {
    const config: BoardConfig = {
      title,
      visibleFields,
      ...initialConfig
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
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '8px',
        minWidth: '400px',
        maxWidth: '500px'
      }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600' }}>Board Configuration</h3>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Board Title:
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            placeholder="Enter board title"
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '12px', fontWeight: '500' }}>
            Visible Card Fields:
          </label>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { key: 'owner', label: '👤 Owner', desc: 'Show card owner' },
              { key: 'dueDate', label: '📅 Due Date', desc: 'Show due dates' },
              { key: 'priority', label: '🔴 Priority', desc: 'Show priority indicators' },
              { key: 'description', label: '📝 Description', desc: 'Show description field' }
            ].map(({ key, label, desc }) => (
              <label key={key} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                padding: '8px',
                cursor: 'pointer',
                borderRadius: '4px',
                backgroundColor: visibleFields[key as keyof typeof visibleFields] ? '#f0f8ff' : 'transparent'
              }}>
                <input
                  type="checkbox"
                  checked={visibleFields[key as keyof typeof visibleFields]}
                  onChange={() => handleFieldToggle(key as keyof typeof visibleFields)}
                  style={{ margin: 0 }}
                />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '500' }}>{label}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div style={{ 
          marginTop: '24px', 
          display: 'flex', 
          gap: '12px', 
          justifyContent: 'flex-end',
          borderTop: '1px solid #eee',
          paddingTop: '16px'
        }}>
          <button 
            onClick={onHide}
            style={{
              padding: '8px 16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              backgroundColor: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            style={{
              padding: '8px 16px',
              border: '1px solid #4a90e2',
              borderRadius: '4px',
              backgroundColor: '#4a90e2',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}