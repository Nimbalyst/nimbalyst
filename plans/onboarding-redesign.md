---
planStatus:
  planId: plan-onboarding-redesign
  title: Onboarding Redesign - Settings Screen Approach
  status: draft
  planType: refactor
  priority: high
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - onboarding
    - settings
    - configuration
    - ux
  created: "2025-10-16"
  updated: "2025-10-16T00:00:00.000Z"
  progress: 0
  startDate: "2025-10-16"
---
# Onboarding Redesign - Settings Screen Approach
<!-- plan-status -->

## Problem with Current Approach

The current modal-based onboarding has several issues:
1. Too many steps (6 steps is overwhelming)
2. Modal UI feels disconnected from the main application
3. Configuration is one-time only, hard to revisit
4. Users can't easily reconfigure after initial setup
5. Modal blocks the entire application

## New Approach: Settings Screen

Instead of a modal wizard, use a dedicated settings screen that:
- Appears in the main window content area
- Can be accessed anytime via gear icon
- Shows all configuration options at once (no wizard)
- Provides immediate feedback and previews
- Feels integrated with the application

## Settings Screen Structure

### Layout
```javascript
┌─────────────────────────────────────────────────────────┐
│ Settings                                          [×]    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Plans Directory                                         │
│  [nimbalyst-local____]                                   │
│  Plans will be stored in this folder (added to          │
│  .gitignore). You can move plans later if you want to   │
│  check them into version control.                       │
│                                                          │
│  Claude Code Integration                                 │
│  ☐ Enable Claude Code integration                       │
│      ☐ Install /plan command                            │
│      ☐ Install /track command                           │
│      ☐ Configure CLAUDE.md                              │
│                                                          │
│  [Get Started]  [Save Changes]                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Simplified Flow

**First-time project open:**
1. Settings screen appears automatically
2. All options visible at once (no steps)
3. User can configure what they want, skip what they don't
4. Click "Get Started" to save and continue
5. Settings screen closes, main editor appears

**Returning users:**
- Access settings via gear icon anytime
- Make changes and save
- Changes apply immediately

## Configuration Options

### 1. Plans Directory (simple input)
- Text input prefilled with "nimbalyst-local"
- Plans will be stored in `[directory]/plans`
- Directory automatically added to .gitignore
- User can change if they want, but default is good for most cases
- Note: Users can always move plans later if they decide to check them in

### 2. Claude Code Integration (optional)
Single checkbox to enable, with sub-options:
- Install /plan command
- Install /track command
- Configure CLAUDE.md

All sub-options checked by default when parent is enabled.

### 3. Quick Start
- "Create Example Plan" button
- Opens example plan immediately after settings

## AI Model Configuration

### Per-Project vs Global

**Recommendation: Both**

**Global Settings (Default)**:
- Configure providers and API keys once
- All projects inherit these settings
- Location: `~/Library/Application Support/@preditor/electron/global-settings.json`

**Per-Project Overrides**:
- Optional: Override global settings for specific projects
- Checkbox: "Use custom AI models for this project"
- When enabled, show model picker UI
- Location: `[project]/.preditor/ai-config.json`

**Settings Screen Addition:**
```javascript
AI Models
○ Use global AI settings
○ Customize for this project
  [Model Configuration UI appears when selected]
```

### Why This Approach?

1. **Defaults work everywhere**: Set up once, works in all projects
2. **Flexibility when needed**: Different models for different types of projects
3. **Simple for beginners**: Just configure once globally
4. **Powerful for power users**: Override per-project when it matters

Example use cases:
- Use GPT-4 globally, but Claude for a specific client project
- Use LM Studio locally for personal projects, Claude for work projects
- Different models for different programming languages

## Implementation Changes

### Remove
- `WelcomeModal.tsx` and `WelcomeModal.css`
- Multi-step wizard logic
- Modal overlay

### Create
- `SettingsScreen.tsx` - Main settings component
- `SettingsScreen.css` - Simple, clean styling
- Integrate into main window routing

### Keep
- `OnboardingService.ts` - Reuse for file operations
- Configuration structure in `.preditor/config.json`
- All the template content (plan command, track command, CLAUDE.md)

### Add
- Global AI settings management
- Per-project AI config override
- Gear icon in UI to open settings
- Settings screen route/state management

## UI/UX Improvements

### First-Time Experience
1. App launches with settings screen visible
2. Brief welcome message at top: "Welcome to Preditor! Configure your project below."
3. All options visible, with recommended defaults pre-selected
4. Click "Get Started" when ready
5. Settings screen slides away, editor appears

### Returning Users
1. Gear icon always visible in UI (toolbar or sidebar)
2. Click to open settings screen
3. Make changes, save, close
4. Or cancel to discard changes

### Visual Design
- Clean, modern form layout
- Group related options together
- Use material symbols icons (plan icon, settings icon, etc.)
- Show helper text below each option
- Validate configuration in real-time
- Show success message when saved

## Acceptance Criteria

- [ ] Settings screen appears on first project open
- [ ] Settings screen can be reopened via gear icon
- [ ] Plans location configuration works
- [ ] Claude Code integration configuration works
- [ ] Settings persist to `.preditor/config.json`
- [ ] Global AI settings work for all projects
- [ ] Per-project AI overrides work when enabled
- [ ] Changes apply immediately after saving
- [ ] Form validates configuration before saving
- [ ] User can cancel changes without saving

## Migration from Current Implementation

1. Remove WelcomeModal component and routes
2. Create SettingsScreen component
3. Add settings screen routing in App.tsx
4. Add gear icon to UI
5. Keep OnboardingService but simplify (no step tracking)
6. Update tests to use settings screen instead of modal

## Next Steps

1. Review this plan with user
2. Implement SettingsScreen component
3. Add global AI settings management
4. Add per-project AI override support
5. Add gear icon and routing
6. Update tests
7. Remove modal code
