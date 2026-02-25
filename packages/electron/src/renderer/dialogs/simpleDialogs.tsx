/**
 * Simple Dialogs Registration
 *
 * These are dialogs with simple boolean open/close state and minimal callbacks.
 * They belong to various groups (help, settings, promotion, feedback).
 */

import React from 'react';
import { registerDialog } from '../contexts/DialogContext';
import type { DialogConfig } from '../contexts/DialogContext.types';
import { KeyboardShortcutsDialog } from '../components/KeyboardShortcutsDialog/KeyboardShortcutsDialog';
import { DiscordInvitation } from '../components/DiscordInvitation/DiscordInvitation';
import { PostHogSurvey } from '../components/PostHogSurvey/PostHogSurvey';
import { ApiKeyDialog } from '../components/ApiKeyDialog';
import { ShareDialog } from '../components/ShareDialog/ShareDialog';
import { DIALOG_IDS } from './registry';

// Type definitions for dialog data

export interface KeyboardShortcutsData {
  // No additional data needed
}

export interface DiscordInvitationData {
  onDismiss: () => void;
}

export interface PostHogSurveyData {
  // No additional data needed - onClose is handled by the wrapper
}

export interface ApiKeyDialogData {
  onOpenPreferences: () => void;
}

export interface ShareDialogData {
  contentType: 'session' | 'file';
  sessionId?: string;
  filePath?: string;
  title?: string;
}

// Wrapper components that bridge DialogComponentProps to the original component props

function KeyboardShortcutsWrapper({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: KeyboardShortcutsData;
}) {
  return <KeyboardShortcutsDialog isOpen={isOpen} onClose={onClose} />;
}

function DiscordInvitationWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: DiscordInvitationData;
}) {
  return (
    <DiscordInvitation
      isOpen={isOpen}
      onClose={onClose}
      onDismiss={() => {
        data.onDismiss();
        onClose();
      }}
    />
  );
}

function PostHogSurveyWrapper({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: PostHogSurveyData;
}) {
  // PostHogSurvey doesn't have an isOpen prop - it's always rendered when mounted
  // We'll conditionally render it based on isOpen
  if (!isOpen) return null;
  return <PostHogSurvey onClose={onClose} />;
}

function ApiKeyDialogWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ApiKeyDialogData;
}) {
  return (
    <ApiKeyDialog
      isOpen={isOpen}
      onClose={onClose}
      onOpenPreferences={() => {
        data.onOpenPreferences();
        onClose();
      }}
    />
  );
}

function ShareDialogWrapper({
  isOpen,
  onClose,
  data,
}: {
  isOpen: boolean;
  onClose: () => void;
  data: ShareDialogData;
}) {
  return (
    <ShareDialog
      isOpen={isOpen}
      onClose={onClose}
      contentType={data.contentType}
      sessionId={data.sessionId}
      filePath={data.filePath}
      title={data.title}
    />
  );
}

// Register all simple dialogs
export function registerSimpleDialogs() {
  registerDialog<KeyboardShortcutsData>({
    id: DIALOG_IDS.KEYBOARD_SHORTCUTS,
    group: 'help',
    component:
      KeyboardShortcutsWrapper as DialogConfig<KeyboardShortcutsData>['component'],
    priority: 200, // Help dialogs can appear over navigation
  });

  registerDialog<DiscordInvitationData>({
    id: DIALOG_IDS.DISCORD_INVITATION,
    group: 'promotion',
    component:
      DiscordInvitationWrapper as DialogConfig<DiscordInvitationData>['component'],
    priority: 150,
  });

  registerDialog<PostHogSurveyData>({
    id: DIALOG_IDS.POSTHOG_SURVEY,
    group: 'feedback',
    component:
      PostHogSurveyWrapper as DialogConfig<PostHogSurveyData>['component'],
    priority: 150,
  });

  registerDialog<ApiKeyDialogData>({
    id: DIALOG_IDS.API_KEY,
    group: 'settings',
    component: ApiKeyDialogWrapper as DialogConfig<ApiKeyDialogData>['component'],
    priority: 200,
  });

  registerDialog<ShareDialogData>({
    id: DIALOG_IDS.SHARE,
    group: 'system',
    component: ShareDialogWrapper as DialogConfig<ShareDialogData>['component'],
    priority: 250,
  });
}
