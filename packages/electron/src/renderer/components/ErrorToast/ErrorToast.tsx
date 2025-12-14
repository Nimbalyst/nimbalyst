import React, { useEffect, useState, useCallback, useRef } from 'react';
import { errorNotificationService, type ErrorNotification } from '../../services/ErrorNotificationService';
import './ErrorToast.css';

export function ErrorToastContainer() {
  const [notifications, setNotifications] = useState<ErrorNotification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleDismiss = useCallback((id: string) => {
    // Clear any pending timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
    errorNotificationService.dismiss(id);
  }, []);

  const startDismissTimer = useCallback((notification: ErrorNotification) => {
    if (notification.duration && notification.duration > 0) {
      const timer = setTimeout(() => {
        handleDismiss(notification.id);
      }, notification.duration);
      timersRef.current.set(notification.id, timer);
    }
  }, [handleDismiss]);

  const pauseDismissTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const resumeDismissTimer = useCallback((notification: ErrorNotification) => {
    startDismissTimer(notification);
  }, [startDismissTimer]);

  useEffect(() => {
    const unsubscribe = errorNotificationService.addListener((notification) => {
      setNotifications(prev => [...prev, notification]);
      startDismissTimer(notification);
    });

    return () => {
      unsubscribe();
      // Clean up all timers on unmount
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, [startDismissTimer]);

  const handleCopyDetails = useCallback((notification: ErrorNotification) => {
    const details = `
# ${notification.title}

**Severity:** ${notification.severity}
**Time:** ${new Date(notification.timestamp).toLocaleString()}

## Message
${notification.message}

${notification.details ? `
## Details
${notification.details}
` : ''}

${notification.stack ? `
## Stack Trace
\`\`\`
${notification.stack}
\`\`\`
` : ''}

${notification.context ? `
## Context
\`\`\`json
${JSON.stringify(notification.context, null, 2)}
\`\`\`
` : ''}
`.trim();

    navigator.clipboard.writeText(details);
  }, []);

  const handleActionClick = useCallback((notification: ErrorNotification) => {
    if (notification.action) {
      notification.action.onClick();
      handleDismiss(notification.id);
    }
  }, [handleDismiss]);

  if (notifications.length === 0) return null;

  return (
    <div className="error-toast-container">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`error-toast error-toast--${notification.severity}`}
          role="alert"
          onMouseEnter={() => pauseDismissTimer(notification.id)}
          onMouseLeave={() => resumeDismissTimer(notification)}
        >
          <div className="error-toast-header">
            <div className="error-toast-icon">
              {notification.severity === 'error' && '🚨'}
              {notification.severity === 'warning' && '⚠️'}
              {notification.severity === 'info' && 'ℹ️'}
            </div>
            <div className="error-toast-title">{notification.title}</div>
            {notification.dismissible && (
              <button
                className="error-toast-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismiss(notification.id);
                }}
                aria-label="Dismiss"
                type="button"
              >
                ×
              </button>
            )}
          </div>

          <div className="error-toast-message">{notification.message}</div>

          {(notification.action || notification.details || notification.stack || notification.context) && (
            <div className="error-toast-actions">
              {notification.action && (
                <button
                  className="error-toast-action-btn"
                  onClick={() => handleActionClick(notification)}
                >
                  {notification.action.label}
                </button>
              )}
              {(notification.details || notification.stack || notification.context) && (
                <button
                  className="error-toast-copy-btn"
                  onClick={() => handleCopyDetails(notification)}
                >
                  Copy Details
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
