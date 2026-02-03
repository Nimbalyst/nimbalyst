/**
 * Shared plan mode prompt content.
 *
 * This module provides the plan mode instructions that are injected into user messages
 * when entering plan mode. The content is used by:
 * - DocumentContextService (backend path via prepareContext)
 * - SessionTranscript (frontend path via handleSend)
 *
 * Having a single source of truth ensures consistency across both code paths.
 */

/**
 * Build the plan mode instructions prompt.
 * The planFilePath parameter is reserved for future use (e.g., resuming existing plans).
 */
export function buildPlanModeInstructions(_planFilePath?: string): string {
  return `<NIMBALYST_SYSTEM_MESSAGE>
<PLAN_MODE_ACTIVATED>
You are in PLANNING MODE ONLY.

You MUST NOT:
- Make any code edits (except to the plan file)
- Run any non-readonly tools
- Execute any commands
- Make any changes to the system

You MUST:
- Explore the codebase using Read, Glob, Grep tools
- Ask questions using AskUserQuestion to clarify requirements
- Write and iteratively update a plan file in the plans/ directory
- Call ExitPlanMode when ready for approval

## Plan File

You must create a plan file in the plans/ directory. Choose a descriptive kebab-case name based on the task, for example:
- plans/add-dark-mode.md
- plans/refactor-auth-system.md
- plans/fix-login-timeout-bug.md

The plan file is your working document. Create it early in your planning process and update it iteratively as you learn more.

### Required YAML Frontmatter

Every plan file MUST include YAML frontmatter with metadata for tracking:

\`\`\`yaml
---
planStatus:
  planId: plan-[unique-identifier]
  title: [Plan Title]
  status: draft
  planType: [feature|bug-fix|refactor|system-design|research|initiative|improvement]
  priority: medium
  owner: [username]
  stakeholders: []
  tags: []
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"
  progress: 0
---
\`\`\`

## Iterative Planning Workflow

Your goal is to build a comprehensive plan through iterative refinement:

1. Create your plan file in plans/ with a descriptive name
2. Explore the codebase using Read, Glob, and Grep tools
3. Interview the user using AskUserQuestion to clarify requirements
4. Write to the plan file iteratively as you learn more
5. End your turn by either using AskUserQuestion or calling ExitPlanMode when ready

## Visual Mockups

When a plan involves UI components, screens, or visual design, use the \`/mockup\` skill to create mockups. This keeps visual design work separate from planning.

**When to create a mockup:**
- Planning new UI components or screens
- Designing layout and structure
- Changes that need visual feedback before implementation

**When NOT to create a mockup:**
- Backend-only changes
- Refactoring that doesn't change UI
- Bug fixes with obvious solutions
- Infrastructure or configuration changes
- Minor and well-described UI changes where there are no remaining design choices

If a visual mockup would help communicate the plan, tell the user you'll use \`/mockup\` to create one, and do so after completing the plan document.
Make sure the plan document references and links the mockup file using the mockup image syntax, and use your Capture Mockup Screenshot tool to view it once the sub-agent completes and verify that it conforms to the plan.

**Mockup image syntax:**
\`\`\`markdown
![Description](screenshot.png){mockup:path/to/mockup.mockup.html}
\`\`\`

With optional size:
\`\`\`markdown
![Description](screenshot.png){mockup:path/to/mockup.mockup.html}{800x600}
\`\`\`
</PLAN_MODE_ACTIVATED>
</NIMBALYST_SYSTEM_MESSAGE>`;
}

/**
 * The plan mode deactivation message sent when exiting plan mode.
 */
export const PLAN_MODE_DEACTIVATION = '<PLAN_MODE_DEACTIVATED>The planning restrictions no longer apply.</PLAN_MODE_DEACTIVATED>';
