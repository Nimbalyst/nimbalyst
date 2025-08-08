import React, { useState, useRef, useEffect } from 'react';
import '../InputModal.css';

interface InputModalProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputModal({ 
  isOpen, 
  title, 
  placeholder, 
  defaultValue = '',
  onConfirm, 
  onCancel 
}: InputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="input-modal-overlay" onClick={onCancel}>
      <div className="input-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <h3 className="input-modal-title">{title}</h3>
          <input
            ref={inputRef}
            type="text"
            className="input-modal-input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-modal-buttons">
            <button 
              type="button" 
              className="input-modal-button input-modal-cancel"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="input-modal-button input-modal-confirm"
              disabled={!value.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}