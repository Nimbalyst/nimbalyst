import React, { useState, useEffect, useCallback } from 'react';

export const LoginRequiredWidget: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [loginStatus, setLoginStatus] = useState<{
    message: string;
    success: boolean;
    accountInfo?: {
      email?: string;
      organization?: string;
      subscriptionType?: string;
    };
  } | null>(null);

  const handleRefreshStatus = useCallback(async () => {
    setIsChecking(true);
    setLoginStatus(null);

    try {
      if (!window.electronAPI?.invoke) {
        setLoginStatus({
          message: 'Cannot access Electron API. Please restart the application.',
          success: false
        });
        setIsChecking(false);
        return;
      }

      const status = await window.electronAPI.invoke('claude-code:check-login');

      if (status.isLoggedIn) {
        setLoginStatus({
          message: 'Login successful! You can now use Claude Code.',
          success: true,
          accountInfo: {
            email: status.email,
            organization: status.organization,
            subscriptionType: status.subscriptionType
          }
        });
      } else {
        setLoginStatus({
          message: status.error || 'Not logged in. Please complete the authentication flow.',
          success: false
        });
      }
    } catch (error: any) {
      setLoginStatus({
        message: `Failed to check status: ${error.message || 'Unknown error'}`,
        success: false
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check login status when component mounts
  useEffect(() => {
    handleRefreshStatus();
  }, [handleRefreshStatus]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginStatus(null);

    try {
      // Check if we have the electronAPI available
      if (!window.electronAPI?.invoke) {
        setLoginStatus({
          message: 'Cannot access Electron API. Please restart the application.',
          success: false
        });
        setIsLoggingIn(false);
        return;
      }

      const result = await window.electronAPI.invoke('claude-code:login');

      if (result.success) {
        setLoginStatus({
          message: 'Login initiated! Complete authentication in the Terminal window, then click "Check Status".',
          success: true
        });
      } else {
        setLoginStatus({
          message: result.error || 'Login failed. Please try again.',
          success: false
        });
      }
    } catch (error: any) {
      setLoginStatus({
        message: `Login failed: ${error.message || 'Unknown error'}`,
        success: false
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div style={{
      margin: '1rem 0',
      padding: '1rem',
      backgroundColor: 'rgba(239, 68, 68, 0.08)',
      border: '1px solid rgba(239, 68, 68, 0.25)',
      borderRadius: '0.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem'
    }}>
      {/* Message */}
      <div style={{
        color: 'var(--text-primary)',
        fontSize: '0.9rem',
        lineHeight: '1.5'
      }}>
        An Anthropic account is required to use Claude Code. Please login or create an account.
      </div>

      {/* Status Message */}
      {loginStatus && (
        <div style={{
          fontSize: '0.85rem',
          padding: '0.75rem',
          borderRadius: '0.375rem',
          backgroundColor: loginStatus.success
            ? 'rgba(16, 185, 129, 0.1)'
            : 'rgba(239, 68, 68, 0.1)',
          color: loginStatus.success
            ? 'var(--success-color, #10b981)'
            : 'var(--error-color)',
          border: `1px solid ${loginStatus.success
            ? 'rgba(16, 185, 129, 0.25)'
            : 'rgba(239, 68, 68, 0.25)'}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          lineHeight: '1.5'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem' }}>
              {loginStatus.success ? '✓' : '⚠'}
            </span>
            <span>{loginStatus.message}</span>
          </div>
          {loginStatus.success && loginStatus.accountInfo && (
            <div style={{
              fontSize: '0.8rem',
              paddingLeft: '1.5rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem'
            }}>
              {loginStatus.accountInfo.email && (
                <div>Account: {loginStatus.accountInfo.email}</div>
              )}
              {loginStatus.accountInfo.organization && (
                <div>Organization: {loginStatus.accountInfo.organization}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center'
      }}>
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          style={{
            flex: 1,
            padding: '0.75rem 1.25rem',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            border: 'none',
            background: isLoggingIn
              ? 'var(--text-tertiary)'
              : 'var(--primary-color, #2563eb)',
            color: 'white',
            opacity: isLoggingIn ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!isLoggingIn) {
              e.currentTarget.style.opacity = '0.9';
            }
          }}
          onMouseLeave={(e) => {
            if (!isLoggingIn) {
              e.currentTarget.style.opacity = '1';
            }
          }}
        >
          {isLoggingIn ? 'Opening Login...' : 'Login with Claude Subscription'}
        </button>

        <button
          onClick={handleRefreshStatus}
          disabled={isChecking}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: isChecking ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            border: '1px solid var(--border-primary)',
            background: isChecking ? 'var(--surface-tertiary)' : 'var(--surface-secondary)',
            color: 'var(--text-primary)',
            opacity: isChecking ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!isChecking) {
              e.currentTarget.style.background = 'var(--surface-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isChecking) {
              e.currentTarget.style.background = 'var(--surface-secondary)';
            }
          }}
        >
          {isChecking ? 'Checking...' : 'Check Status'}
        </button>
      </div>
    </div>
  );
};
