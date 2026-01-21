# Nimbalyst Usage Analysis - Master Tracking

**Analysis Date**: 2026-01-03
**Cohort Filter**: Excludes `all_filtered_cohorts` cohort
**Total Questions**: 56

## Analysis Progress

| # | Question | Interesting Statistics | Takeaways | Suggestions | Confidence | Analysis File |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | What percentage of users who complete the feature walkthrough create their first AI session within 24 hours, and at which slide do most users abandon the walkthrough, compared to users who skip or defer onboarding? | 99.5% of users created AI sessions BEFORE walkthrough (not after); 96% walkthrough completion rate; Editor slide has 60% of abandonments | The walkthrough happens AFTER AI usage in actual user flow, inverting expected onboarding; Walkthrough functions as post-usage education, not first-time onboarding | Reposition walkthrough as "feature tour"; Optimize Editor slide (60% abandonment); Investigate why 2.9% never create AI sessions; Study actual flow: Launch → AI Session → Walkthrough | High (85%) | [q01-walkthrough-ai-adoption.md](./posthog-analyses/q01-walkthrough-ai-adoption.md) |
| 2 | What is the time-to-first-value for new users: how long between app launch and their first meaningful action (file saved with 500+ words, workspace opened, or AI session started)? | 100% of users complete all actions; Median 28s to workspace, 30s to AI, 32min to meaningful file save; 99.4% open workspace first | Exceptional activation: universal adoption with no drop-off; Workspace-first pattern (99.4%); Fast AI adoption (75% within 60s); Wide variance in file creation (7min to 23 days) | Protect the critical first 30 seconds; Monitor activation metrics daily; Support different user pacing; Leverage "AI-first" positioning in marketing | Very High (95%) | [q02-time-to-first-value.md](./posthog-analyses/q02-time-to-first-value.md) |
| 3 | What is the typical progression timeline from first file creation to first AI session creation, and how does this vary by user role or custom role provision from onboarding? | - | - | - | - | - |
| 4 | What are the 7-day, 30-day, and 90-day retention rates, and how do they differ between users who complete onboarding versus those who skip it, users who use AI features in their first session, and users who experience errors in their first three sessions? | ALL QUERIES FAILED - PostHog database timeouts on all retention queries; 4,474 sessions tracked but cannot calculate user-level metrics | CRITICAL BLOCKER: PostHog cannot handle user-level retention analysis; Database performance prevents any cohort comparison or segmentation analysis | URGENT: Fix PostHog performance (contact support, enable materialization, upgrade tier); Use PostHog UI retention tool as workaround; Consider data export to warehouse | Zero (0%) - No data |
| 5 | How does user engagement (measured by daily active sessions) change over the first 30, 60, and 90 days after initial signup, and what early behaviors predict high engagement at day 90? | - | - | - | - | - |
| 6 | What percentage of weekly active users exhibit each session frequency pattern (daily, 2-3x/week, weekly), and what is the distribution of session lengths across different user segments? | - | - | - | - | - |
| 7 | What are the DAU/WAU and WAU/MAU stickiness ratios, and how do these metrics trend over the past 90 days? | - | - | - | - | - |
| 8 | How many users progress through each lifecycle stage (new install → onboarding → first workspace → first AI session → repeat usage → power user), and what is the drop-off rate at each transition? | - | - | - | - | - |
| 9 | For users who stop using Nimbalyst for 14+ days but then return, which features do they engage with upon return, and what is the time-to-second-session after re-engagement? | - | - | - | - | - |
| 10 | What are the top 5 early warning indicators of user churn within the first 7 days, based on absence of expected events? | - | - | - | - | - |
| 11 | What is the average time between installation and first AI feature use, what percentage of users never engage with AI features, and what percentage of users who start an AI session never send a message (abandonment rate)? | - | - | - | - | - |
| 12 | What percentage of AI chat messages use slash commands, which slash commands are most frequently used, and how do users discover them (suggestion pills vs manual typing)? | Only 0.53% of AI messages use slash commands (58 of 11,007); /plan dominates at 71%; 81% discovered via suggestion pills; datamodellm:datamodel has 16 clicks but 0 uses | Critically low adoption (<1%); Suggestion pills are essential for discovery; /plan shows repeat value; Most commands clicked once then abandoned | Dramatically increase discoverability; Double down on /plan; Investigate datamodellm failure; Deprecate underperforming commands; Add slash command menu UI | Medium-High (70%) | [q12-slash-command-usage.md](./posthog-analyses/q12-slash-command-usage.md) |
| 13 | What is the session-to-session retention pattern and average number of sessions created in first 30 days for users who create their first AI session within 24 hours versus those who wait longer? | - | - | - | - | - |
| 14 | What percentage of users who configure at least one MCP server have higher retention compared to users who never configure MCP servers, and how does OAuth versus API key authentication correlate with successful server test results? | - | - | - | - | - |
| 15 | How frequently do users attach files to AI chat messages, and is there a correlation between attachment usage, document context, and session engagement (message count)? | - | - | - | - | - |
| 16 | What percentage of AI diff proposals are accepted versus rejected, does acceptance rate vary by file type (markdown vs code vs mockup), and how does the number of replacements being reviewed affect acceptance rates? | - | - | - | - | - |
| 17 | What percentage of AI sessions are resumed after various age periods (same day vs weeks old), and how does message count in a session correlate with likelihood of resuming it? | - | - | - | - | - |
| 18 | How does the adoption rate of Claude Code sessions (with MCP servers) compare to other AI providers, and do users with more MCP servers configured send more messages? | - | - | - | - | - |
| 19 | Among users who enable multiple AI providers, what percentage actually switch between them versus settling on a single preferred provider within their first month, and does this correlate with custom MCP tool usage versus built-in tools? | - | - | - | - | - |
| 20 | Do users who heavily use one AI provider search their workspace differently than users of other providers? | - | - | - | - | - |
| 21 | Which editor features (formatting, tables, code blocks, etc.) have the highest adoption rates within the first week, and how does feature adoption correlate with long-term user retention? | - | - | - | - | - |
| 22 | How frequently do users switch between rich text (Lexical) and raw markdown (Monaco) view modes, what triggers the switch, do they eventually settle on one mode, and does switching behavior change over their first 30 days? | - | - | - | - | - |
| 23 | What is the time-to-first-use for different editor types (markdown, monaco, image, mockup, datamodel) after workspace opening, and how does the distribution differ between users in their first week versus users active for 30+ days? | - | - | - | - | - |
| 24 | What percentage of markdown files created contain Mermaid diagrams or DataModel schemas, and how does this correlate with AI provider usage patterns? | - | - | - | - | - |
| 25 | What is the ratio of keyboard shortcut usage versus toolbar button clicks for common actions, and does this ratio change over a user's first 30 days? | - | - | - | - | - |
| 26 | What percentage of users who open file history (Cmd+Y) actually restore a previous version, and does this vary by file type? | - | - | - | - | - |
| 27 | How do users recover from file save failures - what is the retry rate, and does failure type (auto-save vs manual save) impact user behavior? | - | - | - | - | - |
| 28 | What percentage of file conflict detections lead to immediate file saves within 60 seconds versus users abandoning the file, what resolution patterns emerge, and how frequently do users use file history for conflict resolution? | - | - | - | - | - |
| 29 | What is the correlation between workspace file count (1-10, 11-50, 51-100, 100+) and the frequency of workspace search usage, and at what file count threshold does search become critical? | - | - | - | - | - |
| 30 | What percentage of workspace searches are content-based versus file-name-based, how does result count affect user behavior patterns, and how does query length correlate with result count? | - | - | - | - | - |
| 31 | How does workspace complexity (file count, subfolder presence, subfolder depth) correlate with feature adoption rates for advanced features like file history, workspace search, and file tree expansion events? | - | - | - | - | - |
| 32 | What is the relationship between workspace file count and the viral coefficient based on users who have opened direct-to-worktree (indicating potential sharing/collaboration)? | - | - | - | - | - |
| 33 | How do collaboration feature usage patterns differ between desktop and mobile platforms, and what percentage of collaborative sessions involve both platform types? | - | - | - | - | - |
| 34 | How does mobile (Capacitor/iOS) usage differ from desktop (Electron) in terms of AI interaction patterns, file types created, feature engagement, and cross-device workflow completion rates? | - | - | - | - | - |
| 35 | What is the relationship between device type (tablet vs phone on iOS) and the types of files created or edited (viewing vs creating)? | - | - | - | - | - |
| 36 | What percentage of users switch between multiple devices within a single session, and how does network quality (inferred from sync performance) impact their workflow continuity? | - | - | - | - | - |
| 37 | Which extensions have the highest installation and active usage rates, what is the average time between extension installation and first use, and what percentage of users adopt new features within 7 days of a feature launch? | - | - | - | - | - |
| 38 | What percentage of users who open project settings for the first time actually install packages, and which package types have the highest installation success rates? | - | - | - | - | - |
| 39 | How does the frequency of extension toggling (enabling/disabling) correlate with the total number of installed packages and MCP servers configured? | - | - | - | - | - |
| 40 | What percentage of users who test MCP server connections encounter failures, what are the most common error types by template ID, and what is the adoption rate of workspace-scoped versus user-scoped configurations? | - | - | - | - | - |
| 41 | What percentage of users who open MCP server configuration successfully save a working configuration, and which template types have the highest failure rates? | - | - | - | - | - |
| 42 | How many users who experience their first AI request failure (network/auth/timeout) return to create another AI session within the same week versus abandoning the feature? | - | - | - | - | - |
| 43 | Do users who frequently switch between Files and Agent content modes show different AI feature adoption patterns compared to users who stay primarily in one mode? | - | - | - | - | - |
| 44 | Among users who configure themes, what is the distribution between light, dark, crystal-dark, and system themes, and does theme preference correlate with session duration or platform? | - | - | - | - | - |
| 45 | What percentage of users who experience an error or crash in their first three sessions continue using Nimbalyst beyond 30 days? | - | - | - | - | - |
| 46 | Among users who experience database corruption, what percentage successfully restore from backup versus starting fresh, how does this impact their subsequent session frequency over the next 7 days, and what is their 30-day retention rate? | - | - | - | - | - |
| 47 | Do users on Windows experience higher error rates compared to Mac and Linux users, and which specific error types are platform-specific? | - | - | - | - | - |
| 48 | How does browser engine or Electron version affect the frequency of uncaught errors and database corruption events? | - | - | - | - | - |
| 49 | What are the most common user workflow patterns based on feature usage sequences (e.g., create document → format text → add AI content → share), and how do these patterns differ between power users and casual users? | - | - | - | - | - |
| 50 | Which user characteristics (tenure, existing feature usage, platform) predict early feature adoption? | - | - | - | - | - |
| 51 | Which combination of three features (file operations, AI chat, workspace search, terminal usage, MCP server configuration) shows the strongest correlation with 90-day user retention? | - | - | - | - | - |
| 52 | What predicts long-term retention: users who configure MCP servers early, users who create many files, or users who engage heavily with AI features in their first week? | - | - | - | - | - |
| 53 | How does screen resolution correlate with feature adoption rates for AI tools, workspace search, and file history features? | - | - | - | - | - |
| 54 | Do users with smaller screen resolutions rely more heavily on keyboard shortcuts versus toolbar buttons for common operations? | - | - | - | - | - |
| 55 | How does time zone distribution correlate with peak usage hours for AI provider API errors (rate limiting, timeouts), suggesting geographic infrastructure issues? | - | - | - | - | - |
| 56 | Do users in different geographic regions (inferred from time zones) show different AI provider preferences, suggesting localization or regulatory influences on model selection? | - | - | - | - | - |

## Summary Insights

This section will be populated once all analyses are complete.

### Key Findings
- TBD

### High-Priority Actions
- TBD

### Areas for Further Investigation
- TBD
