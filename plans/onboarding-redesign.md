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


## Problem with Current Approach

The current modal-based onboarding has several issues:
1. Too many steps (6 steps is overwhelming)
2. Modal UI feels disconnected from the main application
3. Configuration is one-time only, hard to revisit
4. Users can't easily reconfigure after initial setup
5. Modal blocks the entire application

## New Approach: Feature Cards Screen

Instead of a modal wizard, use a feature cards screen that:
- Can be accessed anytime via gear icon
- Shows available features as individual cards
- Each card displays installation status (installed/not installed)
- Actions happen immediately (no save/cancel)
- Stateless - just reflects current project state
- Feels integrated with the application

## Feature Cards Screen Structure

### Layout
```javascript
┌─────────────────────────────────────────────────────────┐
│ Project Features                                  [×]    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 📋 Plans Directory                               │  │
│  │ Store plans in a dedicated folder                │  │
│  │                                                  │  │
│  │ Status: Not configured                           │  │
│  │ [Set Up Plans Directory]                         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 🤖 Claude Code - /plan Command                   │  │
│  │ Create and manage plans from Claude              │  │
│  │                                                  │  │
│  │ Status: ✓ Installed                              │  │
│  │ [Uninstall]                                      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 📊 Claude Code - /track Command                  │  │
│  │ Track progress on plans from Claude              │  │
│  │                                                  │  │
│  │ Status: Not installed                            │  │
│  │ [Install]                                        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 📝 CLAUDE.md Configuration                       │  │
│  │ Add Preditor context to Claude conversations     │  │
│  │                                                  │  │
│  │ Status: Not installed                            │  │
│  │ [Install]                                        │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  [Install All Features]                                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Simplified Flow

**First-time project open:**
1. Feature cards screen appears automatically
2. All features shown as cards with current status
3. User can install individual features or all at once
4. Each action happens immediately (no save step)
5. Status updates in real-time
6. User closes when done

**Returning users:**
- Access feature cards via gear icon anytime
- See current installation status
- Install or uninstall features as needed
- Changes apply immediately

## Feature Cards

### 1. Plans Directory Card
- Shows current status: configured or not
- Button: "Set Up Plans Directory"
- On click: Creates `.nimbalyst-local/plans` folder and adds to .gitignore
- Uses sensible default (no configuration needed)
- Action completes immediately, status updates

### 2. /plan Command Card
- Shows current status: installed or not installed
- Checks for `.claude/commands/plan.md` file
- Button: "Install" or "Uninstall" based on status
- On install: Creates command file immediately
- On uninstall: Removes command file immediately


### 3. /track Command Card
- Shows current status: installed or not installed
- Checks for `.claude/commands/track.md` file
- Button: "Install" or "Uninstall" based on status
- On install: Creates command file immediately
- On uninstall: Removes command file immediately

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

**Feature Card Addition:**
```javascript
┌──────────────────────────────────────────────────┐
│ 🤖 AI Model Configuration                        │
│ Customize AI models for this project             │
│                                                  │
│ Status: Using global settings                    │
│ [Customize for This Project]                     │
└──────────────────────────────────────────────────┘
```

### Why This Approach?

### 4. CLAUDE.md Configuration Card
- Shows current status: installed or not installed
- Checks for `CLAUDE.md` file with Preditor context
- Button: "Install" or "Uninstall" based on status
- On install: Creates/updates CLAUDE.md immediately
- On uninstall: Removes Preditor section from CLAUDE.md

### 5. Install All Button
- Appears at bottom of screen
- Installs all features that aren't already installed
- Each installation happens immediately
- Status updates in real-time as features are installed


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
- Any stateful form management
- Save/cancel buttons

### Create
- `FeatureCardsScreen.tsx` - Main feature cards component
- `FeatureCard.tsx` - Individual card component
- `FeatureCardsScreen.css` - Simple, clean card styling
- Integrate into main window routing

### Keep
- `OnboardingService.ts` - Reuse for file operations
- All the template content (plan command, track command, CLAUDE.md)

### Add
- Status detection logic (check if features are installed)
- Immediate action handlers (install/uninstall)
- Global AI settings management
- Per-project AI config override
- Gear icon in UI to open feature cards
- Feature cards screen route/state management

## UI/UX Improvements

### First-Time Experience
1. App launches with feature cards screen visible
2. Brief welcome message at top: "Welcome to Preditor! Set up features for your project."
3. All features shown as cards with clear status
4. User can install features individually or all at once
5. Each action completes immediately with visual feedback
6. User closes screen when done

### Returning Users
1. Gear icon always visible in UI (toolbar or sidebar)
2. Click to open feature cards screen
3. Close when done
4. See current status of all features
5. Install or uninstall as needed

### Visual Design
- Clean card-based layout
- Each card is self-contained with icon, title, description
- Clear status indicators (✓ Installed, Not installed)
- Action buttons change based on status (Install/Uninstall)
- Use material symbols icons (plan icon, robot icon, etc.)
- Immediate visual feedback on actions (loading state, then status update)
- Toast notifications for success/error

## Acceptance Criteria

- [ ] Feature cards screen appears on first project open
- [ ] Feature cards screen can be reopened via gear icon
- [ ] Each card correctly detects installation status
- [ ] Plans directory setup works immediately
- [ ] /plan command install/uninstall works immediately
- [ ] "Install All" button installs all missing features
- [ ] Status updates in real-time after each action
- [ ] /track command install/uninstall works immediately
- [ ] No save/cancel buttons (stateless design)
- [ ] Global AI settings work for all projects
- [ ] Per-project AI overrides work when enabled
- [ ] CLAUDE.md install/uninstall works immediately
- [ ] Toast notifications show success/error feedback

## Migration from Current Implementation

1. Remove WelcomeModal component and routes
2. Create FeatureCardsScreen and FeatureCard components
3. Add feature detection logic (check file existence)
4. Add immediate action handlers (no save/cancel)
5. Add feature cards screen routing in App.tsx
6. Add gear icon to UI
7. Keep OnboardingService but simplify (no step tracking, no state)
8. Update tests to use feature cards instead of modal

## Next Steps

1. Review this plan with user
2. Implement SettingsScreen component
3. Add global AI settings management
4. Add per-project AI override support
5. Add gear icon and routing
6. Update tests
7. Remove modal code
