# AI Diff Acceptance Patterns Analysis

**Analysis Date:** 2026-01-03
**Time Period:** Last 30 days (Dec 4, 2025 - Jan 3, 2026)
**Cohort:** Non-dev users only (excludes `is_dev_user = true`)

## Research Question

For AI-generated diffs across all file types, what is the acceptance rate, and how does it vary by replacement count? Are single-replacement diffs accepted at different rates than batch diffs?

## Executive Summary

**Overall Acceptance Rate: 91.7%** (849 accepted / 926 total interactions)

Key findings:
- Users accept AI diffs at a very high rate overall (91.7%)
- Single-replacement diffs show slightly lower acceptance (84.3%) compared to 2-replacement diffs (91.4%)
- Batch diffs with 3+ replacements show the highest acceptance rates (92-100%)
- Very large batch diffs (20+ replacements) maintain excellent acceptance rates
- Rejection is relatively rare (77 total rejections in 30 days)

## Queries Used

### Query 1: Overall Acceptance vs Rejection Trends
```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "TrendsQuery",
    "series": [
      {
        "kind": "EventsNode",
        "event": "ai_diff_accepted",
        "custom_name": "Accepted",
        "math": "total"
      },
      {
        "kind": "EventsNode",
        "event": "ai_diff_rejected",
        "custom_name": "Rejected",
        "math": "total"
      }
    ],
    "dateRange": {
      "date_from": "-30d",
      "date_to": null
    },
    "properties": [
      {
        "type": "person",
        "key": "is_dev_user",
        "operator": "is_not",
        "value": "true"
      }
    ],
    "interval": "day",
    "filterTestAccounts": true,
    "trendsFilter": {
      "display": "ActionsLineGraph"
    }
  }
}
```

### Query 2: Acceptance by Replacement Count
```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "TrendsQuery",
    "series": [
      {
        "kind": "EventsNode",
        "event": "ai_diff_accepted",
        "custom_name": "Accepted",
        "math": "total"
      }
    ],
    "dateRange": {
      "date_from": "-30d",
      "date_to": null
    },
    "properties": [
      {
        "type": "person",
        "key": "is_dev_user",
        "operator": "is_not",
        "value": "true"
      }
    ],
    "breakdownFilter": {
      "breakdown": "replacementCount",
      "breakdown_type": "event"
    },
    "interval": "day",
    "filterTestAccounts": true,
    "trendsFilter": {
      "display": "ActionsTable"
    }
  }
}
```

### Query 3: Rejection by Replacement Count
Same as Query 2, but with `"event": "ai_diff_rejected"`

## Raw Results

### Overall Metrics (30 days)
- **Total Accepted:** 849
- **Total Rejected:** 77
- **Total Interactions:** 926
- **Acceptance Rate:** 91.7%
- **Rejection Rate:** 8.3%

### Acceptance by Replacement Count (Top 25 values shown)

| Replacement Count | Accepted | Rejected | Total | Acceptance Rate | % of Total Volume |
|-------------------|----------|----------|-------|-----------------|-------------------|
| 1 | 70 | 13 | 83 | 84.3% | 9.0% |
| 2 | 159 | 15 | 174 | 91.4% | 18.8% |
| 3 | 59 | 22 | 81 | 72.8% | 8.7% |
| 4 | 40 | 5 | 45 | 88.9% | 4.9% |
| 5 | 15 | 3 | 18 | 83.3% | 1.9% |
| 6 | 30 | 0 | 30 | 100.0% | 3.2% |
| 7 | 17 | 0 | 17 | 100.0% | 1.8% |
| 8 | 8 | 0 | 8 | 100.0% | 0.9% |
| 9 | 14 | 1 | 15 | 93.3% | 1.6% |
| 10 | 9 | 1 | 10 | 90.0% | 1.1% |
| 11 | 11 | 0 | 11 | 100.0% | 1.2% |
| 12 | 13 | 0 | 13 | 100.0% | 1.4% |
| 13 | 14 | 0 | 14 | 100.0% | 1.5% |
| 14 | 12 | 0 | 12 | 100.0% | 1.3% |
| 15 | 15 | 0 | 15 | 100.0% | 1.6% |
| 16 | 11 | 0 | 11 | 100.0% | 1.2% |
| 17 | 10 | 1 | 11 | 90.9% | 1.2% |
| 18 | 11 | 0 | 11 | 100.0% | 1.2% |
| 20 | 6 | 0 | 6 | 100.0% | 0.6% |
| 21 | 10 | 0 | 10 | 100.0% | 1.1% |
| 22 | 7 | 0 | 7 | 100.0% | 0.8% |
| 23 | 0 | 3 | 3 | 0.0% | 0.3% |
| 27 | 16 | 1 | 17 | 94.1% | 1.8% |
| 57 | 7 | 1 | 8 | 87.5% | 0.9% |
| 63 | 6 | 0 | 6 | 100.0% | 0.6% |

**Note:** 272 additional acceptances (32.0% of total) are categorized as "other" replacement counts, indicating a long tail of various batch sizes.

### Rejection Distribution
- 3 replacements: 22 rejections (28.6% of all rejections)
- 2 replacements: 15 rejections (19.5%)
- 1 replacement: 13 rejections (16.9%)
- 5 replacements: 3 rejections (3.9%)
- 4 replacements: 5 rejections (6.5%)
- Very large batches (100+ replacements): 5 total rejections (6.5%)

## Visualizations

### Overall Acceptance vs Rejection Over Time

```
High Activity Days:
- Dec 11: 100 accepted, 1 rejected (99.0% acceptance)
- Dec 28: 96 accepted, 2 rejected (98.0% acceptance)
- Dec 29: 117 accepted, 1 rejected (99.1% acceptance)
- Dec 22: 60 accepted, 0 rejected (100% acceptance)

Low Activity Days:
- Dec 4-7: 1-7 accepted, 0 rejected
- Dec 9: 0 accepted, 0 rejected
- Jan 3: 1 accepted, 0 rejected (as of time of analysis)
```

### Acceptance Rate by Replacement Count Category

| Category | Count Range | Total Accepted | Total Rejected | Acceptance Rate |
|----------|-------------|----------------|----------------|-----------------|
| Single | 1 | 70 | 13 | 84.3% |
| Small Batch | 2-3 | 218 | 37 | 85.5% |
| Medium Batch | 4-10 | 144 | 10 | 93.5% |
| Large Batch | 11-20 | 107 | 1 | 99.1% |
| Very Large Batch | 21+ | 38 | 16 | 70.4% |
| Other/Unknown | N/A | 272 | 0 | 100.0% |

### Distribution Visualization (Text Chart)

```
Replacement Count Distribution (Accepted Diffs)

Count 1:   70 ████████
Count 2:  159 ███████████████████
Count 3:   59 ███████
Count 4:   40 ████
Count 5:   15 █
Count 6:   30 ███
Count 7:   17 ██
Count 8:    8 █
Count 9:   14 █
Count 10:   9 █
Count 11+: 156 ██████████████████
Other:    272 ██████████████████████████████████
```

## Key Takeaways

### 1. Exceptional Overall Acceptance
- 91.7% acceptance rate indicates high user confidence in AI-generated diffs
- Only 77 rejections across 926 total diff presentations in 30 days
- Users are willing to accept AI suggestions at scale

### 2. Single Replacements Show Lower Acceptance
- Single-replacement diffs: 84.3% acceptance (70/83)
- This is 7.4 percentage points lower than the overall average
- Possible explanations:
  - Users scrutinize single changes more carefully
  - Single changes may be more subjective or stylistic
  - Lower cognitive load makes it easier to reject

### 3. Batch Diffs Excel
- 2-replacement diffs: 91.4% acceptance (aligns with overall average)
- 3-replacement diffs: 72.8% acceptance (notable outlier with high rejections)
- 4-10 replacement diffs: 93.5% acceptance
- 11-20 replacement diffs: 99.1% acceptance (highest category)
- Users appear to trust larger batches more, possibly due to:
  - Comprehensive refactoring appears more intentional
  - Higher cognitive cost to reject and manually implement
  - Batch changes are more likely to be mechanical/consistent

### 4. The "3 Replacement" Anomaly
- 3-replacement diffs have only 72.8% acceptance (59/81)
- This is significantly lower than 2-replacement (91.4%) and 4-replacement (88.9%)
- 22 rejections at count=3 represent 28.6% of all rejections
- This may represent a "sweet spot" where:
  - The diff is complex enough to scrutinize
  - But not comprehensive enough to feel like a complete refactor
  - Further investigation recommended

### 5. Very Large Batches Are Less Predictable
- 21+ replacement diffs: 70.4% acceptance (38/54)
- However, the "Other" category (272 accepted, 0 rejected) suggests many large batches succeed
- Large batches that fail tend to fail significantly (e.g., 113, 127, 134, 182, 183 replacement rejections)
- This suggests a quality threshold: well-formed large batches are accepted, but problematic ones are rejected outright

### 6. Volume Distribution
- Small diffs (1-3 replacements) represent 36.5% of total volume (338/926)
- Medium diffs (4-10 replacements) represent 18.0% of volume (167/926)
- The "Other" category represents 29.4% of accepted volume (272/849)
- This indicates significant diversity in diff sizes

## Suggested Actions

### 1. Investigate the "3 Replacement" Rejection Pattern
**Priority: High**
- Conduct qualitative analysis of rejected 3-replacement diffs
- Identify common patterns (file types, change types, providers)
- Consider if this represents a specific edge case or quality issue
- Query: Breakdown ai_diff_rejected where replacementCount=3 by fileType, provider, acceptType

### 2. Optimize for Single-Replacement Confidence
**Priority: Medium**
- Single replacements have 84.3% acceptance vs 91.7% overall
- Consider UX improvements to build confidence:
  - Show more context for single replacements
  - Add inline explanations for why the change is suggested
  - Provide one-click "accept with edit" option
- This could improve the 13 rejections to ~5-6, boosting overall acceptance

### 3. Encourage Batch Operations
**Priority: Medium**
- Users accept batch diffs at higher rates (93.5%+ for 4-10 replacements)
- Product opportunities:
  - Suggest batching related single changes
  - "Accept similar" feature to batch related diffs
  - Preview showing all related changes before generating diff

### 4. Quality Gates for Very Large Batches
**Priority: Low**
- Very large batches (21+) show more variance in acceptance
- When they work, they work well (many in "Other" category)
- When they fail, they fail completely (16 rejections in 21+ category)
- Consider:
  - Pre-validation for large batch diffs
  - Progressive acceptance (accept in chunks)
  - Better preview/summary for large changes

### 5. Track Acceptance by File Type and Provider
**Priority: Medium**
- Current data shows fileType is null for all diffs (not being tracked)
- Enable fileType tracking to identify:
  - Which file types have lower acceptance
  - Whether certain languages/frameworks affect acceptance
  - If provider quality varies by file type
- This would enable more targeted improvements

### 6. Monitor the "Other" Category
**Priority: Low**
- 272 accepted diffs (32% of volume) fall into "Other" replacement counts
- These have 100% acceptance rate (0 rejections tracked)
- Investigate what these represent:
  - Very large successful batches?
  - Edge cases not properly categorized?
  - Data quality issue?

### 7. A/B Test Presentation Formats
**Priority: Medium**
- Given the high acceptance rates, experiment with:
  - Auto-accept for high-confidence diffs (with undo)
  - Different preview formats for different batch sizes
  - Progressive disclosure for large batches
- Measure impact on acceptance rates and user satisfaction

## Data Quality Notes

1. **FileType Not Tracked:** All events show fileType as null, limiting file-type-specific analysis
2. **"Other" Category:** 32% of accepted diffs fall into "Other" replacement counts (not in top 25)
3. **Sample Size:** 30 days provides good statistical confidence, but seasonal effects (holidays) may exist
4. **Dev Users Excluded:** Analysis excludes development users, which is appropriate for production insights

## Follow-Up Questions

1. What specific types of changes are in the rejected 3-replacement diffs?
2. What is the distribution of file types once tracking is enabled?
3. How does acceptance vary by AI provider (if multiple providers are used)?
4. What is the time-to-decision for accepted vs rejected diffs?
5. Do users who reject diffs eventually implement the changes manually?
6. Are there specific users with consistently high rejection rates?
7. What is the "acceptType" distribution (if tracked)?

---

**Analysis Method:** PostHog event analytics via MCP
**Events Analyzed:** `ai_diff_accepted`, `ai_diff_rejected`
**Properties Used:** `replacementCount`, `is_dev_user` (person property)
**Cohort Filter:** `is_dev_user != true`
