import React, { useState } from 'react';
import './OnboardingDialog.css';

export interface OnboardingDialogProps {
  isOpen: boolean;
  onComplete: (role: string, customRole: string | null, email: string | null) => void;
}

const ROLE_OPTIONS = [
  { value: 'developer', label: 'Developer', icon: 'terminal' },
  { value: 'product_manager', label: 'Product Manager', icon: 'lightbulb' },
  { value: 'other', label: 'Other', icon: 'interests' },
];

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const OnboardingDialog: React.FC<OnboardingDialogProps> = ({ isOpen, onComplete }) => {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [customRole, setCustomRole] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');

  if (!isOpen) return null;

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (value && !isValidEmail(value)) {
      setEmailError('Please enter a valid email address');
    } else {
      setEmailError('');
    }
  };

  const handleSubmit = () => {
    // Validate required fields
    if (!selectedRole) {
      return;
    }

    // Validate custom role if "other" is selected
    if (selectedRole === 'other' && !customRole.trim()) {
      return;
    }

    // Call onComplete with the collected data
    onComplete(
      selectedRole,
      selectedRole === 'other' ? customRole.trim() : null,
      email.trim() || null
    );
  };

  const isSubmitDisabled =
    !selectedRole ||
    (selectedRole === 'other' && !customRole.trim()) ||
    !email.trim() ||
    !isValidEmail(email.trim());

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-dialog">
        <div className="onboarding-header">
          <h2>Welcome to Nimbalyst</h2>
          <p className="onboarding-subtitle">
            Help us understand how you'll be using Nimbalyst
          </p>
        </div>

        <div className="onboarding-content">
          <div className="onboarding-section">
            <label className="onboarding-label">
              What best describes your role? <span className="required">*</span>
            </label>
            <div className="role-options">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`role-option ${selectedRole === option.value ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={selectedRole === option.value}
                    onChange={(e) => setSelectedRole(e.target.value)}
                  />
                  <div className="role-option-content">
                    <span className="material-symbols-outlined role-option-icon">
                      {option.icon}
                    </span>
                    <span className="role-option-label">{option.label}</span>
                  </div>
                </label>
              ))}
            </div>

            {selectedRole === 'other' && (
              <div className="custom-role-input">
                <input
                  type="text"
                  placeholder="Please specify your role"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className="onboarding-input"
                  autoFocus
                />
              </div>
            )}
          </div>

          <div className="onboarding-section">
            <label className="onboarding-label" htmlFor="email-input">
              Email address <span className="required">*</span>
            </label>
            <p className="onboarding-help-text">
              Receive occasional product updates and tips
            </p>
            <input
              id="email-input"
              type="email"
              placeholder="your.email@example.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              className={`onboarding-input ${emailError ? 'error' : ''}`}
            />
            {emailError && <p className="error-text">{emailError}</p>}
          </div>

          <div className="onboarding-disclaimer">
            <p className="disclaimer-text">
              We collect usage data to improve Nimbalyst. No prompts or content is ever collected. You can opt out of analytics any time in Settings.
            </p>
          </div>
        </div>

        <div className="onboarding-footer">
          <button
            className="onboarding-submit"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};
