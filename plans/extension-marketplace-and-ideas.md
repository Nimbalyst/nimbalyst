---
planStatus:
  planId: plan-extension-marketplace-and-ideas
  title: Extension Marketplace System + Expanded Extension Ideas
  status: draft
  planType: system-design
  priority: high
  owner: ghinkle
  stakeholders:
    - nimbalyst-team
  tags:
    - extensions
    - marketplace
    - marketing
    - seo
  created: "2026-03-13"
  updated: "2026-03-13T00:00:00.000Z"
  progress: 0
---
# Extension Marketplace System + Expanded Extension Ideas

## Decisions

- **Registry**: Cloudflare Workers API from the start (server-side search, analytics, review workflow)
- **Built-in extensions**: Stay bundled with the app. Marketplace is for additional extensions only.
- **Website**: Existing Astro site at `nimbalyst-website/` -- generate extension pages as a new content collection
- **Deep links**: Plan for `nimbalyst://install/{extensionId}` protocol handler for one-click web install

## Part 1: Marketplace Registry Architecture

Uses Cloudflare Workers + GitHub hybrid approach (detailed in `nimbalyst-local/plans/extension-marketplace.md`). Key additions below.

### Extension Source of Truth

**`nimbalyst/extension-registry`** -- a public GitHub repo containing marketing assets and metadata:

```
extension-registry/
  extensions/
    com.nimbalyst.excalidraw/
      metadata.json      # Extended manifest + marketplace fields
      README.md          # Long description (markdown) - used on website + in-app
      icon.png           # 256x256
      screenshots/       # Gallery images
      changelog.md
    com.nimbalyst.csv-spreadsheet/
      ...
  categories.json        # Category definitions + ordering
  featured.json          # Curated featured list + banners
```

This repo is the **authoring surface** for extension marketing content. On push:
1. GitHub Action syncs metadata to Cloudflare D1 via admin API
2. GitHub Action generates Astro content collection files and opens PR on `nimbalyst-website`

### Cloudflare Workers API

The existing plan covers endpoints well. Additions:

**Install tracking for deep links:**
```
GET /api/extensions/:id/install-redirect
    Returns: { downloadUrl, checksum, version }
    Side effect: Increments install counter
```

**Protocol handler flow:**
```
Web page -> nimbalyst://install/com.nimbalyst.excalidraw
  -> Electron registers protocol handler
  -> Fetches extension metadata from Workers API
  -> Shows install confirmation dialog (name, permissions, size)
  -> Downloads .nimext from GitHub Release
  -> Verifies checksum
  -> Extracts to ~/.nimbalyst/extensions/
  -> Reloads extension system
```

### Built-in vs Marketplace Extensions

Built-in extensions (`packages/extensions/*`) ship with the app and are not in the marketplace. The marketplace is for:
- `https://raw.githubusercontent.com/nimbalyst/extension-registry/main/registry.json`First-party extensions that are optional (themes, niche tools)
- Third-party extensions (future)
- Extensions that update more frequently than the app

Built-in extensions can optionally publish to the marketplace for independent updates, but the bundled version is the default.

---

## Part 2: Marketing Website Generation

### Goal

Auto-generate extension marketing pages for the Nimbalyst Astro website from the same metadata in the registry. Each extension gets a dedicated, SEO-optimized page.

### Architecture

Integrates with the existing Astro site at `/Users/ghinkle/sources/nimbalyst-website/`. The site uses:
- Astro 5.17 + Tailwind CSS 4.2 + Cloudflare Pages
- Content collections with glob loader (`src/content/blog/`, `src/content/devblog/`)
- YAML data files in `src/data/` for page copy
- BaseLayout.astro with OG, Twitter cards, GA4, PostHog already wired
- Pagefind for search, `@astrojs/sitemap` for sitemaps
- Design tokens: `nim-purple` (#4F38E0), `font-heading` (Euclid Circular A), Inter body

**New files in nimbalyst-website:**

```
src/content/extensions/          # New content collection (generated)
  excalidraw.md
  csv-spreadsheet.md
  ...
src/pages/extensions/
  index.astro                    # Browse all extensions
  [slug].astro                   # Individual extension page
  category/[category].astro      # Category listing
src/components/extensions/
  ExtensionCard.astro            # Card for listings (icon, name, desc, install count)
  ExtensionGallery.astro         # Screenshot carousel
  PermissionBadges.astro         # Permission indicators (AI, filesystem, network)
  InstallButton.astro            # nimbalyst://install deep link button
  CategoryNav.astro              # Category filter bar
src/data/extensions.yaml         # Featured list, category definitions, page copy
public/extensions/               # Static assets (icons, screenshots)
  excalidraw/
    icon.png
    screenshot-1.png
```

**Content collection schema** (add to `src/content.config.ts`):

```typescript
const extensions = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/extensions' }),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    author: z.string(),
    version: z.string(),
    categories: z.array(z.string()),
    tags: z.array(z.string()).default([]),
    icon: z.string(),
    screenshots: z.array(z.object({
      src: z.string(),
      alt: z.string(),
    })).default([]),
    permissions: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    downloadUrl: z.string(),
    repositoryUrl: z.string().optional(),
    minimumAppVersion: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  }),
});
```

### Generation Flow

1. **GitHub Action** in `extension-registry` triggers on push to main
2. Runs a Node script that:
  - Reads each `extensions/*/metadata.json` + `README.md`
  - Generates `.md` files with frontmatter for the Astro content collection
  - Copies screenshots to `public/extensions/{slug}/`
  - Opens PR on `nimbalyst-website` repo (or direct push to a `generated` branch)
3. Astro builds pick up the new content and deploy via Cloudflare Pages

### SEO Strategy

**Per-extension page** (`[slug].astro`) -- leverages existing BaseLayout.astro patterns:

```astro
---
// [slug].astro
import BaseLayout from '../../layouts/BaseLayout.astro';
const { name, description, tags, icon, screenshots } = entry.data;
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name,
  description,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Windows, Linux",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  screenshot: screenshots.map(s => `https://nimbalyst.com${s.src}`),
};
---
<BaseLayout
  title={`${name} - Nimbalyst Extension`}
  description={description}
  image={screenshots[0]?.src || icon}
  jsonLd={jsonLd}
>
  <!-- Extension detail page content -->
</BaseLayout>
```

**SEO checklist per extension README:**
- H1 with extension name + "for Nimbalyst"
- Use cases section (targets long-tail searches like "visual csv editor for mac")
- Feature comparison vs alternatives (targets "X vs Y" searches)
- Getting started / installation guide
- Alt text on all screenshots
- Internal links to related extensions

**URL structure:**
```
/extensions/                          # Browse all
/extensions/excalidraw/              # Individual extension
/extensions/category/diagrams/       # Category listing
/extensions/category/developer-tools/
/extensions/category/ai-tools/
```

**Sitemap**: Auto-generated by `@astrojs/sitemap` (already configured). Category pages and extension pages all included automatically.

### Deep Link Protocol Handler

Register `nimbalyst://` protocol in Electron:

```typescript
// In app.whenReady() or main process initialization
app.setAsDefaultProtocolClient('nimbalyst');

// Handle protocol URL
app.on('open-url', (event, url) => {
  // nimbalyst://install/com.nimbalyst.excalidraw
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/install/')) {
    const extensionId = parsed.pathname.replace('/install/', '');
    // Show install confirmation dialog in renderer
    mainWindow.webContents.send('marketplace:install-request', { extensionId });
  }
});
```

**Install button on website:**
```astro
<a href={`nimbalyst://install/${extension.id}`} class="...">
  Install in Nimbalyst
</a>
<noscript>
  <a href="/download">Download Nimbalyst first</a>
</noscript>
```

### Categories

```json
[
  { "id": "diagrams", "name": "Diagrams & Visual Editing", "icon": "brush" },
  { "id": "developer-tools", "name": "Developer Tools", "icon": "code" },
  { "id": "data", "name": "Data & Spreadsheets", "icon": "table" },
  { "id": "ai-tools", "name": "AI-Powered Tools", "icon": "sparkles" },
  { "id": "themes", "name": "Themes & Appearance", "icon": "palette" },
  { "id": "writing", "name": "Writing & Documents", "icon": "pencil" },
  { "id": "project-management", "name": "Project Management", "icon": "kanban" },
  { "id": "integrations", "name": "Integrations", "icon": "plug" },
  { "id": "knowledge", "name": "Knowledge Management", "icon": "brain" },
  { "id": "media", "name": "Media & Creative", "icon": "image" }
]
```

---

## Part 3: Expanded Extension Ideas

Organized by category. Each idea includes the **Nimbalyst advantage** -- why this extension is better in Nimbalyst than as a VSCode extension, Obsidian plugin, or standalone tool.

### Diagrams & Visual Editing

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 1 | **Mermaid WYSIWYG Editor** | Visual editing of Mermaid diagrams with drag-and-drop nodes, live preview, export to SVG/PNG | Custom editor renders the actual diagram; AI can generate/modify mermaid syntax from natural language descriptions | VSCode Mermaid Preview (2M+), Obsidian mind maps |
| 2 | **PlantUML Editor** | Rich UML editing (sequence, class, component, state diagrams) with visual canvas | Bidirectional: edit visually, code updates; edit code, canvas updates. AI generates UML from codebase analysis | VSCode PlantUML (1.5M) |
| 3 | **Flowchart Builder** | Drag-and-drop flowchart creation with smart connectors, decision diamonds, process boxes | AI can generate flowcharts from process descriptions or code logic | Draw.io (3M VSCode) |
| 4 | **Org Chart / Hierarchy Visualizer** | Visual org charts, dependency trees, hierarchy diagrams from structured data | AI can build org charts from team descriptions; editable like Excalidraw | Common request across editors |
| 5 | **Network Topology Diagrammer** | Design network diagrams with standard icons (routers, switches, firewalls, clouds) | AI understands infrastructure; can generate topology from Terraform/CloudFormation | DevOps tooling gap |
| 6 | **D3 Chart Designer** | Interactive chart creation with D3.js - bar, line, scatter, treemap, force-directed graphs | Custom editor with live data binding; AI generates chart code from data description | Data visualization gap |
| 7 | **ASCII Art / Box Drawing** | Visual editor for ASCII diagrams and box-drawing characters | AI can convert hand-drawn descriptions to ASCII art for READMEs and code comments | Various ASCII tools |
| 8 | **Wireframe Kit** | Low-fidelity UI wireframing with standard components (buttons, inputs, cards, navbars) | Already have MockupLM -- this is a lighter-weight version focused on wireframing speed with AI layout suggestions | Excalidraw wireframe lib |
| 9 | **SVG Editor** | Visual SVG path editor with node manipulation, color picker, transform tools | Custom editor for `.svg` files with source mode toggle; AI can create/modify SVGs from descriptions | Inkscape simplified |
| 10 | **Slide Deck Presenter** | Create reveal.js/MDSX presentations from markdown with speaker notes and transitions | Markdown-first; AI helps with slide layout, content summarization, speaker notes generation | Obsidian Advanced Slides (813K), VSCode Markdown Preview Enhanced |
| 11 | **Timeline / Gantt Editor** | Visual timeline and Gantt chart creation from structured data | AI can generate project timelines from descriptions; data persists as editable markdown/JSON | Common project planning gap |
| 12 | **Map Viewer** | Geographic map with markers from geo-tagged notes/data files | Render maps from GeoJSON/coordinate data; AI can geocode text addresses | Obsidian Map View (310K) |

### Data & Spreadsheets

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 13 | **JSON/YAML Visual Editor** | Tree-view and form-based editing of JSON/YAML with schema validation | Custom editor that renders structured data as an interactive tree; AI can transform, query, restructure | VSCode JSON editors |
| 14 | **Parquet/Arrow Viewer** | View columnar data formats (Parquet, Arrow, Avro) with filtering and statistics | Data science files rendered as interactive tables with summary stats | VSCode Data Preview |
| 15 | **SQL Notebook** | Jupyter-style notebooks for SQL queries with inline results, charts, and exports | Each cell runs against connected databases; AI writes and explains queries; results render as charts | Jupyter (100M VSCode) |
| 16 | **GraphQL Explorer** | Interactive GraphQL query builder with schema introspection and result visualization | AI generates queries from natural language; custom editor for `.graphql` files | GraphQL Playground |
| 17 | **Regex Tester** | Visual regex building, testing, and explanation with match highlighting | AI explains and generates regex patterns; live test against sample data | regex101 in-editor |
| 18 | **Log Viewer** | Structured log file viewing with filtering, search, timestamp parsing, and pattern detection | AI can identify error patterns, summarize log sessions, detect anomalies | Various log tools |
| 19 | **Diff Viewer** | Side-by-side or inline diff for any two files with semantic diff for JSON/YAML | AI can explain diffs, suggest which changes are significant | Built-in Monaco diff extended |
| 20 | **Excel/XLSX Editor** | Full spreadsheet editing for Excel files (not just CSV) with formula support | Custom editor maintains Excel formatting/formulas; AI assists with formulas | VSCode Excel Viewer (5M) |
| 21 | **Database Schema Visualizer** | ERD visualization from live database connections or migration files | Reads Prisma/Drizzle/Knex schemas or connects to live DBs; AI suggests schema improvements | DataModelLM enhanced |

### Developer Tools

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 22 | **HTTP Client** | Send HTTP requests from `.http` files with environment variables, auth, response visualization | Requests are git-committable text files; AI generates requests from API docs or curl commands; response renders as formatted JSON | VSCode REST Client (6M), Thunder Client (8M) |
| 23 | **Docker Compose Visualizer** | Visual diagram of docker-compose services, networks, and volumes with health status | Custom editor for `docker-compose.yml` with both visual and source views; AI helps configure services | VSCode Docker (46M) |
| 24 | **OpenAPI / Swagger Editor** | Visual API design with schema editor, endpoint tree, and live preview | Bidirectional editing of `.yaml`/`.json` OpenAPI specs; AI generates endpoints from descriptions | Swagger Editor |
| 25 | **Terraform Visualizer** | Graph visualization of Terraform resources and their relationships | Parse `.tf` files into interactive dependency graphs; AI helps write Terraform configs | VSCode Terraform (5M) |
| 26 | **CI/CD Pipeline Editor** | Visual editor for GitHub Actions, CircleCI, GitLab CI workflows | Custom editor for `.yml` workflow files with drag-and-drop steps; AI suggests optimizations | VSCode GitHub Actions (2M) |
| 27 | **Dependency Graph** | Visualize npm/pip/cargo dependency trees with vulnerability indicators | Parse lockfiles into interactive trees; highlight outdated/vulnerable packages; AI suggests updates | npm audit visual |
| 28 | **Environment Manager** | Visual `.env` file editor with secret masking, validation, and cross-env comparison | Custom editor for `.env` files with type hints; AI helps identify missing vars vs example files | dotenv tools |
| 29 | **Cron Expression Builder** | Visual cron schedule builder with human-readable descriptions and next-run preview | AI translates between natural language ("every weekday at 9am") and cron syntax | crontab.guru |
| 30 | **Changelog Generator** | Auto-generate changelogs from git history with conventional commit parsing | AI summarizes commits into user-friendly release notes; custom editor for CHANGELOG.md | Conventional Commits tools |
| 31 | **Monorepo Navigator** | Visualize workspace package relationships, shared dependencies, build order | Parse package.json workspaces into dependency graph; AI helps with cross-package refactoring | Nx/Turborepo tools |
| 32 | **Port Scanner / Service Monitor** | Dashboard showing local running services, ports, and health checks | Panel showing what's running on localhost; quick links to open in browser | DevOps dashboards |
| 33 | **Snippet Manager** | Personal code snippet library with syntax highlighting, tagging, and search | AI helps categorize and find relevant snippets; snippets are markdown files in a collection | VSCode Snippet Manager |
| 34 | **Error Lens** | Inline error/warning display at end of lines in code editors | Real-time diagnostic rendering without hovering; AI can explain and fix errors | VSCode Error Lens (10M) |

### AI-Enhanced Tools

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 35 | **Context7 / Doc Injector** | Inject version-specific library documentation into AI context | Gives AI accurate, up-to-date docs for the exact library versions in your project | Context7 MCP (top MCP server) |
| 36 | **AI Prompt Library** | Curated and custom prompt templates for common tasks (code review, refactoring, testing) | Templates integrate with Nimbalyst's slash command system; community-shared prompts | Claude Code skills ecosystem |
| 37 | **Token / Context Visualizer** | Visual breakdown of what's consuming context window space | Charts showing token usage by: system prompt, conversation history, tool results, files read | CC Usage tools, community demand |
| 38 | **Smart Connections** | AI-powered note linking that finds semantically related documents across your workspace | Embeddings-based similarity search across all workspace files; surfaces connections you'd miss | Obsidian Smart Connections (852K) |
| 39 | **AI Code Review** | Automated code review on staged changes with security, performance, and style analysis | Reviews git diff with context from the full codebase; produces actionable suggestions | SonarQube, various AI review tools |
| 40 | **Test Generator** | AI-generated unit tests from source code with framework detection | Understands project testing patterns (vitest/jest/pytest); generates tests matching existing style | EarlyAI (VSCode rising) |
| 41 | **Documentation Generator** | Auto-generate API docs, JSDoc comments, README sections from code | AI reads code and generates documentation matching project conventions; renders preview | Various doc generators |
| 42 | **Commit Message Composer** | AI-generated commit messages from staged diffs following project conventions | Already have developer extension -- this is an enhanced version with conventional commit support, multi-language | Conventional Commits (1M VSCode) |
| 43 | **Meeting Notes Transcriber** | Audio-to-document transcription with automatic summarization and action item extraction | Records audio, transcribes, AI extracts action items/decisions into structured notes | Obsidian meeting plugins, Granola |
| 44 | **AI Writing Assistant** | Inline writing suggestions, grammar checking, tone adjustment, simplification | Works in Lexical documents with inline suggestions; AI rewrites selected text | Grammarly-style, Obsidian Text Generator (500K) |
| 45 | **Codebase Q&A** | Chat interface specifically for asking questions about the current codebase | RAG over workspace files with embeddings; answers with file references | Sourcegraph Cody (1M VSCode) |

### Knowledge Management

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 46 | **Wiki Links / Backlinks** | `[[wiki-style]]` linking between documents with backlink panel | Lexical editor integration for clickable wiki links; AI can suggest relevant links as you write | Obsidian core feature, Foam (500K VSCode) |
| 47 | **Graph View** | Interactive force-directed graph of document links and relationships | Visual knowledge graph; click nodes to navigate; AI can identify clusters and orphaned notes | Obsidian Graph View (core) |
| 48 | **Dataview / Query Engine** | Query workspace files by frontmatter, tags, dates; render as tables or lists | Treat markdown files as a database; AI writes queries in natural language | Obsidian Dataview (3.8M) |
| 49 | **Tag Manager** | Bulk rename, merge, and organize tags across all workspace files | Panel showing all tags with usage counts; batch operations; AI suggests tag taxonomies | Obsidian Tag Wrangler (907K) |
| 50 | **Daily Notes / Journal** | Daily note templates with automatic creation, calendar navigation, and periodic reviews | Calendar panel for navigation; AI summarizes weekly/monthly activity; template system | Obsidian Calendar (2.4M) + Periodic Notes (750K) |
| 51 | **Readwise / Highlights Sync** | Import highlights from Kindle, web articles, PDFs into workspace documents | Sync highlights as markdown files; AI can synthesize themes across highlights | Obsidian Readwise (300K) |
| 52 | **Zettelkasten System** | Fleeting/literature/permanent note workflow with unique IDs and linking | Structured note-taking workflow; AI helps refine fleeting notes into permanent ones | Obsidian Zettelkasten plugins |
| 53 | **Omnisearch** | Full-text search across workspace with fuzzy matching, OCR on images/PDFs | Search inside PDFs, images (via OCR), all document types; AI-powered semantic search option | Obsidian Omnisearch (1.3M) |
| 54 | **Bookmarks / Favorites** | Quick-access panel for frequently used files, folders, and line locations | Sidebar panel with pinned items; keyboard shortcuts for jumping to bookmarks | VSCode Bookmarks (4M) |

### Project Management & Productivity

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 55 | **Kanban Board** | Markdown-backed kanban boards with drag-and-drop columns and cards | Cards are actual files/tasks; AI can auto-triage, suggest priorities, move items based on git activity | Obsidian Kanban (2.2M) |
| 56 | **Pomodoro Timer** | Focus timer with session notes, break reminders, and productivity stats | Panel with timer; auto-links focus sessions to the file you're working on; AI summarizes what you accomplished | Obsidian Pomodoro plugins |
| 57 | **OKR / Goal Tracker** | Define objectives and key results with progress tracking and check-in templates | Structured data files rendered as progress dashboards; AI helps write OKRs and suggests check-in content | Notion-style goal tracking |
| 58 | **Standup Report Generator** | Auto-generate standup reports from git activity, completed tasks, and planned work | Reads git log, tracker items, and calendar; AI composes concise standup summaries | Already have automation for this -- make it a first-class panel |
| 59 | **Time Tracker** | Track time spent on files, projects, and tasks with reporting | Automatic time tracking based on active files; dashboard with charts; export for invoicing | WakaTime (22M VSCode) |
| 60 | **Habit Tracker** | Daily habit tracking with streaks, charts, and GitHub-style contribution heatmaps | Custom editor for habit files; AI provides accountability and suggests improvements | Obsidian Life Tracker (rising) |
| 61 | **Sprint Board** | Agile sprint planning with story points, velocity charts, and burndown | Integrates with Linear/GitHub Issues; AI helps with sprint planning and estimation | Jira-like in-editor |

### Integrations

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 62 | **GitHub Dashboard** | PR status, issue management, Actions status, and review queue in a panel | AI helps with PR reviews, generates descriptions, suggests reviewers | VSCode GitHub (3.1M MCP installs) |
| 63 | **Linear Integration** | View and manage Linear issues, create issues from code comments, link sessions to tickets | Already have Linear MCP -- make it a visual panel with board views and AI-powered issue creation | Linear MCP |
| 64 | **Slack Notifier** | Send/receive Slack messages, share code snippets, get notified of mentions | AI can compose messages, summarize threads; send code with syntax highlighting | Various Slack integrations |
| 65 | **Notion Sync** | Bidirectional sync between Nimbalyst markdown and Notion pages | Convert between Nimbalyst markdown and Notion blocks; AI handles format differences | Obsidian Importer (1.1M) |
| 66 | **Obsidian Vault Compat** | Read/write Obsidian vaults with wiki links, callouts, and plugin data | Nimbalyst as an alternative Obsidian frontend with AI superpowers | Migration opportunity |
| 67 | **Google Docs Import/Export** | Import Google Docs as markdown, export back with formatting preserved | AI handles format conversion edge cases; round-trip editing | Common request |
| 68 | **Webhook Manager** | Visual webhook configuration, testing, and logging | Custom editor for webhook configs; AI helps write transformation functions | Integration tooling |
| 69 | **RSS Feed Reader** | Subscribe to feeds, read articles inline, save to workspace | Panel with feed reader; AI summarizes articles; save quotes/highlights to notes | Obsidian RSS plugins |
| 70 | **Todoist / Things Sync** | Bidirectional task sync with popular task managers | Sync tasks as markdown checkboxes; AI helps process inbox items | Obsidian Todoist (550K) |
| 71 | **Apple Shortcuts / Automator** | Trigger Apple Shortcuts from Nimbalyst or trigger Nimbalyst actions from Shortcuts | Bidirectional automation bridge; AI can help build shortcut workflows | macOS-native integration |
| 72 | **Sentry Error Browser** | View and manage Sentry errors, link to source code, create issues from errors | Panel showing recent errors; click to jump to source; AI helps diagnose and fix | Sentry MCP |

### Writing & Documents

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 73 | **Longform / Novel Writer** | Chapter-based manuscript management with word count goals, compile-to-export | Lexical editor with chapter navigation; AI helps with continuity, character tracking, plot holes | Obsidian Longform (450K) |
| 74 | **Academic Paper Writer** | LaTeX-style math, citations, bibliography management, journal templates | Lexical editor with math rendering; AI helps with literature review, citation formatting | Academic writing tools |
| 75 | **Blog Publisher** | Write in Nimbalyst, publish to Medium, Dev.to, Ghost, WordPress | AI optimizes for each platform's formatting; schedule posts; track engagement | Publishing integrations |
| 76 | **Spell Checker / Linter** | Grammar, spelling, and style checking with configurable rules | Inline suggestions in Lexical editor; AI explains grammar rules; supports code-aware checking (camelCase) | VSCode Code Spell Checker (8M), Obsidian Linter (833K) |
| 77 | **Translation Helper** | Translate documents or selections between languages | AI-powered translation that preserves markdown formatting and technical terms | Internationalization need |
| 78 | **Pandoc Export** | Export markdown to Word, PDF, LaTeX, ePub, HTML with template support | One-click export via Pandoc; AI helps with format-specific adjustments | Obsidian Pandoc (480K) |
| 79 | **Typewriter Mode** | Focused writing with centered current line, fading context, and ambient sounds | Custom Lexical editor mode; AI provides real-time writing feedback | Obsidian writing plugins |
| 80 | **Citation Manager** | BibTeX/CSL citation management with inline citation insertion | Custom editor for `.bib` files; Lexical plugin for citation insertion; AI finds and formats citations | Zotero integration |

### Themes & Appearance

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 81 | **Theme Studio** | Visual theme designer with live preview and export | Interactive color picker for all `--nim-*` variables; live preview across all editor types | Obsidian Style Settings (2.2M), Custom Theme Studio |
| 82 | **Icon Pack Manager** | Custom file icons for the file tree (Material, Catppuccin, Seti, etc.) | Extension file icons contribution already supported; create curated packs | VSCode Material Icons (20M), Obsidian Iconize (1.9M) |
| 83 | **Font Manager** | Browse and apply coding/writing fonts with preview | Preview fonts across editors before applying; AI suggests font pairings | Typography tools |
| 84 | **Monokai Theme** | Classic Monokai color scheme | Low-effort, high-demand theme extension | VSCode theme extensions (millions of installs collectively) |
| 85 | **Catppuccin Theme** | Popular pastel theme (Latte, Frappe, Macchiato, Mocha variants) | Community favorite across editors | Catppuccin everywhere |
| 86 | **Nord Theme** | Arctic-inspired color palette | Clean, popular theme | Nord everywhere |
| 87 | **Dracula Theme** | Dark theme with vibrant colors | One of the most popular themes across all editors | Dracula everywhere |
| 88 | **One Dark Pro** | Atom's iconic dark theme | Massive VSCode install base shows demand | VSCode One Dark (15M+) |

### Media & Creative

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 89 | **Color Palette Generator** | Generate, preview, and export color palettes (CSS variables, Tailwind config) | AI generates palettes from descriptions ("warm earth tones for a coffee shop app"); export directly to code | Design tools |
| 90 | **Icon Library Browser** | Search and use icons from Lucide, Heroicons, Font Awesome, Material with copy-to-clipboard | Panel with icon search; click to insert SVG/component code; AI suggests icons for use cases | Various icon tools |
| 91 | **Font Awesome Picker** | Browse and insert Font Awesome icons with class/component syntax | Quick-pick panel with category browsing and search | Icon tools |
| 92 | **Image Optimizer** | Compress, resize, and convert images in-place with quality preview | Right-click images in file tree to optimize; shows before/after size comparison | Build optimization tools |
| 93 | **Audio Waveform Viewer** | Visualize and annotate audio files with waveform display | Custom editor for audio files; useful for podcast editing, music production notes | Audio production tools |
| 94 | **Video Thumbnail Generator** | Generate thumbnails from video files with timestamp selection | Custom viewer for video files; AI suggests best frames for thumbnails | Content creator tools |
| 95 | **QR Code Generator** | Generate QR codes from text, URLs, or data with customization | AI generates QR codes for various data types; export as SVG/PNG | Utility tool |

### DevOps & Infrastructure

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 96 | **Kubernetes Dashboard** | Cluster visualization with pod status, logs, and resource management | Panel with live cluster state; AI helps debug pod issues, suggests resource limits | VSCode Kubernetes (5M) |
| 97 | **AWS Resource Browser** | Browse S3, Lambda, DynamoDB, CloudWatch from within the editor | Panel with tree-view of AWS resources; AI helps write IAM policies, debug Lambda issues | VSCode AWS Toolkit (2M) |
| 98 | **Cloudflare Dashboard** | Manage Workers, Pages, D1, R2 from within the editor | Particularly relevant since Nimbalyst's own infra uses Cloudflare; AI helps with Worker code | Cloudflare integration |
| 99 | **Server Monitor** | Dashboard showing server metrics (CPU, memory, disk, network) | Real-time panel with charts; AI alerts on anomalies | Monitoring tools |
| 100 | **SSL Certificate Manager** | Check SSL cert expiry, generate CSRs, manage Let's Encrypt | Panel showing cert status; AI helps with cert renewal and troubleshooting | DevOps utility |

### Mobile & IoT

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 101 | **HomeKit Controller** | Control HomeKit devices, create automations, view device state | Already have MCP tools -- make a visual panel with room layouts and device controls | Existing HomeKit MCP |
| 102 | **MQTT Dashboard** | Connect to MQTT brokers, subscribe to topics, visualize messages | Panel with live message stream; AI helps write MQTT client code | IoT development tools |
| 103 | **Bluetooth LE Explorer** | Scan and interact with Bluetooth devices, view GATT services | Panel for BLE device debugging; AI helps decode characteristic values | IoT development tools |
| 104 | **3D Model Viewer** | View and inspect 3D models (OBJ, GLTF, STL) with rotation and lighting | Custom editor already in nimbalyst-three-d project -- bring it into the extension system | 3D development tools |

### Finance & Business

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 105 | **Invoice Generator** | Create professional invoices from structured data with PDF export | Custom editor for invoice files; AI auto-fills from project/client data; PDF export | Freelancer tools |
| 106 | **Expense Tracker** | Track project expenses with receipt photos, categorization, and reports | Custom editor with spreadsheet-like entry; AI categorizes expenses; chart reports | Small business tools |
| 107 | **Stock / Crypto Ticker** | Real-time price display for watched securities with charts | Panel with live data; AI provides market context and analysis | Financial tools |

### Education & Learning

| # | Extension Idea | Description | Nimbalyst Advantage | Inspired By |
| --- | --- | --- | --- | --- |
| 108 | **Flashcard System** | Spaced repetition flashcards generated from notes and code | AI generates flashcards from documentation/notes; tracks learning progress with SR algorithm | Obsidian Spaced Repetition plugin |
| 109 | **Interactive Tutorial Builder** | Create step-by-step coding tutorials with executable examples | Like Nimbalyst's walkthrough system but for end-user content; AI generates tutorials from codebases | Educational content tools |
| 110 | **Code Playground** | Run code snippets in sandboxed environments for multiple languages | Quick experimentation without project setup; AI helps write and explain code | VSCode Code Runner (10M) |

### Nimbalyst-Unique Opportunities

These ideas leverage Nimbalyst's specific strengths that other editors lack:

| # | Extension Idea | Description | Why Only Nimbalyst |
| --- | --- | --- | --- |
| 111 | **Session Analytics Dashboard** | Visualize AI session patterns, cost tracking, productivity metrics across all sessions | Nimbalyst has the session history database; no other editor tracks AI sessions this deeply |
| 112 | **Workstream Burndown** | Track multi-session projects with burndown charts, velocity metrics, completion estimates | Workstream architecture is unique to Nimbalyst; sessions-as-work-units is novel |
| 113 | **Extension Builder** | Visual extension scaffolding with live preview, manifest editor, and one-click publish | Nimbalyst can dog-food its own extension system -- build extensions for Nimbalyst inside Nimbalyst |
| 114 | **AI Session Replay** | Replay AI sessions step-by-step to review decisions, learn patterns, or create tutorials | Session transcript data is uniquely rich in Nimbalyst; could generate video/GIF walkthroughs |
| 115 | **Cross-File Refactoring Visualizer** | Visualize the impact of a refactoring across multiple files before committing | Combines file watcher, diff preview, and AI analysis -- all Nimbalyst strengths |
| 116 | **Document-First API Designer** | Design APIs by writing documentation first, then generate server/client code | Lexical editor for writing API docs; AI generates OpenAPI spec + implementation from prose |
| 117 | **Multi-Format Note Hub** | Single note that embeds multiple editor types inline (markdown + spreadsheet + diagram + code) | Nimbalyst's extension system allows multiple editor types -- compose them in one document |
| 118 | **AI Pair Programming Replay** | Record and share pair programming sessions between human and AI | Unique to AI-native editors; could become a learning/teaching platform |
| 119 | **Workspace Template Marketplace** | Pre-configured workspace setups (blog, SaaS, research, novel) with file structure, extensions, and AI prompts | Nimbalyst workspaces + extensions + AI config = shareable development environments |
| 120 | **AI-Powered File Organization** | AI suggests file organization, detects duplicates, proposes folder structure improvements | Combines file tree access with AI understanding of content -- uniquely powerful in Nimbalyst |

---

## Part 4: Priority Recommendations

### Highest-Impact Extensions to Build First

Based on cross-referencing popularity data from VSCode, Obsidian, and Claude Code ecosystems:

**Tier 1 -- Build ASAP (massive demand, strong Nimbalyst advantage):**
1. **Theme Pack** (Catppuccin, Dracula, Nord, One Dark) -- Themes are the #1 way users personalize editors. Low effort, high install count.
2. **HTTP Client** -- REST Client model (`.http` files) with AI-generated requests. Thunder Client has 8M installs. The git-committable text file approach fits perfectly.
3. **Wiki Links + Backlinks** -- Turns Nimbalyst into a knowledge base. Obsidian's core differentiator that draws millions. Lexical plugin + panel.
4. **Mermaid WYSIWYG** -- Diagrams-as-code is massive (2M+ VSCode Mermaid installs). Nimbalyst's custom editor system makes this a visual editor, not just a previewer.

**Tier 2 -- Build Soon (strong demand, good fit):**
5. **JSON/YAML Visual Editor** -- Universal need, great custom editor candidate
6. **Docker Compose Visualizer** -- 46M Docker installs in VSCode; visual compose editing is underserved
7. **Slide Deck Presenter** -- 813K Obsidian Advanced Slides; markdown-to-presentation is a killer workflow
8. **Daily Notes / Calendar** -- 2.4M Calendar installs in Obsidian; this is table-stakes for knowledge work

**Tier 3 -- Build for Differentiation (unique to Nimbalyst):**
9. **Session Analytics Dashboard** -- No other editor has this
10. **AI Prompt Library** -- The Claude Code skills ecosystem is exploding; Nimbalyst can be the home for it
11. **Extension Builder** -- Dog-food the extension system; make it easy for others to build
12. **3D Model Viewer** -- Already have nimbalyst-three-d; ship it as an extension

---

## Open Questions

1. **Extension naming convention**: `com.nimbalyst.*` for first-party, `com.{github-username}.*` for third-party? Or simpler like `@nimbalyst/excalidraw`?
2. **Website generation trigger**: Automatic CI on registry push, or manual trigger for editorial control?
3. **Extension dependencies**: Should extensions be able to depend on other extensions?
4. **Breaking changes**: How do we handle extensions that break with app updates? Grace period? Auto-disable?
5. **Revenue sharing**: If we ever monetize premium extensions, what split for third-party authors?
6. **Security scanning**: What level of automated scanning for third-party extensions? (static analysis, sandbox testing, manual review)
