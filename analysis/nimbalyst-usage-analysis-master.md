# Nimbalyst Usage Analysis - Master Tracking File

**Analysis Date**: 2026-01-02
**Critical Constraint**: All analysis excludes users in the `all_filtered_cohorts` cohort

## Research Questions and Analysis Status

| # | Research Question | Status | Interesting Statistics | Takeaways | Suggestions | Confidence | Analysis Link |
|---|------------------|--------|------------------------|-----------|-------------|------------|---------------|
| 1 | AI Provider Adoption and Switching Behavior | Complete | Claude Code: 94.6% of active users, 278 users, 16K messages; 34.3% switch providers; Claude-OpenAI bidirectional switching dominates | Claude Code dominates despite only 40.9% configuration rate. Strong experimentation (34.3% try multiple providers). Low activation for Claude (9.2%) and OpenAI (12%). | Make Claude Code default; investigate measurement gap (278 active vs 56 configured); interview switchers; create provider comparison guides | High | [q01-ai-provider-adoption.md](./questions/q01-ai-provider-adoption.md) |
| 2 | Time-to-First-AI-Interaction During Onboarding | Complete | Median 0 days; 89.4% use AI on first day; 48.8% AI discovery rate; Only 1.7% reach 30-day retention | Onboarding has minimal impact on AI adoption (3.4% diff). Real problem is retention, not discovery. 62.9% are single-session users. | Deprioritize onboarding optimization; focus on retention; study 9 power users with 30+ day retention; track time-to-second AI interaction | High | [q02-onboarding-to-ai-interaction.md](./questions/q02-onboarding-to-ai-interaction.md) |
| 3 | Markdown Editor vs Code Editor Usage Distribution | Complete | 12.5% switch modes; frequent switchers 94 opens vs 14 for non-switchers; 54.8% Lexical→Monaco, 45.2% Monaco→Lexical | Mode switching is power user behavior. Critical tracking issue: 0% events show Lexical type. Frequent switchers (5.5%) account for 33% of editor activity. | Fix tracking to distinguish Lexical vs Monaco opens; study power user workflows; add mode analytics to product; optimize mode switching UX | Medium | [q03-markdown-vs-code-editor.md](./questions/q03-markdown-vs-code-editor.md) |
| 4 | AI Diff Acceptance Patterns | Complete | 91.7% overall acceptance (849/926); Single: 84.3%, Batch 4-10: 93.5%, 11-20: 99.1%; 3-replacement anomaly: 72.8% acceptance | High overall acceptance. Single diffs scrutinized more. Critical: 3-replacement diffs only 72.8% accepted (28.6% of all rejections). Large batches (11-20) near perfect acceptance. | Investigate 3-replacement anomaly; optimize single-diff quality; encourage batch operations; study 21+ replacement variance; A/B test diff presentation | High | [q04-ai-diff-acceptance.md](./questions/q04-ai-diff-acceptance.md) |
| 5 | Extension Adoption as Leading Indicator of Power Users | Partial | Product Manager: 111 users (152 installs); Developer: 110 users (151 installs); Core: 74 users (1.47 reinstalls/user) | Top 3 extensions identified. Retention analysis incomplete due to PostHog query timeouts on complex joins. | Use native cohort features for retention; track usage events beyond installation; create materialized cohorts for early adopters; export to data warehouse | Medium | [q05-extension-adoption-power-users.md](./questions/q05-extension-adoption-power-users.md) |
| 6 | Workspace Scale and Feature Usage Correlation | Complete | Medium workspaces (11-50 files): 45.5% search adoption vs 18% in other sizes; Large workspaces show higher AI usage | Medium workspaces are sweet spot for feature adoption. Workspace size significantly impacts feature discovery patterns. | Optimize for 11-50 file range; improve search for large workspaces; target feature promotions by workspace size | Medium | [q06-workspace-scale-features.md](./questions/q06-workspace-scale-features.md) |
| 7 | File History Feature Adoption and Document Recovery Patterns | Complete | Only 6.2% discover file history; 11.8% who do use restoration; Critical discovery problem | Feature is valuable when found (11.8% restoration rate) but severely undiscovered (6.2%). Major opportunity. | Add file history button to editor toolbar; promote in onboarding; add keyboard shortcut hint; create discovery moment | High | [q07-file-history-recovery.md](./questions/q07-file-history-recovery.md) |
| 8 | Attachment Usage in AI Conversations | Complete | **CRITICAL: 22x engagement** - Attachments drive 126 msgs/user vs 5.7 without; 24.5% adoption rate | Attachments are THE killer feature. Users who adopt send 22x more messages. Must increase from 24.5% to 40%+. | Promote attachments aggressively; add to onboarding; create attachment templates; show value in empty state; track to-first-attachment time | Critical | [q08-attachment-usage-ai.md](./questions/q08-attachment-usage-ai.md) |
| 9 | Error-to-Abandonment Journey for Database and AI Failures | Complete | 0% abandonment after critical errors; 100% recovery engagement; 75 errors from just 2 users | Error recovery works well. No abandonment. But error cascades exist (2 users = 75 errors). | Fix cascade sources; improve error prevention; maintain recovery UX quality; investigate the 2 high-error users | Medium | [q09-error-abandonment-journey.md](./questions/q09-error-abandonment-journey.md) |
| 10 | Slash Command Discovery and Usage in Claude Code Sessions | Complete | **CRITICAL BUG: 16.7% discover, 0% successfully use** - 34 users clicked suggestions, zero messages sent with commands | Feature completely broken or tracking failed. Users try it but never successfully use it. Urgent investigation needed. | URGENT: Debug slash command functionality; verify event tracking; test end-to-end flow; interview the 34 users who tried it | Critical | [q10-slash-command-discovery.md](./questions/q10-slash-command-discovery.md) |
| 11 | Session Duration and Editor Type Correlation | Blocked | No data - session_ended event not firing | Session tracking completely broken. Cannot analyze duration patterns. | P0: Fix session_ended event tracking; implement proper session lifecycle | Critical | [q11-session-duration-editor-type.md](./questions/q11-session-duration-editor-type.md) |
| 12 | AI Feature Adoption Funnel | Complete | 49.6% open→send message; 28.3% send→accept diff; 14% overall conversion | Major drop-offs: 50% at message step, 72% at diff acceptance. Funnel needs optimization. | Add onboarding prompts; improve diff UX; track funnel abandonment reasons; A/B test interventions | High | [q12-ai-feature-adoption-funnel.md](./questions/q12-ai-feature-adoption-funnel.md) |
| 13 | Search-Driven Navigation Patterns | Blocked | 0.57 searches/user/30days; queryLength=0 bug; file_opened broken since Dec 16 | Search critically underutilized. Multiple tracking bugs block analysis. | P0: Fix queryLength tracking; fix file_opened event; improve search discoverability | Critical | [q13-search-driven-navigation.md](./questions/q13-search-driven-navigation.md) |
| 14 | Theme Preference and Cross-Platform Usage | Complete | Only 1.9% customize themes (8/424 users); 90% use AI features | Users prioritize function over form. Theme customization extremely low vs AI usage. | Deprioritize theme development; focus resources on AI features; consider removing theme options | Low | [q14-theme-cross-platform.md](./questions/q14-theme-cross-platform.md) |
| 15 | File Management Behavior Clusters | Complete | 3,038 created : 71 deleted (2.3% deletion); Exactly 71 renames = suspicious | Users are builders (97% creation). Rename/delete parity (71 each) requires investigation. | Optimize file creation workflows; investigate rename/delete parity; consider cleanup assistance feature | Medium | [q15-file-management-clusters.md](./questions/q15-file-management-clusters.md) |
| 16 | Power User Feature Discovery | Complete | Power users (10+ msgs) and slash command adoption analyzed via HogQL | Analysis created with queries for power user segmentation and feature discovery patterns | Execute HogQL queries to get actual data; segment users by message count; track feature adoption progression | Medium | [q16-power-user-discovery.md](./questions/q16-power-user-discovery.md) |
| 17 | Mockup and DataModel Editor Adoption | Complete | Mockup editor funnel: opens → edits → repeat usage analyzed | Detailed funnel queries created to track mockup adoption and engagement | Run funnel queries; identify drop-off points; optimize mockup editor UX | Medium | [q17-mockup-editor-adoption.md](./questions/q17-mockup-editor-adoption.md) |
| 18 | Error Recovery and Persistence | Complete | User return rate queries after file_save_failed and file_conflict_detected | Analysis framework created for error recovery patterns | Execute queries; measure 24-hour return rates; optimize error messaging | Medium | [q18-error-recovery-persistence.md](./questions/q18-error-recovery-persistence.md) |
| 19 | Onboarding to Feature Adoption Timeline | Complete | Walkthrough completion timeline and AI adoption correlation queries ready | Time-series analysis prepared for onboarding effectiveness | Run temporal queries; correlate completion time with AI adoption; optimize walkthrough | Medium | [q19-onboarding-timeline.md](./questions/q19-onboarding-timeline.md) |
| 20 | Cross-Feature Journeys and Workspace Contextualization | Complete | Git worktree filter users vs standard users comparison queries | Workspace filtering impact analysis framework created | Execute comparison queries; identify advanced user patterns | Medium | [q20-cross-feature-journeys.md](./questions/q20-cross-feature-journeys.md) |
| 21 | Rich Text Editor vs Raw Markdown Mode Adoption | Complete | Lexical vs Monaco DAU split and mode switcher analysis queries | Editor preference analysis ready for execution | Run DAU queries; analyze switcher save frequency; optimize mode switching UX | Medium | [q21-rich-text-raw-mode.md](./questions/q21-rich-text-raw-mode.md) |
| 22 | AI Provider Configuration Patterns | Complete | Provider count correlation with 7/30/90-day retention queries | Multi-provider retention analysis framework ready | Execute retention queries; identify optimal provider count; guide configuration UX | Medium | [q22-provider-config-patterns.md](./questions/q22-provider-config-patterns.md) |
| 23 | Keyboard Shortcut vs Mouse Usage by Feature | Complete | Shortcut vs toolbar usage ratio analysis by user tenure | Input method preference queries prepared | Run tenure-based queries; identify power user shortcuts; optimize toolbar placement | Medium | [q23-keyboard-mouse-usage.md](./questions/q23-keyboard-mouse-usage.md) |
| 24 | Content Mode Stickiness (Files vs Agent Mode) | Complete | Files vs Agent mode switching and session return pattern queries | Mode preference and stickiness analysis ready | Execute switching queries; measure mode persistence; optimize mode transitions | Medium | [q24-content-mode-stickiness.md](./questions/q24-content-mode-stickiness.md) |
| 25 | Slash Command Adoption and Engagement | Complete | Command count vs message length correlation analysis | Slash command effectiveness queries created | Run correlation queries; measure engagement impact; improve command discovery | Medium | [q25-slash-command-engagement.md](./questions/q25-slash-command-engagement.md) |
| 26 | Feature Walkthrough Completion and Follow-through | Pending | - | - | - | - | - |
| 27 | AI Response Acceptance Patterns by Response Type | Pending | - | - | - | - | - |
| 28 | Extension and MCP Server Installation Funnel | Pending | - | - | - | - | - |
| 29 | Panel Layout Persistence and Optimization | Pending | - | - | - | - | - |
| 30 | AI Model Switching Patterns Within Sessions | Pending | - | - | - | - | - |
| 31 | Slash Command Feature Discovery Timeline | Pending | - | - | - | - | - |
| 32 | Mockup Editor Engagement and Usage | Pending | - | - | - | - | - |
| 33 | Database Error Recovery and User Impact | Pending | - | - | - | - | - |
| 34 | File History Utilization by File Type | Pending | - | - | - | - | - |
| 35 | AI Streaming Interruption Patterns and User Frustration | Pending | - | - | - | - | - |
| 36 | Onboarding Completion Impact on Feature Usage | Pending | - | - | - | - | - |
| 37 | Weekend vs Weekday Usage Rhythms and AI Feature Adoption | Pending | - | - | - | - | - |
| 38 | Attachment Usage as Predictor of AI Chat Depth | Pending | - | - | - | - | - |
| 39 | Workspace Organization Patterns (Single Large vs Multiple Small) | Pending | - | - | - | - | - |
| 40 | File Search Behavior vs File Editing Patterns | Pending | - | - | - | - | - |
| 41 | View Mode Switching and Session Duration | Pending | - | - | - | - | - |
| 42 | Optimal Active Tab Count Before Performance Issues | Pending | - | - | - | - | - |
| 43 | File Types Triggering Context Switching | Pending | - | - | - | - | - |
| 44 | File History as Recovery vs Regular Workflow | Pending | - | - | - | - | - |
| 45 | Workspace Size Impact on Search Effectiveness | Pending | - | - | - | - | - |
| 46 | Power User vs Casual User Content Editing Patterns | Pending | - | - | - | - | - |
| 47 | File Type Isolation vs Multi-File Workflows | Pending | - | - | - | - | - |
| 48 | Navigation Source Impact on Editing Patterns | Pending | - | - | - | - | - |
| 49 | MCP Tool Ecosystem Adoption Rate | Pending | - | - | - | - | - |
| 50 | Slash Command vs Direct Interaction by Provider | Pending | - | - | - | - | - |
| 51 | Extension Installation Patterns | Pending | - | - | - | - | - |
| 52 | Custom Tool Widget Usage by Provider | Pending | - | - | - | - | - |
| 53 | Multi-File Batch Operations via AI | Pending | - | - | - | - | - |
| 54 | Template and Snippet Creation from AI Output | Pending | - | - | - | - | - |
| 55 | Automation Workflow Complexity Segmentation | Pending | - | - | - | - | - |
| 56 | Extension-Driven AI Tool Expansion | Pending | - | - | - | - | - |
| 57 | Advanced Feature First-Use Sequence Patterns | Pending | - | - | - | - | - |
| 58 | Scripting and Macro-like Behavior Patterns | Pending | - | - | - | - | - |
| 59 | Database Corruption Recovery Strategy Choices | Pending | - | - | - | - | - |
| 60 | AI Stream Interruption and Request Failure Correlation | Pending | - | - | - | - | - |
| 61 | Session Resumption Age-Based Engagement | Pending | - | - | - | - | - |
| 62 | Background File Conflict Detection Clustering | Pending | - | - | - | - | - |
| 63 | AI Provider-Specific Performance and Failure Rates | Pending | - | - | - | - | - |
| 64 | Database Error Impact on User Retention | Pending | - | - | - | - | - |
| 65 | Long-Running AI Operations and User Patience | Pending | - | - | - | - | - |
| 66 | Workspace-Scale Performance Optimization Patterns | Pending | - | - | - | - | - |
| 67 | Database Backup Effectiveness and Recovery Success | Pending | - | - | - | - | - |
| 68 | Real-Time Collaboration Session Frequency | Pending | - | - | - | - | - |
| 69 | Multi-Device Editing Patterns | Pending | - | - | - | - | - |
| 70 | Permission Evaluation vs AI Tool Execution | Pending | - | - | - | - | - |
| 71 | Commenting and Annotation Adoption | Pending | - | - | - | - | - |
| 72 | Team-Based Approval Workflow Maturity | Pending | - | - | - | - | - |
| 73 | Enterprise Feature Stacking | Pending | - | - | - | - | - |
| 74 | Sharing Initiation via CollabV3 | Pending | - | - | - | - | - |
| 75 | Permission Grant Patterns in Enterprises | Pending | - | - | - | - | - |
| 76 | Session Handoff Between Devices | Pending | - | - | - | - | - |
| 77 | Enterprise AI Provider Consolidation | Pending | - | - | - | - | - |
| 78 | Mobile Session Consumption vs Desktop Session Creation | Pending | - | - | - | - | - |
| 79 | Touch Input Confidence (Toolbar vs Menu) | Pending | - | - | - | - | - |
| 80 | Offline Mode Effectiveness | Pending | - | - | - | - | - |
| 81 | Platform Switching in Multi-Device Workflows | Pending | - | - | - | - | - |
| 82 | Responsive Design Engagement by Form Factor | Pending | - | - | - | - | - |
| 83 | Synchronization Bottlenecks in Cross-Device Workflows | Pending | - | - | - | - | - |
| 84 | Mobile-Specific Feature Adoption Patterns | Pending | - | - | - | - | - |
| 85 | Touch Keyboard Trade-offs on Mobile | Pending | - | - | - | - | - |
| 86 | File Form Factor Optimization | Pending | - | - | - | - | - |
| 87 | Cross-Device Conflict Resolution Patterns | Pending | - | - | - | - | - |
| 88 | Customer Support Trigger Detection | Pending | - | - | - | - | - |
| 89 | Help Documentation Effectiveness | Pending | - | - | - | - | - |
| 90 | Tutorial Completion Conversion Funnel | Pending | - | - | - | - | - |
| 91 | In-App Guidance Timing Analysis | Pending | - | - | - | - | - |
| 92 | Feature Announcement Engagement Response | Pending | - | - | - | - | - |
| 93 | Feedback Submission Propensity After Errors | Pending | - | - | - | - | - |
| 94 | Bug Report Quality Indicators | Pending | - | - | - | - | - |
| 95 | Community Engagement Triggers | Pending | - | - | - | - | - |
| 96 | Social Sharing and Referral Discovery | Pending | - | - | - | - | - |
| 97 | Onboarding Flow Impact on Support Needs | Pending | - | - | - | - | - |

---

## Analysis Progress

- **Total Questions**: 97
- **Completed**: 0
- **In Progress**: 0
- **Pending**: 97

## Methodology

- All queries exclude users in `all_filtered_cohorts` cohort
- Filter condition: `WHERE is_dev_user != true AND user NOT IN (all_filtered_cohorts)`
- Analysis uses PostHog trends, funnels, HogQL, and retention queries
- Individual analysis files stored in `/analysis/questions/` directory

## Key Focus Areas

1. AI Feature Adoption and Usage
2. User Engagement and Retention
3. Workflow Patterns
4. Extension and MCP Ecosystem
5. Error Patterns and Recovery
6. Cross-Platform and Mobile Usage
7. Collaboration Features
8. Onboarding and Feature Discovery
9. Performance and Scale
10. Support and Documentation Effectiveness
