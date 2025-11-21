import React, {useEffect} from "react";
import {usePostHog} from "posthog-js/react";

const ROLE_OPTIONS = [
  { value: 'developer', label: 'Developer' },
  { value: 'product_manager', label: 'Product Manager' },
  { value: 'other', label: 'Other' },
];

export function AnalyticsSettingsPanel() {
  const [loading, setLoading] = React.useState<boolean>(true);
  const [analyticsEnabled, setAnalyticsEnabled] = React.useState<boolean>(false);
  const [analyticsId, setAnalyticsId] = React.useState<string>('');
  const [userRole, setUserRole] = React.useState<string>('');
  const [customRole, setCustomRole] = React.useState<string>('');
  const [userEmail, setUserEmail] = React.useState<string>('');
  const [isEditingRole, setIsEditingRole] = React.useState<boolean>(false);
  const [isEditingEmail, setIsEditingEmail] = React.useState<boolean>(false);
  const [tempRole, setTempRole] = React.useState<string>('');
  const [tempCustomRole, setTempCustomRole] = React.useState<string>('');
  const [tempEmail, setTempEmail] = React.useState<string>('');
  const [emailError, setEmailError] = React.useState<string>('');
  const posthog = usePostHog();

  useEffect(() => {
    (async () => {
      setAnalyticsId(await window.electronAPI.analytics?.getDistinctId() ?? '');
      setAnalyticsEnabled(await window.electronAPI.analytics?.allowedToSendAnalytics() ?? false)

      // Load user role and email from localStorage
      const storedRole = localStorage.getItem('user_role') || '';
      const storedEmail = localStorage.getItem('user_email') || '';

      // Determine if the role is a custom role
      const isCustom = storedRole && !['developer', 'product_manager'].includes(storedRole);
      if (isCustom) {
        setUserRole('other');
        setCustomRole(storedRole);
      } else {
        setUserRole(storedRole);
        setCustomRole('');
      }

      setUserEmail(storedEmail);
      setLoading(false);
    })();
  }, []);

  const toggleAnalytics = async (enabled: boolean) => {
    if (enabled) {
      await window.electronAPI.analytics?.optIn();
      posthog?.opt_in_capturing();
    } else {
      await window.electronAPI.analytics?.optOut();
      posthog?.opt_out_capturing();
    }
    setAnalyticsEnabled(enabled);
  }

  const validateEmail = (email: string): boolean => {
    if (!email) return true; // Empty is valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEditRole = () => {
    setTempRole(userRole);
    setTempCustomRole(customRole);
    setIsEditingRole(true);
  };

  const handleSaveRole = () => {
    // Validate
    if (!tempRole || (tempRole === 'other' && !tempCustomRole.trim())) {
      return;
    }

    // Update state
    setUserRole(tempRole);
    if (tempRole === 'other') {
      setCustomRole(tempCustomRole);
      localStorage.setItem('user_role', tempCustomRole.trim());
    } else {
      setCustomRole('');
      localStorage.setItem('user_role', tempRole);
    }

    // Track change
    if (posthog) {
      posthog.capture('user_role_updated', {
        user_role: tempRole,
        custom_role_provided: tempRole === 'other',
      });
    }

    setIsEditingRole(false);
  };

  const handleCancelRole = () => {
    setIsEditingRole(false);
    setTempRole('');
    setTempCustomRole('');
  };

  const handleEditEmail = () => {
    setTempEmail(userEmail);
    setIsEditingEmail(true);
    setEmailError('');
  };

  const handleSaveEmail = () => {
    // Validate email
    if (tempEmail && !validateEmail(tempEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    // Update state
    setUserEmail(tempEmail);
    if (tempEmail) {
      localStorage.setItem('user_email', tempEmail);
      // Associate with PostHog
      if (posthog) {
        posthog.people.set({ email: tempEmail });
      }
    } else {
      localStorage.removeItem('user_email');
      // Unset in PostHog
      if (posthog) {
        posthog.people.set({ email: null });
      }
    }

    // Track change
    if (posthog) {
      posthog.capture('user_email_updated', {
        email_provided: !!tempEmail,
      });
    }

    setIsEditingEmail(false);
    setEmailError('');
  };

  const handleCancelEmail = () => {
    setIsEditingEmail(false);
    setTempEmail('');
    setEmailError('');
  };

  if (loading) {
    return <></>
  }

  const displayRole = customRole || ROLE_OPTIONS.find(opt => opt.value === userRole)?.label || 'Not set';

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Analytics</h3>
        <p className="provider-panel-description">
          Opt in to allow us to collect anonymous usage data to help improve the product.
          You can opt out again at any time.
        </p>
      </div>

      <div className="provider-enable">
        <span className="provider-enable-label">Send anonymous usage data</span>
        <label className="provider-toggle">
          <input
            type="checkbox"
            checked={analyticsEnabled}
            onChange={(e) => toggleAnalytics(e.target.checked)}
          />
          <span className="provider-toggle-slider"></span>
        </label>
      </div>

      <div className="provider-panel-header" style={{ marginTop: '24px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Your Role</h4>
        {!isEditingRole ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{displayRole}</p>
            <button
              onClick={handleEditRole}
              style={{
                padding: '4px 12px',
                fontSize: '13px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {ROLE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: tempRole === option.value ? 'var(--surface-hover)' : 'var(--surface-secondary)',
                    border: `2px solid ${tempRole === option.value ? 'var(--primary-color)' : 'var(--border-primary)'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="tempRole"
                    value={option.value}
                    checked={tempRole === option.value}
                    onChange={(e) => setTempRole(e.target.value)}
                    style={{ marginRight: '10px' }}
                  />
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{option.label}</span>
                </label>
              ))}
            </div>
            {tempRole === 'other' && (
              <input
                type="text"
                placeholder="Please specify your role"
                value={tempCustomRole}
                onChange={(e) => setTempCustomRole(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  marginBottom: '12px',
                  background: 'var(--surface-secondary)',
                  border: '2px solid var(--border-primary)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box',
                }}
              />
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSaveRole}
                disabled={!tempRole || (tempRole === 'other' && !tempCustomRole.trim())}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'var(--primary-color)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  opacity: (!tempRole || (tempRole === 'other' && !tempCustomRole.trim())) ? 0.5 : 1,
                }}
              >
                Save
              </button>
              <button
                onClick={handleCancelRole}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="provider-panel-header" style={{ marginTop: '24px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Email</h4>
        {!isEditingEmail ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {userEmail || 'Not set'}
            </p>
            <button
              onClick={handleEditEmail}
              style={{
                padding: '4px 12px',
                fontSize: '13px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <input
              type="email"
              placeholder="your.email@example.com"
              value={tempEmail}
              onChange={(e) => {
                setTempEmail(e.target.value);
                if (e.target.value && !validateEmail(e.target.value)) {
                  setEmailError('Please enter a valid email address');
                } else {
                  setEmailError('');
                }
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                marginBottom: emailError ? '4px' : '12px',
                background: 'var(--surface-secondary)',
                border: `2px solid ${emailError ? '#e74c3c' : 'var(--border-primary)'}`,
                borderRadius: '6px',
                color: 'var(--text-primary)',
                boxSizing: 'border-box',
              }}
            />
            {emailError && (
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#e74c3c' }}>
                {emailError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSaveEmail}
                disabled={!!emailError}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'var(--primary-color)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  opacity: emailError ? 0.5 : 1,
                }}
              >
                Save
              </button>
              <button
                onClick={handleCancelEmail}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="provider-panel-header" style={{ marginTop: '24px' }}>
        <p className="provider-panel-description">
          Your analytics ID: <code>{analyticsId}</code>
        </p>
      </div>
    </div>
  );
}
