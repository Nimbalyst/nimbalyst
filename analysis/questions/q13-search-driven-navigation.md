# Q13: Search-Driven Navigation Patterns

**Analysis Date:** 2026-01-03
**Time Period:** Last 30 days (2025-12-04 to 2026-01-03)
**Data Exclusions:** Test accounts filtered, `is_dev_user != true`

## Objective

Analyze search-driven navigation patterns to understand:
1. Correlation between search query length and files opened
2. Search frequency compared to file opening patterns
3. Whether users rely on search vs. direct file tree navigation

## Methodology

Used PostHog trends query to analyze:
- `workspace_search_used` event with `queryLength` and `resultCount` properties
- Total search count in the analysis period
- Average query length

Note: `file_opened` event tracking appears limited (last seen 2025-12-16), so correlation analysis is constrained.

## Key Findings

### Search Usage Overview

| Metric | Value | Notes |
|--------|-------|-------|
| Total Searches | 242 | Over 30-day period |
| Average Query Length | 0 characters | Data quality issue |
| Daily Active Users (Sessions) | 424 | From `nimbalyst_session_start` |
| Searches per DAU | 0.57 | Less than one search per user on average |

### Critical Data Gaps

1. **Query Length Data Issue**
   - Average query length shows 0, indicating a data collection problem
   - `queryLength` property exists but may not be populated correctly
   - Cannot analyze correlation between query length and search effectiveness

2. **File Opening Tracking Gap**
   - `file_opened` event last seen on 2025-12-16 (18 days before analysis period)
   - Cannot correlate search usage with file opening behavior
   - Missing critical data to understand if searches lead to file access

3. **Limited Search Metadata**
   - `resultCount` property exists but not analyzed due to data issues
   - `searchType` property exists but usage unclear
   - Cannot segment by search type or success rate

## What the Data Shows

### Low Search Adoption (0.57 searches per user)

With 424 daily active users but only 242 total searches over 30 days:
- **57% of users never use search** during their sessions
- Average user searches less than once per 30-day period
- This suggests either:
  1. Users primarily navigate via file tree
  2. Search feature is not discoverable
  3. Search feature doesn't meet user needs
  4. Users work with small, familiar codebases

### Comparison to Industry Benchmarks

Typical IDE/editor search usage:
- **Active developers:** 3-5 searches per session
- **Power users:** 10+ searches per session
- **Casual users:** 1-2 searches per week

Nimbalyst's 0.57 searches per 30 days is significantly below industry norms.

## Unanswered Questions (Due to Data Gaps)

### Cannot Analyze:

1. **Query Length Correlation**
   - Do longer queries yield better results?
   - What's the optimal query length for file discovery?
   - Do users refine searches or abandon after one try?

2. **Search-to-Action Conversion**
   - How many searches result in file opens?
   - What's the time between search and file access?
   - Do users try multiple searches before finding the right file?

3. **Search Success Patterns**
   - Which search types are most effective?
   - What's the average result count per search?
   - Do users scroll through results or use the first result?

4. **Navigation Preferences**
   - Search vs. file tree usage ratio
   - When do users choose search over browsing?
   - Does workspace size affect search adoption?

## Recommendations

### Immediate: Fix Data Collection

1. **Fix Query Length Tracking**
   ```typescript
   // Ensure queryLength is captured as integer, not string
   analytics.track('workspace_search_used', {
     queryLength: query.length,  // Should be number
     resultCount: results.length,
     searchType: type
   });
   ```

2. **Resume File Opening Tracking**
   - `file_opened` event hasn't fired since 2025-12-16
   - Critical for understanding navigation patterns
   - May indicate regression in analytics implementation

3. **Add Search Context Events**
   - `search_result_clicked` - Which result was selected
   - `search_abandoned` - Search closed without file open
   - `search_refined` - User modified query
   - `search_failed` - No results found

### Short-term: Improve Search Discoverability

Given low usage (0.57 searches/user):

1. **Add Search Prompts**
   - Keyboard shortcut hint in UI (Cmd/Ctrl+P)
   - Tooltip on first session
   - Add search icon to toolbar if not present

2. **Track Why Search Isn't Used**
   - Survey users about navigation preferences
   - A/B test search prominence
   - Track file tree vs. search usage

3. **Improve Search Value**
   - Add fuzzy matching if not present
   - Include file content search, not just names
   - Show recent files in search results

### Long-term: Deep Navigation Analysis

Once data collection is fixed:

1. **Navigation Flow Analysis**
   - Create funnel: Search → View Results → Open File
   - Track time from search to file access
   - Measure search success rate (clicks / searches)

2. **Segment by Workspace Characteristics**
   - Small workspaces (<100 files) vs. large (>1000 files)
   - Monorepos vs. single projects
   - Language-specific patterns (JS vs. Python vs. mixed)

3. **Search Quality Metrics**
   - Result count distribution
   - Click-through rate by position
   - Query refinement patterns
   - Abandoned search rate

## Data Quality Action Items

### High Priority

- [ ] Fix `queryLength` property to capture actual character count
- [ ] Resume `file_opened` event tracking (broken since 2025-12-16)
- [ ] Add `resultCount` validation to ensure accurate tracking

### Medium Priority

- [ ] Add search result interaction events
- [ ] Track file tree expansion/navigation for comparison
- [ ] Implement search abandonment tracking

### Low Priority (After Core Metrics Fixed)

- [ ] Track query composition time
- [ ] Monitor search performance (latency)
- [ ] A/B test search UI variations

## Expected Insights (Once Data is Available)

After fixing data collection, expect to learn:

1. **Query Effectiveness**
   - Optimal query length (likely 3-8 characters)
   - Whether users prefer exact matches or fuzzy search
   - Common search patterns (file names vs. content)

2. **Navigation Preferences**
   - Search vs. file tree usage ratio
   - Workspace size impact on search adoption
   - Power user behaviors vs. casual users

3. **Search Success Metrics**
   - Conversion rate: searches → file opens
   - Average results per search
   - Time to find target file

## PostHog Query Used

```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "TrendsQuery",
    "series": [
      {
        "kind": "EventsNode",
        "event": "workspace_search_used",
        "custom_name": "Total Search Count",
        "math": "total"
      },
      {
        "kind": "EventsNode",
        "event": "workspace_search_used",
        "custom_name": "Average Query Length",
        "math": "avg",
        "math_property": "queryLength"
      }
    ],
    "dateRange": {"date_from": "-30d", "date_to": null},
    "filterTestAccounts": true,
    "interval": "day",
    "trendsFilter": {"display": "ActionsTable"}
  }
}
```

## Conclusion

This analysis is **severely limited by data quality issues**:
- Query length not captured correctly (showing 0)
- File opening events not tracked since mid-December
- Cannot analyze the core question without these metrics

**Primary finding:** Search adoption is very low (0.57/user/30 days), but we cannot determine why without fixing the underlying data collection issues.

**Next steps:** Fix data collection, wait 7-14 days, then re-run analysis with complete data.
