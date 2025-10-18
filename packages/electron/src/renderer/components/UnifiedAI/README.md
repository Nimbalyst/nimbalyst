# Unified AI Interface Components

This directory contains the new unified AI interface components that merge the functionality of `AgenticCodingWindow` and `AIChat` into a cohesive, reusable architecture.

## Architecture Overview

The unified AI interface follows a three-layer architecture:

```
AgenticPanel (Container)
├── SessionHistory (optional, agent mode)
├── TabBar (multi-tab in agent mode, dropdown in chat mode)
└── AISessionView[] (one per session, hidden when not active)
    ├── FileGutter (referenced files)
    ├── AgentTranscriptPanel (message display)
    ├── AIInput (unified input)
    └── FileGutter (edited files, agent mode only)
```

## Components

### 1. AIInput

**File**: `AIInput.tsx`

Unified input component that merges features from `AgenticInput` and `ChatInput`.

**Features**:
- File mentions (`@`) with typeahead
- Slash commands (`/`) with typeahead (optional)
- Image/file attachments via drag & drop and paste (optional)
- History navigation with arrow keys (optional)
- Auto-resize textarea
- Send/Cancel buttons

**Usage**:

```tsx
import { AIInput } from './UnifiedAI/AIInput';

<AIInput
  value={inputValue}
  onChange={setInputValue}
  onSend={handleSend}
  onCancel={handleCancel}
  isLoading={isLoading}
  workspacePath={workspacePath}
  sessionId={sessionId}

  // Optional: File mentions
  fileMentionOptions={fileMentionOptions}
  onFileMentionSearch={handleFileMentionSearch}
  onFileMentionSelect={handleFileMentionSelect}

  // Optional: Attachments (agent mode)
  attachments={attachments}
  onAttachmentAdd={handleAttachmentAdd}
  onAttachmentRemove={handleAttachmentRemove}

  // Optional: Slash commands (agent mode)
  enableSlashCommands={true}

  // Optional: History navigation (chat mode)
  onNavigateHistory={handleNavigateHistory}
/>
```

### 2. AISessionView

**File**: `AISessionView.tsx`

Encapsulates all UI for a single AI session. This component remains mounted even when not visible, allowing background streaming to continue.

**Features**:
- FileGutter for referenced/edited files
- AgentTranscriptPanel for message display
- AIInput for user input
- Session-specific state management
- Background streaming support
- Mode-aware UI (chat vs agent)

**Usage**:

```tsx
import { AISessionView } from './UnifiedAI/AISessionView';

<AISessionView
  sessionId={session.id}
  sessionData={session.data}
  isActive={isCurrentSession}
  mode="agent" // or "chat"
  workspacePath={workspacePath}
  documentContext={documentContext}

  // Draft state
  draftInput={session.draftInput}
  draftAttachments={session.draftAttachments}
  onDraftInputChange={handleDraftInputChange}
  onDraftAttachmentsChange={handleDraftAttachmentsChange}

  // Message handling
  onSendMessage={handleSendMessage}
  onCancelRequest={handleCancelRequest}

  // File mentions
  fileMentionOptions={fileMentionOptions}
  onFileMentionSearch={handleFileMentionSearch}
  onFileMentionSelect={handleFileMentionSelect}

  // Click handlers
  onFileClick={handleFileClick}
  onTodoClick={handleTodoClick}

  // Streaming
  isLoading={isLoading}
  streamingContent={streamingContent}
/>
```

**Key Props**:
- `isActive`: Controls visibility (uses `display: none` when false, doesn't unmount)
- `mode`: `'chat'` for sidebar mode, `'agent'` for full window mode
- `draftInput/draftAttachments`: Session-specific draft state
- `streamingContent`: Real-time streaming updates

### 3. AgenticPanel

**File**: `AgenticPanel.tsx`

Top-level container that manages the entire AI interface, including sessions, tabs, and streaming state.

**Features**:
- Session management (create, load, delete, switch)
- Multi-tab support (agent mode)
- Session history panel (agent mode)
- Single session dropdown (chat mode)
- Stream coordination across sessions
- State persistence

**Usage**:

```tsx
import { AgenticPanel } from './UnifiedAI/AgenticPanel';

// Agent mode (full window with tabs)
<AgenticPanel
  mode="agent"
  workspacePath={workspacePath}
  initialSessionId={sessionId}
  planDocumentPath={planPath}
  onSessionChange={handleSessionChange}
/>

// Chat mode (sidebar with dropdown)
<AgenticPanel
  mode="chat"
  workspacePath={workspacePath}
  documentContext={documentContext}
  onSessionChange={handleSessionChange}
/>
```

**Key Props**:
- `mode`: `'chat'` for sidebar mode, `'agent'` for full window mode
- `workspacePath`: Required for session management
- `documentContext`: Optional document context (chat mode)
- `onSessionChange`: Callback when active session changes

## Migration Guide

### Migrating from AgenticCodingWindow

**Before**:
```tsx
<AgenticCodingWindow
  sessionId={sessionId}
  workspacePath={workspacePath}
  planDocumentPath={planPath}
/>
```

**After**:
```tsx
<AgenticPanel
  mode="agent"
  workspacePath={workspacePath}
  initialSessionId={sessionId}
  planDocumentPath={planPath}
  onSessionChange={handleSessionChange}
/>
```

### Migrating from AIChat

**Before**:
```tsx
<AIChat
  isCollapsed={isCollapsed}
  onToggleCollapse={onToggleCollapse}
  width={width}
  onWidthChange={onWidthChange}
  documentContext={documentContext}
  workspacePath={workspacePath}
/>
```

**After**:
```tsx
{!isCollapsed && (
  <div style={{ width }}>
    <AgenticPanel
      mode="chat"
      workspacePath={workspacePath}
      documentContext={documentContext}
      onSessionChange={handleSessionChange}
    />
  </div>
)}
```

## Key Benefits

### 1. Code Reuse
- Single input component (`AIInput`) replaces `AgenticInput` and `ChatInput`
- Shared session management logic
- Common streaming infrastructure

### 2. Background Processing
- Sessions remain mounted when not visible (using `display: none`)
- Multiple sessions can stream simultaneously
- Instant tab switching (no reload needed)

### 3. Flexibility
- Same components work in both chat and agent modes
- Easy to add new display modes
- Simple to test in isolation

### 4. State Management
- Session-specific state is encapsulated in `AISessionView`
- Global state managed by `AgenticPanel`
- Clean separation of concerns

## Testing

### Unit Tests
Test individual components in isolation:

```tsx
import { render, screen } from '@testing-library/react';
import { AIInput } from './UnifiedAI/AIInput';

test('AIInput renders with placeholder', () => {
  render(
    <AIInput
      value=""
      onChange={() => {}}
      onSend={() => {}}
      placeholder="Test placeholder"
    />
  );
  expect(screen.getByPlaceholderText('Test placeholder')).toBeInTheDocument();
});
```

### Integration Tests
Test session management and streaming:

```tsx
test('AISessionView continues streaming when hidden', async () => {
  const { rerender } = render(
    <AISessionView
      sessionId="test-1"
      sessionData={testSession}
      isActive={true}
      mode="agent"
      workspacePath="/test"
    />
  );

  // Hide the session
  rerender(
    <AISessionView
      sessionId="test-1"
      sessionData={testSession}
      isActive={false}
      mode="agent"
      workspacePath="/test"
    />
  );

  // Verify streaming continues (component still mounted)
  // ...
});
```

## Future Enhancements

### Phase 2: Window Mode System (Not Yet Implemented)
- Mode preservation when switching between views
- Tab-like left gutter behavior
- Persistent mode state

### Phase 3: Agent Mode Mounting (Not Yet Implemented)
- Main window agent mode (replace editor area)
- Cmd+Click for separate window
- Per-workspace mounting preferences

## File Structure

```
UnifiedAI/
├── README.md              # This file
├── AIInput.tsx            # Unified input component
├── AISessionView.tsx      # Session view component
└── AgenticPanel.tsx       # Top-level container component
```

## Related Files

- `AgenticCodingWindow.tsx` - Original agent mode component (to be deprecated)
- `AIChat/AIChat.tsx` - Original chat mode component (to be deprecated)
- `AgenticCoding/AgenticInput.tsx` - Original agent input (to be deprecated)
- `AIChat/ChatInput.tsx` - Original chat input (to be deprecated)

## API Reference

### AIInput Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `string` | ✅ | Input value |
| `onChange` | `(value: string) => void` | ✅ | Change handler |
| `onSend` | `(message?: string) => void` | ✅ | Send handler |
| `onCancel` | `() => void` | ❌ | Cancel handler |
| `isLoading` | `boolean` | ❌ | Loading state |
| `workspacePath` | `string` | ❌ | Workspace path |
| `sessionId` | `string` | ❌ | Session ID |
| `fileMentionOptions` | `TypeaheadOption[]` | ❌ | File mention options |
| `onFileMentionSearch` | `(query: string) => void` | ❌ | File mention search |
| `onFileMentionSelect` | `(option: TypeaheadOption) => void` | ❌ | File mention select |
| `attachments` | `ChatAttachment[]` | ❌ | Attachments |
| `onAttachmentAdd` | `(attachment: ChatAttachment) => void` | ❌ | Add attachment |
| `onAttachmentRemove` | `(id: string) => void` | ❌ | Remove attachment |
| `enableSlashCommands` | `boolean` | ❌ | Enable slash commands |
| `onNavigateHistory` | `(direction: 'up' \| 'down') => void` | ❌ | History navigation |

### AISessionView Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Session ID |
| `sessionData` | `SessionData` | ✅ | Session data |
| `isActive` | `boolean` | ✅ | Visibility state |
| `mode` | `'chat' \| 'agent'` | ✅ | Display mode |
| `workspacePath` | `string` | ✅ | Workspace path |
| `draftInput` | `string` | ❌ | Draft input |
| `draftAttachments` | `ChatAttachment[]` | ❌ | Draft attachments |
| `onDraftInputChange` | `(sessionId: string, value: string) => void` | ❌ | Draft input change |
| `onDraftAttachmentsChange` | `(sessionId: string, attachments: ChatAttachment[]) => void` | ❌ | Draft attachments change |
| `onSendMessage` | `(sessionId: string, message: string, attachments: ChatAttachment[]) => void` | ❌ | Send message |
| `onCancelRequest` | `(sessionId: string) => void` | ❌ | Cancel request |
| `streamingContent` | `string` | ❌ | Streaming content |

### AgenticPanel Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `mode` | `'chat' \| 'agent'` | ✅ | Display mode |
| `workspacePath` | `string` | ✅ | Workspace path |
| `documentContext` | `DocumentContext` | ❌ | Document context |
| `initialSessionId` | `string` | ❌ | Initial session ID |
| `planDocumentPath` | `string` | ❌ | Plan document path |
| `onSessionChange` | `(sessionId: string \| null) => void` | ❌ | Session change callback |

## Performance Considerations

1. **Multiple Sessions**: Components use `display: none` instead of unmounting, which keeps them in the DOM but hidden. This is efficient for <10 sessions but may need optimization for very large numbers.

2. **Streaming**: All sessions can stream simultaneously. Consider limiting concurrent streams if needed.

3. **State Updates**: Draft input and attachments update frequently. Consider debouncing if performance issues arise.

## Accessibility

- All interactive elements have proper ARIA labels
- Keyboard navigation is fully supported
- Focus management handles tab switching
- Screen reader announcements for streaming updates

## Browser Compatibility

- Requires modern JavaScript features (ES2020+)
- Tested on Electron (Chromium-based)
- Uses CSS Grid and Flexbox for layout
