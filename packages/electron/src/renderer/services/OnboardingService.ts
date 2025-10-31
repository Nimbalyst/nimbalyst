// Helper to join paths (browser-compatible replacement for path.join)
// TODO: this code is a liability - unclear why we don't leave all path joining to the Electron main process which has
//  access to Node's platform-specific path module.
function joinPath(...parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] || '';
  }
  let firstPart = parts[0].replace(/\/+$/g, ''); // Remove trailing slashes from first part
  let remainingParts = parts.slice(1)
    .map(part => part.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes from any remaining parts
    .filter(part => part.length > 0);
  return [firstPart, ...remainingParts].join('/');
}

export interface OnboardingConfig {
  version: string;
  onboardingCompleted: boolean;
  plansLocation: 'nimbalyst-local/plans' | 'plans' | string;
  checkInPlans: boolean;
  commandsLocation: 'project' | 'global'; // .claude/ vs ~/.claude/
  claudeCodeIntegration: {
    enabled: boolean;
    planCommandInstalled: boolean;
    trackCommandInstalled: boolean;
    claudeMdConfigured: boolean;
  };
  features: {
    analytics: boolean;
    tracking: boolean;
  };
}

export interface OnboardingStep {
  id: string;
  title: string;
  completed: boolean;
}

const DEFAULT_CONFIG: OnboardingConfig = {
  version: '1.0.0',
  onboardingCompleted: false,
  plansLocation: 'nimbalyst-local/plans',
  checkInPlans: false,
  commandsLocation: 'project', // Default to project-level .claude/
  claudeCodeIntegration: {
    enabled: false,
    planCommandInstalled: false,
    trackCommandInstalled: false,
    claudeMdConfigured: false,
  },
  features: {
    analytics: false,
    tracking: true,
  },
};

/**
 * Service for managing first-time user onboarding experience
 */
export class OnboardingService {
  private static instance: OnboardingService;
  private currentConfig: OnboardingConfig | null = null;

  private constructor() {}

  static getInstance(): OnboardingService {
    if (!OnboardingService.instance) {
      OnboardingService.instance = new OnboardingService();
    }
    return OnboardingService.instance;
  }

  /**
   * Check if a project needs onboarding
   */
  async needsOnboarding(workspacePath: string): Promise<boolean> {
    try {
      const config = await this.loadConfig(workspacePath);
      console.log(`${workspacePath} workspace onboarding needed: ${!config.onboardingCompleted}`);
      return !config.onboardingCompleted;
    } catch (error) {
      // If config doesn't exist or can't be read, assume onboarding is needed
      console.log('Onboarding config not found, onboarding needed', error);
      return true;
    }
  }

  /**
   * Load onboarding configuration from project
   */
  async loadConfig(workspacePath: string): Promise<OnboardingConfig> {
    const configPath = joinPath(workspacePath, '.nimbalyst', 'config.json');

    try {
      const result = await window.electronAPI.readFileContent(configPath);
      if (!result || !result.content) {
        this.currentConfig = { ...DEFAULT_CONFIG };
        return this.currentConfig;
      }

      const parsedConfig = JSON.parse(result.content);

      // Migrate old configs that don't have commandsLocation
      if (!parsedConfig.commandsLocation) {
        parsedConfig.commandsLocation = 'project';
      }

      this.currentConfig = parsedConfig;
      return this.currentConfig;
    } catch (error) {
      // File doesn't exist or can't be read
      console.log('No existing onboarding config, using defaults');
      this.currentConfig = { ...DEFAULT_CONFIG };
      return this.currentConfig;
    }
  }

  /**
   * Save onboarding configuration to project
   */
  async saveConfig(workspacePath: string, config: OnboardingConfig): Promise<void> {
    const configPath = joinPath(workspacePath, '.nimbalyst', 'config.json');
    const relativePath = '.nimbalyst/config.json'; // Relative to workspace

    try {
      // Write config (create-document expects relative path)
      await window.electronAPI.invoke('create-document', relativePath, JSON.stringify(config, null, 2));

      this.currentConfig = config;
    } catch (error) {
      console.error('Failed to save onboarding config:', error);
      throw error;
    }
  }

  /**
   * Mark onboarding as completed
   */
  async completeOnboarding(workspacePath: string): Promise<void> {
    const config = this.currentConfig || (await this.loadConfig(workspacePath));
    config.onboardingCompleted = true;
    await this.saveConfig(workspacePath, config);
  }

  /**
   * Install /plan command file
   */
  async installPlanCommand(workspacePath: string, plansLocation?: string): Promise<void> {
    const config = this.currentConfig || await this.loadConfig(workspacePath);
    const isGlobal = config.commandsLocation === 'global';
    const relativePath = 'commands/plan.md'; // Relative to .claude/

    try {
      // Check if plan.md already exists
      try {
        if (isGlobal) {
          const result = await window.electronAPI.invoke('read-global-claude-file', relativePath);
          if (result && result.content) {
            console.log('plan.md already exists in ~/.claude/, skipping installation');
            return;
          }
        } else {
          const planCommandPath = joinPath(workspacePath, '.claude', 'commands', 'plan.md');
          const existing = await window.electronAPI.readFileContent(planCommandPath);
          if (existing && existing.content) {
            console.log('plan.md already exists in project .claude/, skipping installation');
            return;
          }
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write plan command template
      const template = this.getPlanCommandTemplate(plansLocation);
      if (isGlobal) {
        await window.electronAPI.invoke('write-global-claude-file', relativePath, template);
      } else {
        await window.electronAPI.invoke('create-document', `.claude/${relativePath}`, template);
      }

      // Update config
      if (this.currentConfig) {
        this.currentConfig.claudeCodeIntegration.planCommandInstalled = true;
        await this.saveConfig(workspacePath, this.currentConfig);
      }
    } catch (error) {
      console.error('Failed to install plan command:', error);
      throw error;
    }
  }

  /**
   * Install /track command file
   */
  async installTrackCommand(workspacePath: string): Promise<void> {
    const config = this.currentConfig || await this.loadConfig(workspacePath);
    const isGlobal = config.commandsLocation === 'global';
    const relativePath = 'commands/track.md';

    try {
      // Check if track.md already exists
      try {
        if (isGlobal) {
          const result = await window.electronAPI.invoke('read-global-claude-file', relativePath);
          if (result && result.content) {
            console.log('track.md already exists in ~/.claude/, skipping installation');
            return;
          }
        } else {
          const trackCommandPath = joinPath(workspacePath, '.claude', 'commands', 'track.md');
          const existing = await window.electronAPI.readFileContent(trackCommandPath);
          if (existing && existing.content) {
            console.log('track.md already exists in project .claude/, skipping installation');
            return;
          }
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write track command template
      const template = this.getTrackCommandTemplate();
      if (isGlobal) {
        await window.electronAPI.invoke('write-global-claude-file', relativePath, template);
      } else {
        await window.electronAPI.invoke('create-document', `.claude/${relativePath}`, template);
      }

      // Update config
      if (this.currentConfig) {
        this.currentConfig.claudeCodeIntegration.trackCommandInstalled = true;
        await this.saveConfig(workspacePath, this.currentConfig);
      }
    } catch (error) {
      console.error('Failed to install track command:', error);
      throw error;
    }
  }

  /**
   * Install /track-bug command file
   */
  async installTrackBugCommand(workspacePath: string): Promise<void> {
    const config = this.currentConfig || await this.loadConfig(workspacePath);
    const isGlobal = config.commandsLocation === 'global';
    const relativePath = 'commands/track-bug.md';

    try {
      // Check if track-bug.md already exists
      try {
        if (isGlobal) {
          const result = await window.electronAPI.invoke('read-global-claude-file', relativePath);
          if (result && result.content) {
            console.log('track-bug.md already exists in ~/.claude/, skipping installation');
            return;
          }
        } else {
          const trackBugCommandPath = joinPath(workspacePath, '.claude', 'commands', 'track-bug.md');
          const existing = await window.electronAPI.readFileContent(trackBugCommandPath);
          if (existing && existing.content) {
            console.log('track-bug.md already exists in project .claude/, skipping installation');
            return;
          }
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write track-bug command template
      const template = this.getTrackBugCommandTemplate();
      if (isGlobal) {
        await window.electronAPI.invoke('write-global-claude-file', relativePath, template);
      } else {
        await window.electronAPI.invoke('create-document', `.claude/${relativePath}`, template);
      }
    } catch (error) {
      console.error('Failed to install track-bug command:', error);
      throw error;
    }
  }

  /**
   * Install /track-idea command file
   */
  async installTrackIdeaCommand(workspacePath: string): Promise<void> {
    const config = this.currentConfig || await this.loadConfig(workspacePath);
    const isGlobal = config.commandsLocation === 'global';
    const relativePath = 'commands/track-idea.md';

    try {
      // Check if track-idea.md already exists
      try {
        if (isGlobal) {
          const result = await window.electronAPI.invoke('read-global-claude-file', relativePath);
          if (result && result.content) {
            console.log('track-idea.md already exists in ~/.claude/, skipping installation');
            return;
          }
        } else {
          const trackIdeaCommandPath = joinPath(workspacePath, '.claude', 'commands', 'track-idea.md');
          const existing = await window.electronAPI.readFileContent(trackIdeaCommandPath);
          if (existing && existing.content) {
            console.log('track-idea.md already exists in project .claude/, skipping installation');
            return;
          }
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write track-idea command template
      const template = this.getTrackIdeaCommandTemplate();
      if (isGlobal) {
        await window.electronAPI.invoke('write-global-claude-file', relativePath, template);
      } else {
        await window.electronAPI.invoke('create-document', `.claude/${relativePath}`, template);
      }
    } catch (error) {
      console.error('Failed to install track-idea command:', error);
      throw error;
    }
  }

  /**
   * Configure CLAUDE.md file
   */
  async configureCLAUDEmd(workspacePath: string): Promise<void> {
    const claudeMdPath = joinPath(workspacePath, 'CLAUDE.md');
    const relativePath = 'CLAUDE.md'; // Relative to workspace

    try {
      const preditorSection = this.getCLAUDEmdSection();
      let finalContent: string;

      // Try to read existing file
      try {
        const result = await window.electronAPI.readFileContent(claudeMdPath);
        if (result && result.content) {
          // File exists, append to it
          const content = result.content;

          // Check if Nimbalyst section already exists
          if (content.includes('## Nimbalyst Planning System')) {
            console.log('CLAUDE.md already has Nimbalyst section, skipping');
            return;
          }

          finalContent = content + '\n\n' + preditorSection;
        } else {
          // File doesn't have content, create new
          finalContent = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

${preditorSection}`;
        }
      } catch (err) {
        // File doesn't exist, create new
        finalContent = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

${preditorSection}`;
      }

      // Write the file (create-document expects relative path)
      await window.electronAPI.invoke('create-document', relativePath, finalContent);

      // Update config
      if (this.currentConfig) {
        this.currentConfig.claudeCodeIntegration.claudeMdConfigured = true;
        await this.saveConfig(workspacePath, this.currentConfig);
      }
    } catch (error) {
      console.error('Failed to configure CLAUDE.md:', error);
      throw error;
    }
  }

  /**
   * Create plans directory if it doesn't exist
   */
  async ensurePlansDirectory(workspacePath: string, plansLocation?: string): Promise<void> {
    const config = this.currentConfig || (await this.loadConfig(workspacePath));
    const location = plansLocation || config.plansLocation;

    // Create a dummy file to ensure directory exists, then delete it
    const dummyPath = joinPath(workspacePath, location, '.gitkeep');
    try {
      await window.electronAPI.invoke('create-document', dummyPath, '');
    } catch (error) {
      console.error('Failed to create plans directory:', error);
    }
  }

  /**
   * Create an example plan document
   */
  async createExamplePlan(workspacePath: string): Promise<string> {
    const config = this.currentConfig || (await this.loadConfig(workspacePath));
    await this.ensurePlansDirectory(workspacePath);

    const planPath = joinPath(workspacePath, config.plansLocation, 'example-feature.md');
    const template = this.getExamplePlanTemplate();

    try {
      await window.electronAPI.invoke('create-document', planPath, template);
      return planPath;
    } catch (error) {
      console.error('Failed to create example plan:', error);
      throw error;
    }
  }

  /**
   * Configure .gitignore to exclude plans directory if needed
   */
  async configureGitignore(workspacePath: string, plansDirectory?: string): Promise<void> {
    const config = this.currentConfig || (await this.loadConfig(workspacePath));
    const directory = plansDirectory || config.plansLocation.split('/')[0];

    const gitignorePath = joinPath(workspacePath, '.gitignore');
    const ignoreEntry = `\n# Nimbalyst local plans (not checked into version control)\n${directory}/\n`;

    try {
      // Try to read existing .gitignore
      let content = '';
      try {
        const result = await window.electronAPI.readFileContent(gitignorePath);
        if (result && result.content) {
          content = result.content;
        }
      } catch (err) {
        // File doesn't exist, will create it
      }

      // Check if entry already exists
      if (content.includes(`${directory}/`)) {
        console.log('.gitignore already has entry for plans directory');
        return;
      }

      // Append the ignore entry
      const finalContent = content + ignoreEntry;
      await window.electronAPI.invoke('create-document', gitignorePath, finalContent);
    } catch (error) {
      console.error('Failed to configure .gitignore:', error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Get plan command template
   */
  private getPlanCommandTemplate(plansLocation?: string): string {
    const config = this.currentConfig;
    const location = plansLocation || config?.plansLocation || 'plans';

    return `# /plan Command

Create a new plan document for tracking development work.

## Overview

Plans are structured markdown documents with YAML frontmatter that track features, refactors, bug fixes, and other development work. They provide a single source of truth for what needs to be done, who's responsible, and current progress.

## File Location and Naming

**Location**: \`${location}/[descriptive-name].md\`

**Naming conventions**:
- Use kebab-case: \`user-authentication-system.md\`
- Be descriptive: The filename should clearly indicate what the plan is about
- Keep it concise: Aim for 2-5 words

## Required YAML Frontmatter

Every plan MUST start with this frontmatter structure:

\`\`\`yaml
---
planStatus:
  planId: plan-[unique-identifier]  # Use kebab-case
  title: [Plan Title]                # Human-readable title
  status: [status]                   # See Status Values below
  planType: [type]                   # See Plan Types below
  priority: [priority]               # low | medium | high | critical
  owner: [username]                  # Primary owner/assignee
  tags:                              # Keywords for categorization
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"             # Creation date (use today's date)
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"  # Last update timestamp (use current time via new Date().toISOString())
  progress: [0-100]                  # Completion percentage
---
\`\`\`

**Optional frontmatter fields**:
- \`stakeholders\`: Array of people interested in this plan
- \`dueDate\`: Target completion date (YYYY-MM-DD)
- \`startDate\`: When work began (YYYY-MM-DD)

## Status Values

| Status | When to Use |
|--------|-------------|
| \`draft\` | Just created, gathering requirements |
| \`ready-for-development\` | Planning complete, ready to start |
| \`in-development\` | Actively being implemented |
| \`in-review\` | Implementation done, awaiting review |
| \`completed\` | All acceptance criteria met |
| \`rejected\` | Decided not to pursue |
| \`blocked\` | Waiting on dependencies |

## Plan Types

| Type | Example |
|------|---------|
| \`feature\` | Add dark mode, Implement user profiles |
| \`bug-fix\` | Fix login timeout, Resolve memory leak |
| \`refactor\` | Migrate to TypeScript, Clean up database |
| \`system-design\` | Design API architecture, Database schema |
| \`research\` | Evaluate frameworks, Performance analysis |

## Document Body Structure

After the frontmatter, organize the plan like this:

\`\`\`markdown
# [Plan Title]

## Goals
- Clear, measurable objectives
- What success looks like
- Key deliverables

## Overview
Brief description of the problem or feature being addressed.

## Implementation Details
Technical details about how this will be implemented.

## Acceptance Criteria
- [ ] Checklist item 1
- [ ] Checklist item 2
- [ ] Checklist item 3
\`\`\`

## Complete Example

\`\`\`markdown
---
planStatus:
  planId: plan-user-authentication
  title: User Authentication System
  status: in-development
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
    - product-team
  tags:
    - authentication
    - security
  created: "2025-10-24"
  updated: "2025-10-24T14:30:00.000Z"
  progress: 45
  startDate: "2025-10-20"
  dueDate: "2025-11-01"
---

# User Authentication System

## Goals
- Implement secure JWT-based authentication
- Support email/password and OAuth (Google, GitHub)
- Add role-based access control (RBAC)

## Overview

The app currently has no authentication. We need a complete auth system with multiple sign-in methods and proper authorization.

## Implementation Details

### Technology Stack
- Passport.js for authentication
- JWT for stateless auth
- Redis for sessions
- bcrypt for password hashing

### API Endpoints
- \`POST /auth/register\` - User registration
- \`POST /auth/login\` - Email/password login
- \`POST /auth/refresh\` - Refresh access token
- \`GET /auth/google\` - OAuth with Google

## Acceptance Criteria
- [ ] Users can register with email/password
- [ ] Users can log in with email/password
- [ ] OAuth works (Google, GitHub)
- [ ] JWT tokens expire after 15 minutes
- [ ] Role-based permissions work
- [ ] All tests passing
\`\`\`

## CRITICAL: Timestamp Requirements

When creating a plan:
1. Set \`created\` to today's date in YYYY-MM-DD format
2. Set \`updated\` to the CURRENT timestamp using new Date().toISOString() format
3. NEVER use midnight timestamps (00:00:00.000Z) - always use the actual current time

The \`updated\` field is used to display "last updated" times in the tracker table. Using midnight timestamps will show incorrect "Xh ago" values.

## Usage

When the user types \`/plan [description]\`:

1. Extract key information from the description
2. Choose appropriate \`planType\`, \`priority\`, and \`status\`
3. Generate unique \`planId\` from description (kebab-case)
4. Set \`created\` to today's date, \`updated\` to current timestamp (use new Date().toISOString())
5. Create file in \`${location}/\` with proper frontmatter
6. Include relevant sections based on plan type

## Related Commands

- \`/track [type] [description]\` - Track bugs, tasks, ideas, or decisions (see .claude/commands/track.md)
  - Example: \`/track bug Login fails on Safari\`

## Best Practices

- Keep plans focused (one feature/task per plan)
- Update status and progress regularly
- Use clear, descriptive titles
- Tag appropriately for filtering
- Link related plans in document body
- Break large plans into multiple focused plans`;
  }

  /**
   * Get track command template
   */
  private getTrackCommandTemplate(): string {
    return `# /track Command

Create a tracking item (bug, task, idea, or decision) in the appropriate tracking document.

## Tracking System Overview

Tracking items are organized by type in \`nimbalyst-local/tracker/\`:
- **Bugs** (bugs.md): Issues and defects that need fixing
- **Tasks** (tasks.md): Work items and todos
- **Ideas** (ideas.md): Feature ideas and improvements
- **Decisions** (decisions.md): Architecture and design decisions

## Context-Aware Placement

The command should intelligently choose where to place tracking items:

1. **In current plan document** - If working within a plan file (has \`planStatus\` frontmatter), add the item to a relevant section (e.g., "Known Issues", "Tasks", "Ideas")
2. **In related plan document** - If the item relates to a specific feature/component, check for a plan document for that feature in the plans directory
3. **In global tracker** - Default to \`nimbalyst-local/tracker/[type]s.md\` for general items

This keeps related items together for better context and organization.

## Tracking Item Structure

Each tracking item uses inline tracker syntax:

\`\`\`markdown
- [Brief description] #[type][id:[type]_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
\`\`\`

### Required Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`id\` | \`[type]_[ulid]\` | Unique identifier (bug_, task_, ida_, dec_) |
| \`status\` | \`to-do\|in-progress\|done\` | Current status |
| \`priority\` | \`low\|medium\|high\|critical\` | Item priority |
| \`created\` | \`YYYY-MM-DD\` | Creation date |

### Optional Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`title\` | \`"Title text"\` | Explicit title (if different from line text) |
| \`updated\` | \`YYYY-MM-DDTHH:MM:SS.sssZ\` | Last update timestamp (ISO 8601) |
| \`assignee\` | \`username\` | Person responsible |

## ULID Generation

Generate a unique ULID (Universally Unique Lexicographically Sortable Identifier):

- **Format**: 26 characters, Base32 encoded
- **Character set**: 0-9, A-Z (excluding I, L, O, U)
- **Structure**: 10 chars timestamp + 16 chars random
- **Example**: \`01HQXYZ7890ABCDEF12345\`

**ID Prefixes by type**:
- Bugs: \`bug_01HQXYZ7890ABCDEF12345\`
- Tasks: \`task_01HQXYZ7890ABCDEF12345\`
- Ideas: \`ida_01HQXYZ7890ABCDEF12345\`
- Decisions: \`dec_01HQXYZ7890ABCDEF12345\`

## Examples

### Bug
\`\`\`markdown
- Login button doesn't work on mobile Safari #bug[id:bug_01HQXYZ7890ABCDEF12345 status:to-do priority:high created:2025-10-24]
\`\`\`

### Task
\`\`\`markdown
- Update documentation for API endpoints #task[id:task_01HQXYZ7890ABCDEF12346 status:in-progress priority:medium created:2025-10-24]
\`\`\`

### Idea
\`\`\`markdown
- Add dark mode to settings panel #idea[id:ida_01HQXYZ7890ABCDEF12347 status:to-do priority:low created:2025-10-24]
\`\`\`

### Decision
\`\`\`markdown
- Use PostgreSQL for data persistence #decision[id:dec_01HQXYZ7890ABCDEF12348 status:done priority:high created:2025-10-20]
\`\`\`

## Status Values
- \`to-do\`: Newly created, not yet started
- \`in-progress\`: Currently being worked on
- \`blocked\`: Blocked by dependencies or issues
- \`done\`: Work completed
- \`wont-fix\`: Decided not to address (bugs/tasks)

## Usage

When the user types \`/track [type] [description]\`:

Where \`[type]\` is one of: \`bug\`, \`task\`, \`idea\`, or \`decision\`

1. **Parse the type** from the command
2. **Generate ULID** for the unique item ID
3. **Determine priority** based on description
4. **Add to appropriate tracker file** in \`nimbalyst-local/tracker/[type]s.md\`
5. **Confirm** to the user where the item was tracked

**Examples:**
- \`/track bug Login fails on mobile Safari\`
- \`/track task Update API documentation\`
- \`/track idea Add dark mode support\`
- \`/track decision Use TypeScript for new modules\`

## Priority Guidelines

- **Critical**: System down, data loss, security vulnerability, must-have feature
- **High**: Major feature broken, high-value feature, important decision
- **Medium**: Feature partially broken, nice to have, standard task
- **Low**: Minor issue, cosmetic problem, low-priority enhancement

## Related Commands

- \`/plan [description]\` - Create a feature plan (see .claude/commands/plan.md)

## Best Practices

- **Always generate new ULIDs** - Never hardcode or reuse IDs
- **Include creation date** - Required for all new items
- **Default to medium priority** - Unless user specifies otherwise
- **Preserve file formatting** - Maintain existing structure
- **Group related items** - Keep items organized by section
- **Update timestamps** - Set \`updated\` field when modifying items
- **Move completed items** - Move to "Completed" section when done`;
  }

  /**
   * Get track-bug command template
   */
  private getTrackBugCommandTemplate(): string {
    return `# /track-bug Command

Track a bug using Nimbalyst's inline tracker syntax.

## Overview

The \`/track-bug\` command creates bug tracking items using a lightweight inline syntax. Bugs can be tracked in dedicated tracker files or directly within plan documents for context-aware organization.

## Context-Aware Bug Tracking

The command automatically determines the best location for the bug:

### 1. In Current Plan Document
If you're working on a plan document (has \`planStatus\` frontmatter):
- Bug is added to the current plan file
- Added in a relevant section (e.g., "Bugs", "Known Issues", "Problems")
- If no such section exists, creates "## Known Issues" section

### 2. In Related Feature Plan
If the bug is related to a specific feature/component:
- Checks for a plan document for that feature in \`nimbalyst-local/plans/\`
- If found, adds the bug there for context

### 3. In Global Bug Tracker
Otherwise (general bug or no specific context):
- Adds to \`nimbalyst-local/tracker/bugs.md\`
- Creates the file with proper structure if it doesn't exist

## Bug Tracker Syntax

Use inline tracker syntax with \`#bug\` prefix:

\`\`\`markdown
- [Brief bug description] #bug[id:bug_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
\`\`\`

### Required Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`id\` | \`bug_[ulid]\` | Unique identifier (26-char ULID) |
| \`status\` | \`to-do\|in-progress\|done\` | Current status |
| \`priority\` | \`low\|medium\|high\|critical\` | Bug severity |
| \`created\` | \`YYYY-MM-DD\` | Creation date |

### Optional Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`title\` | \`"Title text"\` | Explicit title (if different from line text) |
| \`updated\` | \`YYYY-MM-DDTHH:MM:SS.sssZ\` | Last update timestamp (ISO 8601) |

## ULID Generation

Generate a unique ULID (Universally Unique Lexicographically Sortable Identifier):

- **Format**: 26 characters, Base32 encoded
- **Character set**: 0-9, A-Z (excluding I, L, O, U)
- **Structure**: 10 chars timestamp + 16 chars random
- **Example**: \`01HQXYZ7890ABCDEF12345\`
- **Full bug ID**: \`bug_01HQXYZ7890ABCDEF12345\`

**Why ULID?**
- Lexicographically sortable (sorts by creation time)
- No central coordination needed
- URL-safe and case-insensitive
- More compact than UUIDs

## Examples

### Simple Bug
\`\`\`markdown
- Login button doesn't work on mobile Safari #bug[id:bug_01HQXYZ7890ABCDEF12345 status:to-do priority:high created:2025-10-24]
\`\`\`

### Bug with Explicit Title
\`\`\`markdown
- Safari mobile login issue #bug[id:bug_01HQXYZ7890ABCDEF12346 status:in-progress priority:high created:2025-10-24 title:"Mobile Safari Login Failure"]
\`\`\`

### Bug with Update Timestamp
\`\`\`markdown
- API timeout on large requests #bug[id:bug_01HQXYZ7890ABCDEF12347 status:to-do priority:critical created:2025-10-24 updated:2025-10-24T14:30:00.000Z]
\`\`\`

### Completed Bug
\`\`\`markdown
- Memory leak in image loader #bug[id:bug_01HQXYZ7890ABCDEF12348 status:done priority:high created:2025-10-20 updated:2025-10-24T16:00:00.000Z]
\`\`\`

## Bug Tracker File Structure

If creating \`nimbalyst-local/tracker/bugs.md\`, use this template:

\`\`\`markdown
# Bugs

## Active Bugs

- [New and in-progress bugs with #bug syntax]

## Completed Bugs

- [Completed bugs with status:done]
\`\`\`

## Usage Workflow

When the user types \`/track-bug [description]\`:

1. **Extract bug details** from the user's description
2. **Determine location** based on context (plan, related feature, or global tracker)
3. **Generate ULID** for the unique bug ID
4. **Create bug entry** with proper inline syntax
5. **Add to appropriate section** in the target file
6. **Confirm** to the user where the bug was tracked

## Priority Guidelines

Choose priority based on impact:

- **Critical**: System down, data loss, security vulnerability
- **High**: Major feature broken, affects many users
- **Medium**: Feature partially broken, workaround exists
- **Low**: Minor issue, cosmetic problem, edge case

## Status Transitions

Typical bug lifecycle:

\`\`\`
to-do → in-progress → done
         ↓
      blocked (if stuck)
\`\`\`

## Related Commands

- \`/plan [description]\` - Create a feature plan (see .claude/commands/plan.md)
- \`/track-idea [description]\` - Track an idea (see .claude/commands/track-idea.md)

## Best Practices

- **Always generate new ULIDs** - Never hardcode or reuse IDs
- **Include creation date** - Required for all new bugs
- **Default to medium priority** - Unless user specifies otherwise
- **Preserve file formatting** - Maintain existing structure and styling
- **Group related bugs** - Keep bugs near related content in plans
- **Update timestamps** - Set \`updated\` field when modifying bugs
- **Move completed bugs** - Move to "Completed" section when done`;
  }

  /**
   * Get track-idea command template
   */
  private getTrackIdeaCommandTemplate(): string {
    return `# /track-idea Command

Track a feature idea using Nimbalyst's inline tracker syntax.

## Overview

The \`/track-idea\` command creates idea tracking items for feature requests, improvements, and enhancements. Ideas can be tracked in dedicated files or within plan documents for context-aware organization.

## Context-Aware Idea Tracking

The command automatically determines the best location for the idea:

### 1. In Current Plan Document
If you're working on a plan document (has \`planStatus\` frontmatter):
- Idea is added to the current plan file
- Added in a relevant section (e.g., "Ideas", "Future Enhancements", "Improvements")
- If no such section exists, creates "## Future Ideas" section

### 2. In Related Feature Plan
If the idea is related to a specific feature/component:
- Checks for a plan document for that feature in \`nimbalyst-local/plans/\`
- If found, adds the idea there for context

### 3. In Global Ideas Tracker
Otherwise (general idea or no specific context):
- Adds to \`nimbalyst-local/tracker/ideas.md\`
- Creates the file with proper structure if it doesn't exist

## Idea Tracker Syntax

Use inline tracker syntax with \`#idea\` prefix:

\`\`\`markdown
- [Brief idea description] #idea[id:ida_[ulid] status:to-do priority:medium created:YYYY-MM-DD]
\`\`\`

### Required Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`id\` | \`ida_[ulid]\` | Unique identifier (26-char ULID) |
| \`status\` | \`to-do\|in-progress\|done\` | Current status |
| \`priority\` | \`low\|medium\|high\|critical\` | Idea importance |
| \`created\` | \`YYYY-MM-DD\` | Creation date |

### Optional Fields

| Field | Format | Description |
|-------|--------|-------------|
| \`title\` | \`"Title text"\` | Explicit title (if different from line text) |
| \`updated\` | \`YYYY-MM-DDTHH:MM:SS.sssZ\` | Last update timestamp (ISO 8601) |

## ULID Generation

Generate a unique ULID (Universally Unique Lexicographically Sortable Identifier):

- **Format**: 26 characters, Base32 encoded
- **Character set**: 0-9, A-Z (excluding I, L, O, U)
- **Structure**: 10 chars timestamp + 16 chars random
- **Example**: \`01HQXYZ7890ABCDEF12345\`
- **Full idea ID**: \`ida_01HQXYZ7890ABCDEF12345\`

**Why ULID?**
- Lexicographically sortable (sorts by creation time)
- No central coordination needed
- URL-safe and case-insensitive
- More compact than UUIDs

## Examples

### Simple Idea
\`\`\`markdown
- Add dark mode to settings panel #idea[id:ida_01HQXYZ7890ABCDEF12345 status:to-do priority:medium created:2025-10-24]
\`\`\`

### Idea with Explicit Title
\`\`\`markdown
- Dark mode settings #idea[id:ida_01HQXYZ7890ABCDEF12346 status:in-progress priority:high created:2025-10-24 title:"Dark Mode Theme Switcher"]
\`\`\`

### Idea with Update Timestamp
\`\`\`markdown
- Add keyboard shortcuts for common actions #idea[id:ida_01HQXYZ7890ABCDEF12347 status:to-do priority:low created:2025-10-24 updated:2025-10-24T14:30:00.000Z]
\`\`\`

### Implemented Idea
\`\`\`markdown
- Auto-save draft messages #idea[id:ida_01HQXYZ7890ABCDEF12348 status:done priority:high created:2025-10-20 updated:2025-10-24T16:00:00.000Z]
\`\`\`

## Ideas Tracker File Structure

If creating \`nimbalyst-local/tracker/ideas.md\`, use this template:

\`\`\`markdown
# Ideas

## Active Ideas

- [New and in-progress ideas with #idea syntax]

## Implemented Ideas

- [Implemented ideas with status:done]
\`\`\`

## Usage Workflow

When the user types \`/track-idea [description]\`:

1. **Extract idea details** from the user's description
2. **Determine location** based on context (plan, related feature, or global tracker)
3. **Generate ULID** for the unique idea ID
4. **Create idea entry** with proper inline syntax
5. **Add to appropriate section** in the target file
6. **Confirm** to the user where the idea was tracked

## Priority Guidelines

Choose priority based on value and effort:

- **Critical**: Must-have feature, competitive necessity
- **High**: High-value feature, significant user benefit
- **Medium**: Nice to have, moderate value
- **Low**: Minor enhancement, low priority

## Status Transitions

Typical idea lifecycle:

\`\`\`
to-do → in-progress → done
   ↓
rejected (if decided not to implement)
\`\`\`

## Related Commands

- \`/plan [description]\` - Create a feature plan (see .claude/commands/plan.md)
- \`/track-bug [description]\` - Track a bug (see .claude/commands/track-bug.md)

## Best Practices

- **Always generate new ULIDs** - Never hardcode or reuse IDs
- **Include creation date** - Required for all new ideas
- **Default to medium priority** - Unless user specifies otherwise
- **Preserve file formatting** - Maintain existing structure and styling
- **Group related ideas** - Keep ideas near related content in plans
- **Update timestamps** - Set \`updated\` field when modifying ideas
- **Move implemented ideas** - Move to "Implemented" section when done
- **Convert to plans** - Promote high-value ideas to full plan documents`;
  }

  /**
   * Get CLAUDE.md section to add
   */
  private getCLAUDEmdSection(): string {
    const config = this.currentConfig;
    const plansLocation = config?.plansLocation || 'plans';
    const commandsLocation = config?.commandsLocation === 'global' ? '~/.claude' : '.claude';

    return `## Nimbalyst Planning System

This project uses Nimbalyst for structured planning and task tracking.

### Custom Commands
- \`/plan [description]\` - Create a new plan document (see ${commandsLocation}/commands/plan.md for details)
- \`/track [type] [description]\` - Track bugs, tasks, ideas, and decisions (see ${commandsLocation}/commands/track.md for details)
  - Types: \`bug\`, \`task\`, \`idea\`, \`decision\`

### File Organization
- Plans are stored in \`${plansLocation}/\` as markdown files with YAML frontmatter
- Tracking items are stored in \`nimbalyst-local/tracker/\` organized by type (bugs.md, tasks.md, ideas.md, decisions.md)

For detailed documentation on planning, tracking, and templates, see the command files in ${commandsLocation}/commands/.`;
  }

  /**
   * Get example plan template
   */
  private getExamplePlanTemplate(): string {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    return `---
planStatus:
  planId: plan-example-feature
  title: Example Feature Plan
  status: draft
  planType: feature
  priority: medium
  owner: developer
  stakeholders:
    - developer
  tags:
    - example
    - getting-started
  created: "${today}"
  updated: "${now}"
  progress: 0
---

# Example Feature Plan

## Goals

This is an example plan document to help you get started with Nimbalyst's planning system.

Key objectives:
1. Demonstrate the plan document structure
2. Show how frontmatter metadata works
3. Provide a template for future plans

## Overview

Plans in Nimbalyst are markdown documents with YAML frontmatter that track features, bugs, and other development work. The frontmatter includes metadata like status, priority, and progress that powers the plan view interface.

## Implementation Details

When creating your own plans:

1. **Use the /plan command**: Type \`/plan [your feature description]\` in the AI chat to create a new plan with Claude Code
2. **Choose descriptive filenames**: Use kebab-case names that clearly describe the plan
3. **Keep frontmatter updated**: Update status, progress, and updated timestamp as work progresses
4. **Write clear goals**: Start with clear, measurable objectives
5. **Include acceptance criteria**: Define what "done" means for this plan

## Next Steps

- Create your first real plan using \`/plan [description]\`
- View all plans in the plan view (accessible from the View menu)
- Update this example plan's status as you learn the system
- Explore the tracking system with \`/track [type] [description]\`

## Acceptance Criteria

- [ ] Understand plan document structure
- [ ] Know how to create new plans
- [ ] Can update plan status and progress
- [ ] Comfortable with the plan view interface`;
  }

  /**
   * Enable analytics
   */
  async enableAnalytics(workspacePath: string): Promise<void> {
    const config = this.currentConfig || (await this.loadConfig(workspacePath));
    config.features.analytics = true;
    await this.saveConfig(workspacePath, config);
  }

  /**
   * Create a tracker document (bugs, tasks, ideas, or decisions)
   */
  async createTrackerDocument(
    workspacePath: string,
    type: 'bugs' | 'tasks' | 'ideas' | 'decisions'
  ): Promise<void> {
    const trackerPath = joinPath(workspacePath, 'nimbalyst-local', 'tracker', `${type}.md`);
    const relativePath = `nimbalyst-local/tracker/${type}.md`; // Relative to workspace

    try {
      // Check if tracker already exists
      try {
        const existing = await window.electronAPI.readFileContent(trackerPath);
        if (existing && existing.content) {
          console.log(`${type}.md already exists, skipping creation`);
          return;
        }
      } catch (err) {
        // File doesn't exist, continue with creation
      }

      // Create tracker document (create-document expects relative path)
      const template = this.getTrackerTemplate(type);
      await window.electronAPI.invoke('create-document', relativePath, template);
    } catch (error) {
      console.error(`Failed to create ${type} tracker:`, error);
      throw error;
    }
  }

  /**
   * Get tracker document template
   */
  private getTrackerTemplate(type: 'bugs' | 'tasks' | 'ideas' | 'decisions'): string {
    const typeConfig = {
      bugs: {
        title: 'Bugs & Issues',
        description: 'Track bugs, defects, and issues that need fixing',
        icon: 'bug_report',
        itemPrefix: 'bug',
      },
      tasks: {
        title: 'Tasks & Todos',
        description: 'Track work items, todos, and action items',
        icon: 'task',
        itemPrefix: 'task',
      },
      ideas: {
        title: 'Ideas & Improvements',
        description: 'Track feature ideas, improvements, and enhancements',
        icon: 'lightbulb',
        itemPrefix: 'idea',
      },
      decisions: {
        title: 'Decisions',
        description: 'Track architecture and design decisions',
        icon: 'account_tree',
        itemPrefix: 'decision',
      },
    };

    const config = typeConfig[type];
    const today = new Date().toISOString().split('T')[0];

    return `# ${config.title}

${config.description}

## Active Items

<!-- Use /track command or # syntax to create new items -->

## Completed Items

<!-- Completed items will appear here -->

---

**About this tracker:**
- Use \`/track [description]\` in Claude Code to create new ${type}
- Or use \`#${type}\` syntax in any document
- Items use YAML frontmatter for metadata
- Status values: open, in-progress, blocked, resolved, closed, wont-fix
`;
  }

  /**
   * Get current configuration
   */
  getCurrentConfig(): OnboardingConfig | null {
    return this.currentConfig;
  }
}

export default OnboardingService.getInstance();
