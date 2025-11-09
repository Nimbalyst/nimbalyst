import React, { useState, useEffect, useCallback } from 'react';
import './LoginRequiredWidget.css';

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

  const isLoggedIn = loginStatus?.success && loginStatus?.accountInfo;

  return (
    <div className={`login-required-widget ${isLoggedIn ? 'logged-in' : ''}`}>
      <div className="login-required-message">
        {isLoggedIn ? (
          <>
            <span className="login-status-icon success">✓</span>
            You are logged in and can continue your conversation
          </>
        ) : (
          'An Anthropic account is required to use Claude Code. Please login or create an account.'
        )}
      </div>

      {loginStatus && loginStatus.accountInfo && (
        <div className="login-account-info">
          {loginStatus.accountInfo.email && (
            <div>Account: {loginStatus.accountInfo.email}</div>
          )}
          {loginStatus.accountInfo.organization && (
            <div>Organization: {loginStatus.accountInfo.organization}</div>
          )}
        </div>
      )}

      {loginStatus && !loginStatus.success && (
        <div className="login-status-message error">
          <div className="login-status-header">
            <span className="login-status-icon">⚠</span>
            <span>{loginStatus.message}</span>
          </div>
        </div>
      )}

      {!isLoggedIn && (
        <div className="login-actions">
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="login-button"
          >
            {isLoggingIn ? 'Opening Login...' : 'Login'}
          </button>

          <button
            onClick={handleRefreshStatus}
            disabled={isChecking}
            className="status-button"
          >
            {isChecking ? 'Checking...' : 'Check Status'}
          </button>
        </div>
      )}
    </div>
  );
};
