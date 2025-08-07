import React from 'react';
import './AboutBox.css';

interface AboutBoxProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutBox({ isOpen, onClose }: AboutBoxProps) {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="about-overlay" onClick={handleOverlayClick}>
      <div className="about-box">
        <button className="about-close" onClick={onClose}>×</button>

        <div className="about-header">
          <div className="about-icon">📝</div>
          <h1 className="about-title">Stravu Editor</h1>
          <p className="about-version">Version 0.33.1</p>
        </div>

        <div className="about-content">
          <p className="about-description">
            A powerful rich text editor built with Meta's Lexical framework.
            Features comprehensive editing capabilities including tables,
            collaboration, code highlighting, and extensible plugins.
          </p>

          <div className="about-features">
            <h3>Key Features</h3>
            <ul>
              <li>Rich text editing of Markdown</li>
              <li>Table support with advanced editing</li>
              <li>Code syntax highlighting</li>
              <li>Multiple themes including dark mode</li>
            </ul>
          </div>

          <div className="about-footer">
            <p>Built with ❤️ by Stravu</p>
            <p className="about-copyright">© 2025 Stravu Editor</p>
          </div>
        </div>
      </div>
    </div>
  );
}
