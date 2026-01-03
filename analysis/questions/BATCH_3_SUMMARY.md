# Batch 3 Analysis Questions Summary (Q26-Q45)

**Created:** January 3, 2026
**Batch Size:** 20 questions
**Status:** Analysis files created, queries ready for PostHog execution

---

## Overview

This batch focuses on advanced behavioral patterns, feature engagement depth, and optimization opportunities across Nimbalyst's feature set.

---

## Questions Summary Table

| ID | Question Title | Focus Area | Key Metrics | Priority |
|---|---|---|---|---|
| **Q26** | Walkthrough Follow-through | Onboarding | Mockup usage post-completion (7d, 14d, 30d) | High |
| **Q27** | AI Response Patterns | AI Features | Acceptance by response type (code/text/diff) | High |
| **Q28** | Extension Install Funnel | Extensions | Settings → Install success rate, failure reasons | Medium |
| **Q29** | Panel Layout Optimization | UI/UX | Sidebar width by editor type, session duration | Medium |
| **Q30** | AI Model Switching | AI Features | Within-session provider switches, retry patterns | High |
| **Q31** | Slash Command Discovery | Features | Time-to-discovery, undiscovered commands | High |
| **Q32** | Mockup Engagement | Mockups | Edit vs. view ratio, active vs. passive usage | Medium |
| **Q33** | Database Error Impact | Reliability | Error types, user churn correlation | High |
| **Q34** | File History by Type | Features | Restoration patterns by file type | Low |
| **Q35** | AI Stream Interruption | AI Features | Interruption causes, retry behavior | Medium |
| **Q36** | Onboarding Feature Impact | Onboarding | Completed vs. skipped feature usage | High |
| **Q37** | Weekend Weekday Usage | Engagement | Day-of-week patterns, session characteristics | Low |
| **Q38** | Attachment Predictor | AI Features | Correlation with conversation depth | Low |
| **Q39** | Workspace Organization | Workspace | Single large vs. multiple small workspaces | Medium |
| **Q40** | Search vs Editing | Features | Search behavior correlation with editing | Low |
| **Q41** | View Mode Session Duration | UI/UX | Switchers vs. non-switchers retention | Low |
| **Q42** | Optimal Tab Count | Performance | Performance breaking points, user limits | Medium |
| **Q43** | Context Switching Types | Workflow | File type combination patterns | Low |
| **Q44** | History Recovery Workflow | Features | Reactive vs. proactive history usage | Low |
| **Q45** | Search Effectiveness | Features | Workspace size impact on search success | Low |

---

## Analysis Categories

### High Priority (8 questions)
Focus on core feature adoption, AI reliability, and user activation:
- **Q26:** Walkthrough Follow-through
- **Q27:** AI Response Patterns
- **Q30:** AI Model Switching
- **Q31:** Slash Command Discovery
- **Q33:** Database Error Impact
- **Q36:** Onboarding Feature Impact

### Medium Priority (6 questions)
Feature optimization and UX improvements:
- **Q28:** Extension Install Funnel
- **Q29:** Panel Layout Optimization
- **Q32:** Mockup Engagement
- **Q35:** AI Stream Interruption
- **Q39:** Workspace Organization
- **Q42:** Optimal Tab Count

### Low Priority (6 questions)
Nice-to-have insights for refinement:
- **Q34, Q37, Q38, Q40, Q41, Q43, Q44, Q45**

---

## Key Themes

### 1. Feature Adoption & Discovery
- Q26: Post-onboarding feature usage
- Q31: Slash command discovery timeline
- Q36: Onboarding impact on feature usage

### 2. AI Experience Quality
- Q27: Response type acceptance rates
- Q30: Model switching behavior
- Q33: Database errors impacting AI
- Q35: Stream interruptions

### 3. UI/UX Optimization
- Q29: Panel layout preferences
- Q32: Active vs. passive mockup usage
- Q41: View mode impact on sessions
- Q42: Tab count performance limits

### 4. Workflow Patterns
- Q39: Workspace organization strategies
- Q40: Search behavior patterns
- Q43: Context switching patterns
- Q44: History usage patterns

### 5. Technical Reliability
- Q33: Database error types and impact
- Q35: AI streaming reliability
- Q42: Performance breaking points

---

## Data Requirements

### Critical Data Filters (All Queries)
```
- Excluded cohorts: all_filtered_cohorts
- Filter: is_dev_user != true
- Test accounts: filtered
- Time period: Last 90 days (Oct 5, 2025 - Jan 3, 2026)
```

### Key Event Types Needed
- Onboarding: `walkthrough_completed`, `walkthrough_step_completed`
- AI: `ai_response_received`, `ai_diff_accepted`, `ai_message_sent`, `ai_stream_interrupted`
- Extensions: `extension_install_started`, `extension_installed`, `extension_install_failed`
- UI: `panel_resized`, `editor_opened`, `tab_opened`
- Features: `slash_command_used`, `mockup_created`, `mockup_edited`, `file_restored`
- Errors: `database_error`

---

## Execution Plan

### Phase 1: High Priority (Week 1)
Run queries for Q26, Q27, Q30, Q31, Q33, Q36
- Focus on AI reliability and user activation
- Quick wins for improving onboarding and AI experience

### Phase 2: Medium Priority (Week 2)
Run queries for Q28, Q29, Q32, Q35, Q39, Q42
- UX optimization opportunities
- Feature-specific improvements

### Phase 3: Low Priority (Week 3)
Run queries for Q34, Q37, Q38, Q40, Q41, Q43, Q44, Q45
- Refinement insights
- Long-term optimization

---

## Expected Insights

### User Activation
- **Q26:** Do users who complete walkthroughs actually use features?
- **Q31:** How quickly do users discover power features?
- **Q36:** Which onboarding steps drive actual usage?

### AI Quality
- **Q27:** Which AI response formats are most useful?
- **Q30:** Are users trying multiple providers due to dissatisfaction?
- **Q33:** Are database errors causing user churn?
- **Q35:** How often do AI streams fail?

### UX Optimization
- **Q29:** What's the ideal panel layout for each editor type?
- **Q32:** Are mockups collaborative or just for reference?
- **Q42:** At what point do too many tabs hurt performance?

### Workflow Understanding
- **Q39:** Do power users prefer many small workspaces or one large one?
- **Q40:** Does search usage indicate poor file organization?
- **Q43:** What file types do users work with simultaneously?

---

## Action Items After Analysis

### Immediate (Based on High Priority)
1. Fix top database errors affecting users
2. Improve AI response quality for low-acceptance types
3. Enhance slash command discoverability
4. Optimize onboarding for feature activation

### Short-term (Based on Medium Priority)
5. Streamline extension installation
6. Implement context-aware panel layouts
7. Improve AI streaming reliability
8. Optimize workspace organization UX

### Long-term (Based on Low Priority)
9. Performance optimization for tab management
10. Search effectiveness improvements
11. History recovery enhancements

---

## Files Created

All analysis files follow consistent structure:
1. Research Question
2. Queries Used (SQL/HogQL ready)
3. Raw Results (placeholder for PostHog data)
4. Visualizations (recommended chart types)
5. Takeaways (expected findings and insights)
6. Suggested Actions (condition-based recommendations)
7. Appendix (data quality notes)

**Location:** `/Users/jordanbentley/git/nimbalyst-code/analysis/questions/q26-*.md` through `q45-*.md`

---

## Notes

- **Detailed queries:** Q26-Q32 have full SQL queries defined
- **Template queries:** Q33-Q45 use placeholder structure
- **Consistency:** All files exclude `all_filtered_cohorts` and dev users
- **Flexibility:** Queries can be adapted based on available event properties
- **Documentation:** Each file is self-contained with context and methodology

---

## Next Steps

1. Review and prioritize questions with product team
2. Validate event tracking for required properties
3. Execute high-priority queries in PostHog
4. Populate raw results sections
5. Generate recommended visualizations
6. Document findings and action items
7. Share insights with stakeholders
