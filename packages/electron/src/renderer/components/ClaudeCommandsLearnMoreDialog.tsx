import React from 'react';
import './ClaudeCommandsLearnMoreDialog.css';

interface ClaudeCommandsLearnMoreDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

interface CommandInfo {
  name: string;
  description: string;
}

interface CommandGroup {
  title: string;
  packageName: string;
  commands: CommandInfo[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    title: 'Core',
    packageName: 'Essential for all workflows',
    commands: [
      {
        name: '/plan',
        description: 'Create structured planning documents with progress tracking',
      },
      {
        name: '/track',
        description: 'Log bugs, ideas, tasks, and decisions with unique IDs',
      },
      {
        name: '/mockup',
        description: 'Create visual UI mockups you can draw on',
      },
    ],
  },
  {
    title: 'Developer',
    packageName: 'For software development',
    commands: [
      {
        name: '/analyze-code',
        description: 'Analyze code quality and suggest improvements',
      },
      {
        name: '/write-tests',
        description: 'Generate comprehensive tests for code',
      },
    ],
  },
  {
    title: 'Product Manager',
    packageName: 'For product planning',
    commands: [
      {
        name: '/roadmap',
        description: 'Generate product roadmap from plans and features',
      },
      {
        name: '/user-research',
        description: 'Document user research findings',
      },
    ],
  },
];

export function ClaudeCommandsLearnMoreDialog({
  isOpen,
  onClose,
  onOpenSettings,
}: ClaudeCommandsLearnMoreDialogProps): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="claude-commands-learn-more-overlay" onClick={onClose}>
      <div
        className="claude-commands-learn-more-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="claude-commands-learn-more-header">
          <h2>Claude Commands for Nimbalyst</h2>
          <button
            className="claude-commands-learn-more-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="claude-commands-learn-more-content">
          {/* Introduction */}
          <section className="claude-commands-learn-more-section">
            <p className="claude-commands-learn-more-intro">
              Installing Claude Commands adds slash commands that help Claude
              work better with Nimbalyst. These commands enable structured
              planning, visual mockups, issue tracking, and more.
            </p>
          </section>

          {/* nimbalyst-local folder */}
          <section className="claude-commands-learn-more-section">
            <h3>The nimbalyst-local Folder</h3>
            <p>
              A <code>nimbalyst-local</code> folder will be created in your
              project root to store working documents:
            </p>
            <div className="claude-commands-folder-structure">
              <pre>
{`nimbalyst-local/
├── plans/        # Plan documents (.md)
├── tracker/      # Bugs, ideas, tasks (.md)
├── mockups/      # UI mockups (.mockup.html)
└── existing-screens/  # UI references`}
              </pre>
            </div>
            <p className="claude-commands-learn-more-note">
              This folder is automatically added to <code>.gitignore</code> to
              keep your repository clean and avoid merge conflicts.
            </p>
          </section>

          {/* Slash Commands by Group */}
          {COMMAND_GROUPS.map((group) => (
            <section key={group.title} className="claude-commands-learn-more-section">
              <h3>{group.title}</h3>
              <p className="claude-commands-group-subtitle">{group.packageName}</p>
              <div className="claude-commands-list">
                {group.commands.map((cmd) => (
                  <div key={cmd.name} className="claude-commands-item">
                    <div className="claude-commands-item-header">
                      <code className="claude-commands-item-name">{cmd.name}</code>
                    </div>
                    <p className="claude-commands-item-description">
                      {cmd.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* Additional info */}
          <section className="claude-commands-learn-more-section">
            <p className="claude-commands-learn-more-note">
              Commands work with Claude Code (the agentic coding feature).
              You can manage installed packages in{' '}
              <button
                className="claude-commands-learn-more-link"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              >
                Project Settings
              </button>.
            </p>
          </section>
        </div>

        <div className="claude-commands-learn-more-footer">
          <button
            className="claude-commands-learn-more-btn"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
