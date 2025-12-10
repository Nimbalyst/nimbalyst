# Nimbalyst v0.47.2 Release Notes

This release includes significant improvements to Nimbalyst. We've added a mockup editor, code editor, enhanced performance, and ease of use.  

## **Mockups: Visual Planning with AI**
We've added a powerful new way to plan features visually:
- **Create .mockup.html files** that render as interactive wireframes. Use the `/mockup` command to generate visual plans
- **Draw annotations directly on mockups** (circles, arrows, highlights)
- **AI can see your annotations** and iterate on designs with you
- **Drop your mockups into a document** type /mockup in a document to insert a mockup

## **Coding with Nimbalyst and Claude Code**
We've added a bunch of features for developers to code better with
- **Code Editor** edit your code and see red/green diffs to accept or reject
- **Git status icons** in the file tree show modified/untracked files at a glance
- **Spec-kit and BMAD support** via a few bug fixes to / commands

## **Performance & Polish**
We've made significant improvements to everyday usage:
- **Virtualized AI transcripts** for smooth scrolling in long sessions
- **Lazy-loaded session tabs** so the app starts fast even with many open sessions
- **Better search results** in both project search and slash commands (best matches first)
- **@mention supports CamelCase** **search** so you can more rapidly find matching files

## **Quality of Life Improvements**
Small things that make a big difference:
- **Quit warning** when you have an active AI session running
- **TypeScript files** now show a distinct TS icon
- **Message timestamps** show the date when not from today
- **Click to enlarge** image attachments in AI chat
- **Escape key** closes the attachment viewer

## **Bug Fixes**
We squashed a bunch of annoying bugs:
- Mermaid diagrams no longer show "\[object Object\]" errors
- Table menus position correctly when scrolled
- @ typeahead menu positions correctly when scrolled
- AI input stays focused when switching modes or tabs
- Token usage bar now shows actual usage instead of appearing full
- Fixed bug that was preventing some files from opening consistently

This release represents over 40 internal releases of continuous improvement. Thank you to our alpha testers for their feedback and bug reports.

For the complete technical changelog, see [CHANGELOG.md](CHANGELOG.md).
