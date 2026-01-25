import React, { useState } from 'react';

export interface OnboardingDialogProps {
  isOpen: boolean;
  onComplete: (role: string | null, customRole: string | null, email: string | null) => void;
  onSkip: () => void;
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

export const OnboardingDialog: React.FC<OnboardingDialogProps> = ({ isOpen, onComplete, onSkip }) => {
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
    // Call onComplete with the collected data (all fields optional)
    onComplete(
      selectedRole || null,
      selectedRole === 'other' ? customRole.trim() || null : null,
      email.trim() || null
    );
  };

  // Only disable if email is entered but invalid
  const isSubmitDisabled = email.trim() !== '' && !isValidEmail(email.trim());

  return (
    <div className="onboarding-overlay fixed inset-0 flex items-center justify-center z-[10000] backdrop-blur-[4px] bg-black/60">
      <div className="onboarding-dialog flex flex-col w-[90%] max-w-[520px] max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="onboarding-header px-8 pt-8 pb-6 border-b border-[var(--nim-border)]">
          <h2 className="m-0 mb-2 text-2xl font-semibold text-[var(--nim-text)]">Welcome to Nimbalyst</h2>
          <p className="onboarding-subtitle m-0 text-[15px] text-[var(--nim-text-muted)]">
            Help us understand how you'll be using Nimbalyst
          </p>
        </div>

        <div className="onboarding-content flex-1 overflow-y-auto px-8 py-6">
          <div className="onboarding-section mb-7 last:mb-0">
            <label className="onboarding-label block mb-3 text-sm font-medium text-[var(--nim-text)]">
              What best describes your role?
            </label>
            <div className="role-options grid grid-cols-3 gap-3">
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`role-option group flex flex-col items-center p-0 rounded-xl border-2 cursor-pointer transition-all duration-150 relative overflow-hidden bg-[var(--nim-bg-secondary)] ${
                    selectedRole === option.value
                      ? 'selected border-[var(--nim-primary)] bg-[var(--nim-bg-hover)] shadow-[0_0_0_3px_rgba(88,166,255,0.15)]'
                      : 'border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={selectedRole === option.value}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="absolute top-3 right-3 m-0 cursor-pointer w-5 h-5 accent-[var(--nim-primary)]"
                  />
                  <div className="role-option-content flex flex-col items-center justify-center w-full gap-3 pt-7 px-4 pb-6">
                    <span className="material-symbols-outlined role-option-icon text-5xl text-[var(--nim-primary)] transition-transform duration-150 group-hover:scale-110">
                      {option.icon}
                    </span>
                    <span className="role-option-label text-[15px] font-semibold text-center text-[var(--nim-text)]">{option.label}</span>
                  </div>
                </label>
              ))}
            </div>

            {selectedRole === 'other' && (
              <div className="custom-role-input mt-3 animate-[slideDown_0.2s_ease]">
                <label className="onboarding-label block mb-3 text-sm font-medium text-[var(--nim-text)]" htmlFor="custom-role-input">
                  Your role
                </label>
                <input
                  id="custom-role-input"
                  type="text"
                  placeholder="e.g. Designer, Writer, Student"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className="onboarding-input w-full px-3.5 py-3 text-sm rounded-lg border-2 outline-none transition-all duration-150 box-border bg-[var(--nim-bg-secondary)] border-[var(--nim-border)] text-[var(--nim-text)] focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_3px_rgba(88,166,255,0.1)]"
                  autoFocus
                />
              </div>
            )}
          </div>

          <div className="onboarding-section mb-7 last:mb-0">
            <label className="onboarding-label block mb-3 text-sm font-medium text-[var(--nim-text)]" htmlFor="email-input">
              Email address
            </label>
            <p className="onboarding-help-text -mt-2 mb-3 text-[13px] text-[var(--nim-text-faint)]">
              Receive occasional product updates and tips
            </p>
            <input
              id="email-input"
              type="email"
              placeholder="your.email@example.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              className={`onboarding-input w-full px-3.5 py-3 text-sm rounded-lg border-2 outline-none transition-all duration-150 box-border bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] ${
                emailError
                  ? 'error border-[#e74c3c] focus:shadow-[0_0_0_3px_rgba(231,76,60,0.1)]'
                  : 'border-[var(--nim-border)] focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_3px_rgba(88,166,255,0.1)]'
              }`}
            />
            {emailError && <p className="error-text mt-2 m-0 text-[13px] text-[#e74c3c]">{emailError}</p>}
          </div>

          <div className="onboarding-disclaimer mt-4">
            <p className="disclaimer-text m-0 text-xs leading-normal text-[var(--nim-text-faint)]">
              We collect usage data to improve Nimbalyst. No prompts or content is ever collected. You can opt out of analytics any time in Settings.
            </p>
          </div>
        </div>

        <div className="onboarding-footer flex items-center justify-between px-8 py-5 border-t border-[var(--nim-border)]">
          <div className="onboarding-footer-left flex gap-2">
            <button
              className="onboarding-secondary-button px-5 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all duration-150 bg-transparent border border-[var(--nim-border)] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)] hover:border-[var(--nim-text-faint)]"
              onClick={onSkip}
            >
              Skip
            </button>
          </div>
          <button
            className="onboarding-submit px-8 py-3 text-[15px] font-semibold rounded-lg cursor-pointer transition-all duration-150 border-none text-white bg-[var(--nim-primary)] shadow-[0_2px_8px_rgba(88,166,255,0.2)] hover:enabled:bg-[#4d9eff] hover:enabled:shadow-[0_4px_12px_rgba(88,166,255,0.3)] hover:enabled:-translate-y-px active:enabled:translate-y-0 disabled:bg-[var(--nim-bg-tertiary)] disabled:text-[var(--nim-text-faint)] disabled:cursor-not-allowed disabled:shadow-none"
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
