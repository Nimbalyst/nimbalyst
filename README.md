# Nimbalyst is the visual workspace for building with Codex and Claude Code

[Nimbalyst](https://nimbalyst.com) is a free, local, interactive visual editor & session manager where builders maximize speed, bandwidth, and context with Codex, Claude Code, Opencode(alpha), Copilot(alpha) by collaborating visually on files, sessions, and tasks:
- Iterate visually with coding agents in your markdown, mockups, diagrams, csv, Excalidraw, data models, and code. Approve the coding agent's changes in red/green WYSIWYG, edit, annotate. 
- Manage multiple sessions in parallel and in kanban. Search, resume, link sessions to files and files to sessions.For developers we include git management, AI commit, workstreams, worktrees, and terminal.
- Manage tasks. Keep track of your plans, bugs, todos, etc..  Have the agent edit tasks and items, add them, move them, and execute them. Human see and edit this as well.
- Extend Nimbalyst. Build your own custom editors and visual interfaces integrated with the rest of Nimbalyst and your agents. 
- Mobile app. Start, manage, and respond to your Codex and Claude Code sessions while on the go.

![Version](https://img.shields.io/github/v/release/nimbalyst/nimbalyst)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)


## Features
<b>Visual Editors:</b> Built-in WYSIWYG editors where you and your coding agents collaborate visually. Approve agent changes as red/green diffs, edit, annotate, and iterate.
- Markdown
- Mockups with annotations
- Mermaid
- Excalidraw
- CSV
- Data Models
- Code with Monaco
  
![Nimbalyst File](https://github.com/Nimbalyst/nimbalyst/blob/main/Nimbalyst%20Hero%20Files%20Dev%20Dark-%20Social.png)

<b>Session Management:</b> Manage coding agents' work across parallel sessions in a UI
- Link sessions to files and files to sessions
- Open files in your sessions. Group files touched by a session
- Run parallel sessions
- Search and resume sessions
- Manage in a Kanban board
  
![Nimbalyst Agent](https://raw.githubusercontent.com/Nimbalyst/nimbalyst/main/Sessions_kanban_dark.webp)

<b>Task Tracking:</b> Keep track of your plans, bugs, features, todos etc..
- Have agent edit tasks, add them, move them, and execute them
- Human view and edit them too

<b>For developers</b>
- Manage git state
- Use AI to git commit
- Use embedded ghostty terminal
- Leverage workstrees
  
![Nimbalyst Agent](https://raw.githubusercontent.com/Nimbalyst/nimbalyst/main/developers-dark.webp)

<b>Mobile app</b>
- Session dashboard: see which agents need you and which are still working
- Reply to questions via text or voice, agents resume immediately
- Visual diff review: swipe through changes, tap to approve
- Queue next tasks: keep the pipeline full, don't let agents sit idle
- Push notifications: agents tell you when they need you

<b>Open</b> storage of content and status in markdown, workflow in / commands, and plain files on disk or in git

<b>Extension system</b>
- Pluggable editors for any file type. Every editor (including built-ins) goes through the same EditorHost contract, so custom editors are first-class.
- Current extensions include an Astro website editor, visual git log, mindmap, slides, and a 3D object editor.
  
![Nimbalyst Agent](https://raw.githubusercontent.com/Nimbalyst/nimbalyst/main/extension-marketplace-dark.png)

<b>Supported coding agents </b>
- Codex
- Claude Code
- Opencode(alpha)
- Copilot(alpha)

## Download

Download the latest version for your platform:

| Platform | Download | Requirements |
| --- | --- | --- |
| macOS Apple Silicon | [Download .dmg](https://github.com/Nimbalyst/nimbalyst/releases/latest/download/Nimbalyst-macOS-arm64.dmg) | macOS Apple Silicon 10.15+ |
| macOS Intel| [Download .dmg](https://github.com/Nimbalyst/nimbalyst/releases/latest/download/Nimbalyst-macOS-x64.dmg) | macOS Apple Silicon 10.15+ |
| Windows | [Download .exe](https://github.com/Nimbalyst/nimbalyst/releases/latest/download/Nimbalyst-Windows.exe) | Windows 10+ |
| Linux | [Download AppImage ](https://github.com/Nimbalyst/nimbalyst/releases/latest/download/Nimbalyst-Linux.AppImage) | Linux |

## Getting Started

1. **Create a new (or open existing) document** - Click "New" or press `Cmd/Ctrl+N`
2. **Write in markdown** - Write/edit in the WYSIWYG editor
3. **Use AI assistant** - Ask AI to research, edit the document, work across your files
4. **Accept/Reject AI changes** - Step through suggested AI edits, accept/reject
5. **Work in Agent Manager** - Switch to the agent manager view and run multiple agent sessions in parallel
6. **Search/Resume sessions** - Search and resume sessions, manage your work

## Auto-Updates

Nimbalyst automatically checks for updates and notifies you when a new version is available. You can also manually check via Help → Check for Updates.

## Bug Reports & Feature Requests

Found a bug or have a feature request? Please [create an issue](https://github.com/nimbalyst/nimbalyst/issues/new/choose).

## Community
- [Documentation](https://docs.nimbalyst.com/) - Watch videos and read documentation
- [Discord](https://discord.gg/FgD9S2MCYB) - Join the discussion on Discord
- [Website](https://nimbalyst.com) - Learn more about Nimbalyst on our website

## License

Nimbalyst is proprietary software. All rights reserved. © 2026 Nimbalyst. 

## Acknowledgments

Built with:
- [Electron](https://electronjs.org/)
- [Lexical](https://lexical.dev/) by Meta
- [React](https://reactjs.org/)

***

**Note**: This is the public releases repository.
