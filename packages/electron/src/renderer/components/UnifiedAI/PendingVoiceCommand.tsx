/**
 * Pending Voice Command Component
 *
 * Displays a pending voice command with countdown timer before auto-submission.
 * User can cancel, edit, or send immediately.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import { pendingVoiceCommandAtom } from '../../store/atoms/voiceModeState';

// Global set of submitted command IDs to prevent duplicate submissions across component instances
const globalSubmittedCommands = new Set<string>();

interface PendingVoiceCommandProps {
  sessionId: string;
  onSubmit: (prompt: string, sessionId: string, workspacePath: string, codingAgentPrompt?: { prepend?: string; append?: string }) => void;
}

export function PendingVoiceCommand({ sessionId, onSubmit }: PendingVoiceCommandProps) {
  const [pendingCommand, setPendingCommand] = useAtom(pendingVoiceCommandAtom);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [editedPrompt, setEditedPrompt] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize edited prompt when pending command changes
  useEffect(() => {
    if (pendingCommand) {
      setEditedPrompt(pendingCommand.prompt);
      setRemainingMs(pendingCommand.delayMs);
      setIsEditing(false);
    }
  }, [pendingCommand?.id]);

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (!pendingCommand) return;

    // Use GLOBAL deduplication to prevent multiple component instances from submitting
    if (globalSubmittedCommands.has(pendingCommand.id)) {
      console.log('[PendingVoiceCommand] Command already submitted globally, skipping:', pendingCommand.id);
      setPendingCommand(null);
      return;
    }

    // Mark as submitted globally BEFORE the async operation
    globalSubmittedCommands.add(pendingCommand.id);
    // Clean up old entries after 10 seconds to prevent memory leak
    setTimeout(() => globalSubmittedCommands.delete(pendingCommand.id), 10000);

    console.log('[PendingVoiceCommand] Submitting command:', pendingCommand.id, pendingCommand.prompt.substring(0, 50));
    const promptToSubmit = editedPrompt || pendingCommand.prompt;
    onSubmit(
      promptToSubmit,
      pendingCommand.sessionId,
      pendingCommand.workspacePath,
      pendingCommand.codingAgentPrompt
    );
    setPendingCommand(null);
  }, [pendingCommand, editedPrompt, onSubmit, setPendingCommand]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setPendingCommand(null);
  }, [setPendingCommand]);

  // Countdown timer - only runs when pendingCommand is for this session
  useEffect(() => {
    if (!pendingCommand || pendingCommand.sessionId !== sessionId || isEditing) return;

    const submitAt = pendingCommand.createdAt + pendingCommand.delayMs;

    const interval = setInterval(() => {
      const remaining = submitAt - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        // handleSubmit checks global deduplication, so just call it
        handleSubmit();
      } else {
        setRemainingMs(remaining);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [pendingCommand?.id, pendingCommand?.sessionId, pendingCommand?.createdAt, pendingCommand?.delayMs, sessionId, isEditing, handleSubmit]);

  // Handle edit mode
  const handleEditClick = useCallback(() => {
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
  }, []);

  // Handle blur from textarea - resume countdown
  const handleTextareaBlur = useCallback(() => {
    if (pendingCommand && editedPrompt.trim()) {
      // Update the pending command with new timestamp to restart countdown
      setPendingCommand({
        ...pendingCommand,
        prompt: editedPrompt,
        createdAt: Date.now(),
      });
    }
    setIsEditing(false);
  }, [pendingCommand, editedPrompt, setPendingCommand]);

  // Handle keyboard shortcuts in textarea
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleSubmit, handleCancel]);

  // Only render if the pending command is for this session
  if (!pendingCommand || pendingCommand.sessionId !== sessionId) {
    return null;
  }

  // Calculate progress for circular indicator (0-1)
  const progress = Math.max(0, Math.min(1, remainingMs / pendingCommand.delayMs));
  const circumference = 2 * Math.PI * 12; // radius = 12
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div
      style={{
        background: 'var(--surface-tertiary)',
        border: '1px solid var(--accent-primary)',
        borderRadius: '8px',
        marginBottom: '8px',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(59, 130, 246, 0.15)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(59, 130, 246, 0.1)',
          borderBottom: '1px solid rgba(59, 130, 246, 0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--accent-primary)',
          }}
        >
          <MaterialSymbol icon="mic" size={18} />
          Voice Command
        </div>
        <button
          onClick={handleCancel}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            borderRadius: '4px',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
            e.currentTarget.style.color = 'var(--error-color)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          title="Cancel (Esc)"
        >
          <MaterialSymbol icon="close" size={18} />
        </button>
      </div>

      {/* Body - editable textarea */}
      <div style={{ padding: '12px' }}>
        <textarea
          ref={textareaRef}
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={handleTextareaBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '10px 12px',
            border: '1px solid var(--border-primary)',
            borderRadius: '6px',
            background: 'var(--surface-secondary)',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: '14px',
            lineHeight: '1.5',
            resize: 'none',
            transition: 'border-color 0.15s ease',
          }}
          placeholder="Voice command..."
        />
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderTop: '1px solid var(--border-primary)',
        }}
      >
        {/* Countdown section */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          {/* Circular countdown */}
          <div style={{ position: 'relative', width: '32px', height: '32px' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="16"
                cy="16"
                r="12"
                fill="none"
                stroke="var(--border-primary)"
                strokeWidth="3"
              />
              <circle
                cx="16"
                cy="16"
                r="12"
                fill="none"
                stroke={isEditing ? 'var(--text-tertiary)' : 'var(--accent-primary)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                style={{ transition: 'stroke-dashoffset 0.1s linear' }}
              />
            </svg>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
            {isEditing ? (
              'Paused - editing'
            ) : (
              <>Sending in <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{(remainingMs / 1000).toFixed(1)}s</span></>
            )}
          </span>
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <button
            onClick={handleEditClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              border: '1px solid var(--border-primary)',
              borderRadius: '6px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-secondary)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--border-primary)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <MaterialSymbol icon="edit" size={16} />
            Edit
          </button>
          <button
            onClick={handleSubmit}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              border: 'none',
              borderRadius: '6px',
              background: 'var(--accent-primary)',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent-primary-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent-primary)';
            }}
          >
            Send Now
            <MaterialSymbol icon="arrow_forward" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
