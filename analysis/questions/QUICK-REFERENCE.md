# Quick Reference: Questions 11-15 Analysis

**Analysis Date:** 2026-01-03
**Period:** Last 30 days (Dec 4, 2025 - Jan 3, 2026)
**Users:** 424 DAU (excluding dev users and test accounts)

## One-Page Summary Table

| Q# | Question | Key Finding | Metric | Data Quality | Action |
|----|----------|-------------|--------|--------------|--------|
| **Q11** | Session Duration by Editor Type | No data available - session tracking not implemented | 0 sessions tracked | **Poor** | Fix `session_ended` event |
| **Q12** | AI Feature Adoption Funnel | Two major drop-offs in AI workflow | 49.6% send message<br>28.3% accept diff<br>14% complete | **Good** | Optimize onboarding & diff UX |
| **Q13** | Search-Driven Navigation | Very low search usage, multiple data gaps | 0.57 searches/user/30d<br>242 total searches | **Poor** | Fix tracking, improve discoverability |
| **Q14** | Theme & Cross-Platform | Extremely low customization, users prefer function | 1.9% change themes<br>90% use AI | **Fair** | Deprioritize themes, focus features |
| **Q15** | File Management Clusters | Heavy creation, minimal deletion/cleanup | 97.3% creation<br>2.3% deletion | **Fair** | Add workspace context, optimize creation |

## Critical Data Quality Issues

| Issue | Severity | Impact | Fix Priority |
|-------|----------|--------|--------------|
| `session_ended` not firing | Critical | Blocks Q11, impacts engagement analysis | P0 |
| `file_opened` broken since Dec 16 | Critical | Blocks Q13 navigation analysis | P0 |
| `queryLength` showing 0 | High | Prevents Q13 query effectiveness analysis | P1 |
| No workspace metadata | High | Prevents Q15 workspace size segmentation | P1 |
| No platform/theme context | Medium | Limits Q14 cross-platform analysis | P2 |

## Top 3 Actionable Findings

### 1. AI Funnel Has Clear Friction Points (Q12)

**Finding:**
- 50.4% drop-off: Users open AI sessions but don't send messages
- 71.7% drop-off: Users send messages but don't accept diffs
- Only 14% complete full funnel (industry: 15-25%)

**Action:**
- Add onboarding prompts when AI session opens
- Improve diff preview/explanation UX
- Track `ai_diff_rejected` with reasons
- A/B test suggested prompts

**Expected Impact:** 10-20% improvement in conversion rates

---

### 2. Search Feature Severely Underutilized (Q13)

**Finding:**
- 0.57 searches per user per 30 days (vs. industry 3-5 per session)
- 57% of users never search
- Cannot analyze effectiveness due to broken tracking

**Action:**
- Fix `queryLength` and `file_opened` tracking first
- Improve search discoverability (keyboard hints, tooltips)
- Add search result interaction events
- Determine if low usage indicates problem or excellent file tree UX

**Expected Impact:** TBD after fixing tracking (may not be a problem)

---

### 3. Users Are Builders, Not Organizers (Q15)

**Finding:**
- 97% of file operations are creation (3,038 files)
- Only 2.3% deletion rate (71 files)
- Net growth: +99 files/day
- Users in active building phase, not cleanup/refactoring

**Action:**
- Optimize file creation workflows (primary use case)
- Consider adding cleanup assistance ("find unused files")
- Add workspace size context to understand patterns better
- Support creation-heavy workflow with AI file generation

**Expected Impact:** Better product-market fit for builder persona

## Surprising Insights

1. **Function Over Form (Q14):** 90% use AI features but only 2% customize themes - users prioritize functionality over aesthetics

2. **Low Search ≠ Low Engagement (Q13):** Users search rarely (0.57/30d) but are highly active (424 DAU, 385 AI sessions) - suggests good file tree navigation

3. **Rename/Delete Parity (Q15):** Exactly 71 renames and 71 deletions - suspicious coincidence requiring investigation

## Files Generated

Location: `/Users/jordanbentley/git/nimbalyst-code/analysis/questions/`

- `q11-session-duration-editor-type.md`
- `q12-ai-feature-adoption-funnel.md`
- `q13-search-driven-navigation.md`
- `q14-theme-cross-platform.md`
- `q15-file-management-clusters.md`
- `SUMMARY-Q11-Q15.md`
- `QUICK-REFERENCE.md` (this file)
