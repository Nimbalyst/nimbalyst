import React, { useEffect, useState, useCallback } from 'react';
import { errorNotificationService, type ErrorNotification } from '../../services/ErrorNotificationService';
import './ErrorToast.css';

export function ErrorToastContainer() {
  const [notifications, setNotifications] = useState<ErrorNotification[]>([]);

  useEffect(() => {
    const unsubscribe = errorNotificationService.addListener((notification) => {
      setNotifications(prev => [...prev, notification]);

      // Auto-dismiss if duration is set
      if (notification.duration && notification.duration > 0) {
        setTimeout(() => {
          handleDismiss(notification.id);
        }, notification.duration);
      }
    });

    return unsubscribe;
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    errorNotificationService.dismiss(id);
  }, []);

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

  if (notifications.length === 0) return null;

  return (
    <div className="error-toast-container">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`error-toast error-toast--${notification.severity}`}
          role="alert"
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
                onClick={() => handleDismiss(notification.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>

          <div className="error-toast-message">{notification.message}</div>

          {(notification.details || notification.stack || notification.context) && (
            <div className="error-toast-actions">
              <button
                className="error-toast-copy-btn"
                onClick={() => handleCopyDetails(notification)}
              >
                Copy Details
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
