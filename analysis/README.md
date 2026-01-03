# Nimbalyst Deep Usage Analysis

**Analysis Date**: January 2, 2026
**Status**: IN PROGRESS (2/97 complete)
**Expected Completion**: 2-4 hours from start
**Critical Constraint**: All analyses exclude `all_filtered_cohorts` cohort

---

## Quick Links

- **Master Tracking File**: [nimbalyst-usage-analysis-master.md](./nimbalyst-usage-analysis-master.md)
- **Analysis Status**: [ANALYSIS_STATUS.md](./ANALYSIS_STATUS.md)
- **Individual Analyses**: [questions/](./questions/)
- **Monitoring Logs**:
  - Active collection: `/tmp/active_collection.log`
  - Consolidation: `/tmp/consolidation.log`
  - Status updates: `/tmp/claude/-Users-jordanbentley-git-nimbalyst-code/tasks/b1b7afd.output`

---

## Analysis Overview

This is a comprehensive deep analysis of Nimbalyst usage patterns using PostHog analytics data. The analysis covers 97 research questions across 10 major categories.

### Methodology

1. **Phase 1**: Generated 100 research questions via 10 parallel sub-agents
2. **Phase 2**: Deduplicated to 97 unique questions and created master tracking file
3. **Phase 3**: Launched 95 specialized agents (in batches) to analyze each question
4. **Phase 4**: Automated collection and consolidation (in progress)

### Research Categories

| Category | Questions | Description |
| --- | --- | --- |
| AI Features | 1, 4, 8-10, 12, 22, 25, 27, 30-31, 35, 38, 50, 52-53, 60-61, 63 | Provider adoption, diff acceptance, attachments, streaming, performance |
| Editor & Content | 3, 11, 14, 21, 23-24, 32, 41-43 | View modes, session duration, editor types, context switching |
| File Management | 7, 13, 15, 34, 40, 44-48 | History, conflicts, search, operations, navigation |
| User Engagement | 2, 5, 12, 16, 19-20, 37-38, 46, 95 | Retention, feature discovery, power users, weekday/weekend patterns |
| Error & Performance | 9, 18, 33, 35, 59-67 | Database errors, recovery, interruptions, scale issues |
| Extensions & Tools | 5, 28, 49, 51-52, 54-58 | MCP tools, installations, automation, batch operations |
| Mobile & Cross-Platform | 14, 69, 78-87 | Device switching, touch input, sync, offline mode |
| Onboarding & Support | 2, 19, 26, 36, 88-93, 97 | Walkthrough, help docs, tutorials, support triggers |
| Collaboration | 68-77 | CollabV3, sharing, permissions, team workflows |
| Workspace & Scale | 6, 15, 39, 42, 45, 66 | File counts, organization, search effectiveness |

---

## Completed Analyses (2/97)

### 1. AI Provider Adoption and Switching Behavior ✓

**File**: [q01-ai-provider-adoption.md](./questions/q01-ai-provider-adoption.md)

**Key Statistics**:
- Claude Code: 94.6% of active users (278 users, 16,038 messages)
- Provider switching: 34.3% try multiple providers
- Claude-OpenAI bidirectional switching dominates (36 transitions)
- Low activation: Claude 9.2%, OpenAI 12%

**Critical Finding**: Measurement gap - 278 active Claude Code users vs only 56 who configured it

**Top Recommendations**:
1. Make Claude Code the default provider
2. Investigate measurement accuracy
3. Interview multi-provider users (34.3% of base)
4. Re-engage 89% of Claude/OpenAI users who never send messages

**Confidence**: High

---

### 2. Time-to-First-AI-Interaction During Onboarding ✓

**File**: [q02-onboarding-to-ai-interaction.md](./questions/q02-onboarding-to-ai-interaction.md)

**Key Statistics**:
- Median time to first AI: 0 days (89.4% same-day adoption)
- AI discovery rate: 48.8% of all users
- 30-day retention: Only 1.7%
- Single-session users: 62.9%

**Critical Finding**: AI discovery works well; retention is the actual problem

**Top Recommendations**:
1. Deprioritize onboarding optimization for AI discovery
2. Focus resources on retention (not acquisition/activation)
3. Study the 9 power users with 30+ day retention
4. Track "time to second AI interaction" as key metric
5. Research the value realization gap via user interviews

**Confidence**: High

---

## Automated Monitoring

The analysis has 4 background processes running:

1. **Progress Monitor** (5-min intervals)
  - Tracks completion: X/97 analyses
  - Log: `/tmp/claude/-Users-jordanbentley-git-nimbalyst-code/tasks/bbf810c.output`

2. **Status Auto-Updater** (5-min intervals)
  - Updates ANALYSIS_STATUS.md
  - Log: `/tmp/claude/-Users-jordanbentley-git-nimbalyst-code/tasks/b1b7afd.output`

3. **Active Collection** (3-min intervals)
  - Detects new completed analyses
  - Log: `/tmp/active_collection.log`

4. **Final Consolidator** (waits for 97)
  - Generates executive summary
  - Finalizes master tracking file
  - Log: `/tmp/consolidation.log`

---

## What Each Agent Does

Each of the 95 running agents performs:

1. **Event Definition Lookup** - Identifies relevant PostHog events
2. **Query Construction** - Builds trends, funnels, and HogQL queries
3. **Data Execution** - Runs 10-15 PostHog queries per question
4. **Result Aggregation** - Processes and aggregates query results
5. **Insight Generation** - Analyzes patterns and generates takeaways
6. **Recommendation Formulation** - Creates actionable product suggestions
7. **Report Writing** - Produces comprehensive markdown analysis

---

## Why This Takes Time

- **95 agents** running complex analyses in parallel
- **10-15 PostHog queries** per agent
- **API rate limits** on PostHog queries
- **Data aggregation** across 90 days of events
- **Comprehensive reports** with queries, results, visualizations, and recommendations

**Estimated Total Time**: 2-4 hours from launch (started ~20:00)

---

## What Happens When Complete

Once all 97 analyses finish:

1. ✓ All 97 .md files created in `questions/` directory
2. ✓ Master tracking file updated with all statistics and links
3. ✓ Executive summary generated with top insights
4. ✓ Prioritized action items created across all categories
5. ✓ Cross-cutting patterns identified
6. ✓ Comprehensive overnight analysis complete

---

## Manual Monitoring Commands

Check progress anytime:

```bash
# Count completed analyses
ls -1 /Users/jordanbentley/git/nimbalyst-code/analysis/questions/*.md | wc -l

# View active collection log
tail -f /tmp/active_collection.log

# View status updates
tail -f /tmp/claude/-Users-jordanbentley-git-nimbalyst-code/tasks/b1b7afd.output

# View consolidation progress
tail -f /tmp/consolidation.log

# List all completed files
ls -1 /Users/jordanbentley/git/nimbalyst-code/analysis/questions/*.md | sort
```

---

## Next Steps (After Completion)

1. Review master tracking file for overview of all 97 analyses
2. Identify top 10-15 highest-impact insights
3. Create prioritized product roadmap based on findings
4. Share executive summary with stakeholders
5. Deep-dive into specific categories of interest
6. Plan follow-up analyses for unclear patterns

---

**Analysis Architecture**: Parallel multi-agent system with automated monitoring and consolidation
**Data Quality**: Production data only (dev users and test cohorts excluded)
**Coverage**: Comprehensive across all product areas (AI, editor, mobile, collaboration, etc.)
**Deliverable**: 97 detailed analyses + master summary + executive brief
