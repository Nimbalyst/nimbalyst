// Helper to join paths (browser-compatible replacement for path.join)
function joinPath(...parts: string[]): string {
  return parts
    .map(part => part.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes
    .filter(part => part.length > 0)
    .join('/');
}

export interface OnboardingConfig {
  version: string;
  onboardingCompleted: boolean;
  plansLocation: 'nimbalyst-local/plans' | 'plans' | string;
  checkInPlans: boolean;
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
      return !config.onboardingCompleted;
    } catch (error) {
      // If config doesn't exist or can't be read, assume onboarding is needed
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

      this.currentConfig = JSON.parse(result.content);
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
    const nimbalystDir = joinPath(workspacePath, '.nimbalyst');
    const configPath = joinPath(nimbalystDir, 'config.json');

    try {
      // Ensure .nimbalyst directory exists
      try {
        await window.electronAPI.createFolder(nimbalystDir);
      } catch (err) {
        // Directory might already exist, that's okay
      }

      // Write config
      await window.electronAPI.createFile(configPath, JSON.stringify(config, null, 2));

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
    const claudeDir = joinPath(workspacePath, '.claude');
    const commandsDir = joinPath(claudeDir, 'commands');
    const planCommandPath = joinPath(commandsDir, 'plan.md');

    try {
      // Ensure .claude directory exists
      try {
        await window.electronAPI.createFolder(claudeDir);
      } catch (err) {
        // Directory might already exist
      }

      // Ensure .claude/commands directory exists
      try {
        await window.electronAPI.createFolder(commandsDir);
      } catch (err) {
        // Directory might already exist
      }

      // Check if plan.md already exists
      try {
        const existing = await window.electronAPI.readFileContent(planCommandPath);
        if (existing && existing.content) {
          console.log('plan.md already exists, skipping installation');
          return;
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write plan command template
      const template = this.getPlanCommandTemplate(plansLocation);
      await window.electronAPI.createFile(planCommandPath, template);

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
    const claudeDir = joinPath(workspacePath, '.claude');
    const commandsDir = joinPath(claudeDir, 'commands');
    const trackCommandPath = joinPath(commandsDir, 'track.md');

    try {
      // Ensure .claude directory exists
      try {
        await window.electronAPI.createFolder(claudeDir);
      } catch (err) {
        // Directory might already exist
      }

      // Ensure .claude/commands directory exists
      try {
        await window.electronAPI.createFolder(commandsDir);
      } catch (err) {
        // Directory might already exist
      }

      // Check if track.md already exists
      try {
        const existing = await window.electronAPI.readFileContent(trackCommandPath);
        if (existing && existing.content) {
          console.log('track.md already exists, skipping installation');
          return;
        }
      } catch (err) {
        // File doesn't exist, continue with installation
      }

      // Write track command template
      const template = this.getTrackCommandTemplate();
      await window.electronAPI.createFile(trackCommandPath, template);

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
   * Configure CLAUDE.md file
   */
  async configureCLAUDEmd(workspacePath: string): Promise<void> {
    const claudeMdPath = joinPath(workspacePath, 'CLAUDE.md');

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

      // Write the file
      await window.electronAPI.createFile(claudeMdPath, finalContent);

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
    const plansDir = joinPath(workspacePath, location);

    try {
      // Create all parent directories if needed
      const pathParts = location.split('/');
      let currentPath = workspacePath;

      for (const part of pathParts) {
        currentPath = joinPath(currentPath, part);
        try {
          await window.electronAPI.createFolder(currentPath);
        } catch (error) {
          // Directory might already exist, that's okay
        }
      }
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
      await window.electronAPI.createFile(planPath, template);
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
      await window.electronAPI.createFile(gitignorePath, finalContent);
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

    return `Create a new plan document in the ${location}/ directory following these guidelines:

## File Naming and Location
- Location: ${location}/[descriptive-name].md
- Use kebab-case for filenames (e.g., user-authentication-system.md)
- Name should be descriptive of the feature or task

## Plan Document Structure

Every plan MUST include YAML frontmatter with the following fields:

\`\`\`yaml
---
planStatus:
  planId: plan-[unique-identifier]  # Use kebab-case, e.g., plan-user-auth
  title: [Plan Title]                # Human-readable title
  status: [status]                   # See status values below
  planType: [type]                   # See plan types below
  priority: [priority]               # low | medium | high | critical
  owner: [username]                  # Primary owner/assignee
  stakeholders:                      # List of stakeholders
    - [stakeholder1]
    - [stakeholder2]
  tags:                              # Relevant tags for categorization
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"             # Creation date
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"  # Last update timestamp
  progress: [0-100]                  # Completion percentage
  dueDate: "YYYY-MM-DD"              # Due date (optional)
  startDate: "YYYY-MM-DD"            # Start date (optional)
---
\`\`\`

## Status Values
- draft: Initial planning phase
- ready-for-development: Approved and ready for implementation
- in-development: Currently being worked on
- in-review: Implementation complete, pending review
- completed: Successfully completed
- rejected: Plan has been rejected or cancelled
- blocked: Progress blocked by dependencies

## Plan Types
- feature: New feature development
- bug-fix: Bug fix or issue resolution
- refactor: Code refactoring/improvement
- system-design: Architecture/design work
- research: Research/investigation task

## Document Structure

After the frontmatter, include:

1. Title followed by plan status comment:
\`\`\`markdown
# Plan Title
<!-- plan-status -->
\`\`\`

2. Goals section outlining objectives
3. System Overview or problem description
4. Implementation details as needed
5. Acceptance criteria when applicable

## Example

\`\`\`markdown
---
planStatus:
  planId: plan-user-authentication
  title: User Authentication System
  status: draft
  planType: feature
  priority: high
  owner: developer
  stakeholders:
    - developer
    - product-team
  tags:
    - authentication
    - security
    - user-management
  created: "2025-10-16"
  updated: "2025-10-16T10:00:00.000Z"
  progress: 0
---

# User Authentication System
<!-- plan-status -->

## Goals
- Implement secure user authentication
- Support multiple authentication providers
- Ensure session management

## Implementation Details
[Your implementation details here]
\`\`\`

When creating a plan, extract the key information from the user's request and populate all required frontmatter fields appropriately.`;
  }

  /**
   * Get track command template
   */
  private getTrackCommandTemplate(): string {
    return `Create a tracking item (bug, task, or idea) in the appropriate tracking document.

## Tracking System Overview

Tracking items are organized by type:
- **Bugs**: Issues and defects that need fixing
- **Tasks**: Work items and todos
- **Ideas**: Feature ideas and improvements

## Tracking Item Structure

Each tracking item should include:

\`\`\`yaml
---
trackingStatus:
  itemId: [type]-[unique-id]        # e.g., bug-001, task-042, idea-015
  title: [Short Description]
  type: [bug|task|idea]
  status: [status]                   # See status values below
  priority: [priority]               # low | medium | high | critical
  assignee: [username]               # Person responsible
  tags:                              # Relevant tags
    - [tag1]
    - [tag2]
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"
  resolvedDate: "YYYY-MM-DD"         # When resolved (optional)
---
\`\`\`

## Status Values
- open: Newly created, not yet started
- in-progress: Currently being worked on
- blocked: Blocked by dependencies or issues
- resolved: Work completed
- closed: Verified and closed
- wont-fix: Decided not to address

## Usage

When the user describes a bug, task, or idea:
1. Determine the type (bug, task, or idea)
2. Generate appropriate itemId
3. Create or update the tracking document in plans/
4. Add the item with proper frontmatter

Example: "Fix login button not responding on mobile"
- Type: bug
- ItemId: bug-login-mobile-001
- Priority: high (based on user impact)`;
  }

  /**
   * Get CLAUDE.md section to add
   */
  private getCLAUDEmdSection(): string {
    const config = this.currentConfig;
    const plansLocation = config?.plansLocation || 'plans';

    return `## Nimbalyst Planning System

This project uses Nimbalyst's structured markdown-based planning system for organizing development work.

### Plan Documents
- **Location**: All plans are stored in the \`${plansLocation}/\` directory
- **Format**: Markdown files with YAML frontmatter
- **Naming**: Use descriptive kebab-case names (e.g., \`user-authentication.md\`)

### Plan Structure
Every plan document includes:
- YAML frontmatter with metadata (planId, status, type, priority, etc.)
- Plan status comment: \`<!-- plan-status -->\`
- Goals section
- Implementation details
- Acceptance criteria

### Status Values
- \`draft\`: Initial planning
- \`ready-for-development\`: Ready to implement
- \`in-development\`: Work in progress
- \`in-review\`: Pending review
- \`completed\`: Done
- \`rejected\`: Cancelled
- \`blocked\`: Blocked by dependencies

### Plan Types
- \`feature\`: New feature development
- \`bug-fix\`: Bug fixes
- \`refactor\`: Code improvements
- \`system-design\`: Architecture work
- \`research\`: Investigation tasks

### Custom Commands
Use \`/plan [description]\` to create new plan documents with proper structure and frontmatter.
Use \`/track [description]\` to create tracking items (bugs, tasks, ideas).

### Best Practices
- Keep plans focused and actionable
- Update progress and status regularly
- Use clear, descriptive titles
- Tag plans appropriately for easy filtering
- Link related plans in the document body`;
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
<!-- plan-status -->

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
- Explore the tracking system with \`/track [description]\`

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
   * Get current configuration
   */
  getCurrentConfig(): OnboardingConfig | null {
    return this.currentConfig;
  }
}

export default OnboardingService.getInstance();
