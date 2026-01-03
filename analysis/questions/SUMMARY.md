# Usage Analysis Summary - Questions 6-10

**Analysis Period:** Last 30 days (Dec 4, 2025 - Jan 3, 2026)
**Methodology:** PostHog event analysis, non-dev users only (is_dev_user != true)

## Executive Summary

This analysis reveals critical insights about Nimbalyst feature adoption and user engagement patterns:

1. **AI with attachments is the killer feature** - 22x engagement multiplier
2. **Error resilience is excellent** - 0% abandonment after critical failures
3. **Feature discovery is the main challenge** - Most features have <10% adoption
4. **Slash commands are completely broken** - 0% conversion from discovery to usage
5. **Workspace size affects feature needs** - Medium workspaces (11-50 files) show highest search adoption

## Key Findings by Question

| Question | Primary Finding | Impact Level | Action Priority |
|----------|----------------|--------------|-----------------|
| Q6: Workspace Scale | Medium workspaces (11-50 files) have 45.5% search adoption vs 18% in other sizes | Medium | Optimize onboarding for workspace size |
| Q7: File History | Only 6.2% discover feature, but 11.8% who do use restoration | High | Critical discovery problem |
| Q8: Attachments | 24.5% adoption drives 22x message volume (126 vs 5.7 msgs/user) | **Critical** | Primary engagement driver |
| Q9: Error Recovery | 0% abandonment after critical errors, 100% recovery engagement | High | System works, maintain focus |
| Q10: Slash Commands | 16.7% discover feature, **0% successfully use it** | **Critical** | Feature broken or tracking failed |

## Detailed Findings Table

### Q6: Workspace Scale and Feature Usage Correlation

| Metric | Finding | Insight |
|--------|---------|---------|
| **User Distribution** | 35.8% small (1-10), 39.4% xlarge (100+), bimodal | Two distinct user personas |
| **File History Adoption** | 38.1% in small workspaces, drops to 16.7% in large (51-100) | Feature less discoverable in complex projects |
| **Search Adoption** | Peaks at 45.5% in medium workspaces (11-50 files) | Sweet spot where search becomes necessary |
| **AI Usage** | 37% of users, 35 messages/user average, consistent across sizes | Core feature regardless of workspace size |
| **Correlation Pattern** | Search needs peak mid-size, file history decreases with scale | Different features for different workspace types |

**Key Recommendation:** Implement workspace-size-aware onboarding that highlights relevant features.

---

### Q7: File History Feature Adoption and Document Recovery Patterns

| Metric | Finding | Insight |
|--------|---------|---------|
| **Overall Adoption** | 6.2% of users (34/551) opened file history | Severe discovery problem |
| **Restoration Rate** | 11.8% of users who opened restored files (4/34) | Reasonable conversion for those who find it |
| **Usage Pattern** | 52.9% open once only, 47% return for second use | Moderate stickiness once discovered |
| **Restoration Behavior** | All 4 restoring users did 2-3 restorations each (100% multi-use) | High value when needed |
| **Editing Correlation** | Moderate editors (20-99 saves) use most (3.2 opens avg) | "Learning zone" users benefit most |

**Key Recommendation:** Add file history button to editor toolbar and contextual prompts after edits.

---

### Q8: Attachment Usage in AI Conversations

| Metric | Finding | Insight |
|--------|---------|---------|
| **User Adoption** | 24.5% of AI users (50/204) used attachments | Healthy power-user feature adoption |
| **Message Penetration** | 5.0% of messages (359/7,185) include attachments | Selective, deliberate use |
| **Engagement Multiplier** | **22x** (126 msgs/user with attachments vs 5.7 without) | Strongest engagement signal in dataset |
| **Attachment Count** | 91.1% use 1 attachment, 8.9% use 2+ | Single-file context dominates |
| **Provider Distribution** | 100% of attachments with Claude Code (0% others) | Strong provider lock-in |
| **Power Users** | Top 10 users account for 74.4% of attachment usage | Feature sticky for adopters |

**Key Recommendations:**
1. Improve attachment onboarding - this is the primary engagement driver
2. Add "attach current file" one-click option
3. Show attachment examples in first AI session

---

### Q9: Error-to-Abandonment Journey for Database and AI Failures

| Metric | Finding | Insight |
|--------|---------|---------|
| **Affected Users** | 6 users experienced 82 total error events in 30 days | Low error rate overall |
| **Error Distribution** | 75 database errors (2 users), 4 corruptions (4 users), 3 AI fails (2 users) | Database errors cluster in cascades |
| **Abandonment Rate** | **0%** - All 6 users remained active after errors | Excellent resilience |
| **Recovery Time** | 100% active within 24h, 33% within 1 hour | Fast recovery/persistence |
| **Corruption Recovery** | 100% engagement (4/4 made recovery choice) | Recovery system works perfectly |
| **Error Patterns** | 54 errors in 8 minutes (cascades), not isolated failures | Systematic issues, not random |

**Key Recommendations:**
1. Investigate database error cascades (75 errors from 2 users)
2. Add circuit breakers to prevent retry storms
3. Log all corruption recovery outcomes (only 1/4 logged)
4. Acknowledge cascading errors with user-friendly messaging

---

### Q10: Slash Command Discovery and Usage in Claude Code Sessions

| Metric | Finding | Insight |
|--------|---------|---------|
| **Discovery Rate** | 16.7% of AI users (34/204) clicked slash suggestions | Good visibility |
| **Total Clicks** | 42 clicks from 34 users (1.24 clicks/user) | Low repeat engagement |
| **Usage Rate** | **0 messages sent with slash commands** | Complete funnel breakdown |
| **Conversion Funnel** | 16.7% discover → **0% use** | 100% drop-off rate |
| **User Behavior** | 91.2% click only once, never return | Try once, abandon |
| **Multi-Click Pattern** | Users cluster clicks within seconds (frustration pattern) | UI confusion or errors |
| **Volume Correlation** | Power users (900+ msgs) tried once and stopped | No value delivered |
| **Zero-Message Users** | 4 users clicked suggestions but sent 0 AI messages total | Critical UX failure |

**Key Recommendations:**
1. **URGENT:** Verify if slash commands actually work (likely tracking failure or broken feature)
2. Add post-click guidance showing how to use commands
3. Implement command autocomplete and syntax help
4. Track full lifecycle: show → click → type → send → success

---

## Cross-Cutting Patterns

### Feature Discovery Challenge

| Feature | Adoption Rate | Primary Barrier |
|---------|--------------|-----------------|
| File History | 6.2% | Hidden in UI |
| Workspace Search | 24.0% | Not needed in small workspaces |
| Attachments | 24.5% | Power-user feature, good adoption |
| Slash Commands | 16.7% discover, 0% use | Complete execution failure |

**Pattern:** Discovery rates between 6-25%, with conversion varying widely. Attachment adoption (24.5%) is the success story.

### Engagement Multipliers

| Feature | Engagement Impact | Evidence |
|---------|------------------|----------|
| **Attachments** | **22x message volume** | 126 msgs vs 5.7 msgs per user |
| File History | Unknown | Too few users for measurement |
| Search | Unknown | Too few users for measurement |
| Slash Commands | 0x (broken) | Zero usage despite 16.7% discovery |

**Pattern:** Attachments are the only measured engagement multiplier, and it's massive (22x).

### User Segmentation Insights

**Power Users (100+ AI messages):**
- 3 users clicked slash suggestions, none used them
- Heavy attachment users (74% of attachment usage from top 10 users)
- Don't use file history proportionally more than others

**Moderate Users (20-99 AI messages):**
- Highest file history usage (3.2 opens avg)
- Peak search adoption in medium workspaces (45.5%)
- Balanced feature exploration

**Casual Users (1-19 AI messages):**
- Low feature discovery across the board
- 75% never use attachments (missing key engagement driver)
- Likely don't reach use cases requiring advanced features

### Error Resilience

**All Error Types: 0% Abandonment**
- Database errors (cascading): Users persist through 50+ errors
- Database corruption: 100% engage with recovery, continue usage
- AI failures: Users retry, no abandonment

**Pattern:** Users are remarkably persistent through technical issues, suggesting strong product value or lock-in.

## Priority Actions

### Critical (Fix Immediately)

1. **Investigate slash command failure** - 0% usage despite 16.7% discovery is either broken feature or severe tracking gap
2. **Promote attachment feature** - 22x engagement multiplier, currently only 24.5% adoption
3. **Fix database error cascades** - 75 errors from 2 users indicates systematic issue

### High Priority (Next Sprint)

4. **Improve file history discovery** - Only 6.2% adoption for valuable recovery feature
5. **Add workspace-size-aware onboarding** - Different features matter at different scales
6. **Track corruption recovery outcomes** - Only 1/4 restore_result events logged

### Medium Priority (Next Month)

7. **Optimize search for medium workspaces** - 45.5% adoption in sweet spot, expand to others
8. **Convert casual users to power users** - Focus on attachment adoption for 75% who don't use it
9. **Add circuit breakers for error cascades** - Prevent 50+ error bursts

## Metrics to Watch

### Leading Indicators of Success

1. **Attachment adoption rate** - Target: Increase from 24.5% to 40%
2. **File history discovery** - Target: Increase from 6.2% to 20%
3. **Slash command usage** - Target: Fix from 0% to >5% of discoverers
4. **Error cascade frequency** - Target: Reduce >10 error/minute incidents to zero

### Engagement Metrics

1. **Messages per user** - Currently 35.2 avg, heavily driven by attachment users (126 vs 5.7)
2. **Feature co-usage** - Track which feature combinations drive most engagement
3. **Time to feature discovery** - Measure days from signup to first use
4. **Feature retention** - Track 7-day, 30-day continued usage after discovery

## Data Quality Observations

### Tracking Gaps Identified

1. **Slash commands** - Properties exist but never populated (usedSlashCommand, slashCommandName)
2. **Corruption recovery** - Only 1/4 restore_result events logged
3. **File saves** - 9 file history users have 0 saves recorded
4. **Workspace context** - File history/search events don't include workspace size

### Analysis Limitations

1. Small sample sizes for some features (6 error users, 4 file restorers)
2. Cannot track which specific files were attached or restored
3. No session-level data to measure feature impact on conversation quality
4. Correlation vs causation unclear for attachment engagement multiplier
5. Last_seen data doesn't distinguish between active use and background app state

## Conclusion

The analysis reveals a tale of two features:

**Success Story:** Attachments drive 22x engagement (126 vs 5.7 messages) with 24.5% adoption. This is the killer feature that converts casual users into power users.

**Critical Failure:** Slash commands have 16.7% discovery but 0% usage - either broken or completely untracked. This represents wasted development effort and confused users.

**Discovery Challenge:** Most features (file history 6.2%, search 24%) suffer from low adoption, not because they lack value (11.8% restoration rate, 45.5% search in medium workspaces), but because users don't discover them.

**Error Resilience:** 0% abandonment after critical errors shows either exceptional product value or effective recovery systems (likely both).

**Primary Recommendation:** Focus on attachment adoption (proven 22x multiplier), fix slash commands (critical failure), and implement workspace-size-aware onboarding to improve feature discovery.
