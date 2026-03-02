import React, { useEffect, useState, useRef } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import type { SettingsCategory } from '../Settings/SettingsSidebar';
import type { SettingsScope } from '../Settings/SettingsView';

interface StytchAuthState {
  isAuthenticated: boolean;
  user: {
    user_id: string;
    emails: Array<{ email: string }>;
    name?: { first_name?: string; last_name?: string };
  } | null;
}

interface UserMenuPopoverProps {
  onNavigateSettings: (scope: SettingsScope, category?: SettingsCategory) => void;
  onClose: () => void;
  /** Whether the user has a team or mobile sync configured for this workspace */
  isProjectConnected?: boolean;
}

export function UserMenuPopover({ onNavigateSettings, onClose, isProjectConnected = false }: UserMenuPopoverProps) {
  const [authState, setAuthState] = useState<StytchAuthState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Load auth state on mount
  useEffect(() => {
    async function loadAuth() {
      if (!window.electronAPI?.stytch) return;
      try {
        const state = await window.electronAPI.stytch.getAuthState();
        setAuthState({
          isAuthenticated: state.isAuthenticated,
          user: state.user,
        });
      } catch (err) {
        console.warn('[UserMenuPopover] Failed to load auth state:', err);
      }
    }
    loadAuth();

    // Subscribe to auth state changes
    const unsubscribe = window.electronAPI?.stytch?.onAuthStateChange?.((state: any) => {
      setAuthState({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      });
    });

    return () => { unsubscribe?.(); };
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay attaching to avoid closing immediately from the button click that opened us
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const email = authState?.user?.emails?.[0]?.email;
  const isSignedIn = authState?.isAuthenticated ?? false;

  const menuItems = [
    {
      label: 'User Settings',
      icon: 'person' as const,
      onClick: () => {
        onNavigateSettings('user');
        onClose();
      },
    },
    {
      label: 'Project Settings',
      icon: 'folder' as const,
      onClick: () => {
        onNavigateSettings('project');
        onClose();
      },
    },
    // Only show Team Settings when the user is connected to a team/sync
    ...(isProjectConnected ? [{
      label: 'Team Settings',
      icon: 'group' as const,
      onClick: () => {
        onNavigateSettings('project', 'team');
        onClose();
      },
    }] : []),
  ];

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-0 left-full ml-2 w-56 bg-nim-secondary border border-nim rounded-lg shadow-lg z-50 overflow-hidden"
      data-testid="user-menu-popover"
    >
      {/* Navigation links */}
      <div className="py-1">
        {menuItems.map((item) => (
          <button
            key={item.label}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-nim hover:bg-nim-tertiary cursor-pointer border-none bg-transparent text-left transition-colors duration-100"
            onClick={item.onClick}
            data-testid={`user-menu-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <MaterialSymbol icon={item.icon} size={18} className="text-nim-muted shrink-0" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Identity row - only shown when connected to team/sync */}
      {isProjectConnected && (
        <>
          <div className="border-t border-nim" />
          <button
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-nim-tertiary cursor-pointer border-none bg-transparent text-left transition-colors duration-100"
            onClick={() => {
              onNavigateSettings('user', 'sync');
              onClose();
            }}
            data-testid="user-menu-identity"
          >
            <div className="w-7 h-7 rounded-full bg-nim-primary flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-white leading-none">
                {email ? email[0].toUpperCase() : '?'}
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-nim truncate">
                {email ?? 'No account'}
              </span>
              <span className="text-xs text-nim-muted">
                {isSignedIn ? 'Signed in' : 'Not signed in'}
              </span>
            </div>
          </button>
        </>
      )}
    </div>
  );
}
