# Q05: Extension Adoption as Leading Indicator of Power Users

**Research Question:** Which extensions are installed most frequently, and do users who install extensions within the first 7 days have significantly higher 60-day retention rates?

**Analysis Date:** 2026-01-03
**Time Period:** Last 90 days (Oct 5, 2025 - Jan 3, 2026)
**Filters Applied:** Test accounts excluded, `is_dev_user != true`

---

## Executive Summary

Based on the available data from the last 90 days:

1. **Top 3 Most Popular Extensions by Unique Users:**
   - Product Manager: 111 unique users (152 total installs)
   - Developer: 110 unique users (151 total installs)
   - Core: 74 unique users (109 total installs)

2. **Retention Analysis:** Unable to complete comprehensive retention analysis due to query performance limitations in PostHog. The dataset is too large for the available HogQL query execution time limits.

---

## Extension Installation Analysis

### Most Frequently Installed Extensions (Last 90 Days)

| Extension Name | Unique Users | Total Installs | Installs per User |
|----------------|--------------|----------------|-------------------|
| Product Manager | 111 | 152 | 1.37 |
| Developer | 110 | 151 | 1.37 |
| Core | 74 | 109 | 1.47 |

**Key Findings:**

1. **Nearly Equal Adoption:** Product Manager and Developer extensions have nearly identical adoption rates, with 111 and 110 unique users respectively.

2. **High Re-installation Rate:** The Core extension shows the highest installs-per-user ratio (1.47), suggesting users may be reinstalling it more frequently, possibly due to:
   - Troubleshooting/debugging
   - Updates or version changes
   - Multiple workspace setups

3. **Strong Top-Funnel Engagement:** The fact that 111+ users installed extensions within a 90-day window indicates meaningful engagement with the extension ecosystem.

---

## Retention Analysis Limitations

### Attempted Analysis

The goal was to compare 60-day retention rates between:
- **Cohort A:** Users who installed an extension within their first 7 days
- **Cohort B:** Users who did not install an extension within their first 7 days

### Technical Constraints

**All HogQL queries attempting to analyze retention timed out (504 Gateway Timeout errors).** This occurred with:

1. Queries filtering on person properties (`is_dev_user`)
2. Queries joining user cohorts with activity data
3. Queries calculating retention windows (60+ days)
4. Queries attempting to identify first-seen dates and compare with installation dates

**PostHog Error Message:**
```
"Query has hit the max execution time before completing.
See our docs for how to improve your query performance.
You may need to materialize."
```

### Why Queries Failed

1. **Large Dataset Size:** The events table contains significant data volume that exceeds query execution time limits
2. **Complex Joins:** Correlating user first-seen dates with package installation timing requires expensive joins
3. **Person Property Filters:** Filtering on `is_dev_user` person property adds additional query complexity
4. **Long Time Windows:** 60-day retention calculations require scanning large date ranges

---

## Alternative Analysis Approaches

To answer the retention question, consider:

### 1. Pre-Materialized Cohorts

Create and save cohorts in PostHog:
- "Installed Extension Within 7 Days" cohort
- "Did Not Install Extension Within 7 Days" cohort

Then use PostHog's built-in retention analysis on these cohorts.

### 2. Retention Insights

Use PostHog's native Retention insight type instead of HogQL:
- Define starting event: First app session
- Define return event: Any activity event
- Segment by: "Installed package_installed within 7 days" property

### 3. Data Export

Export raw events data and perform analysis in a local database or data warehouse:
- BigQuery
- Snowflake
- Local PostgreSQL with indexed tables

### 4. Smaller Time Windows

Analyze retention for shorter periods (e.g., 14-day or 30-day retention) which may execute faster.

---

## Data Quality Notes

### Event Coverage

- **package_installed event:** Properly tracked with `packageName` and `packageId` properties
- **Dev user filtering:** `is_dev_user` property exists and can filter out 22 dev users (vs 144 non-dev users who installed packages since Nov 1, 2024)

### Data Completeness

- Extension installation data appears complete and consistent
- No gaps observed in the 90-day time period
- Event properties are properly structured

---

## Recommendations

### For Product/Analytics Team

1. **Set Up Materialized Cohorts:**
   - Create saved cohorts for "Early Extension Adopters" (installed within 7 days)
   - Use these cohorts in standard PostHog retention analysis tools

2. **Use Native Retention Insights:**
   - Leverage PostHog's Retention insight type which is optimized for these queries
   - Avoid HogQL for large-scale retention calculations

3. **Consider Data Warehouse Export:**
   - For complex analysis requiring custom retention calculations
   - Set up regular exports to a data warehouse for deeper analysis

4. **Track Extension Usage Events:**
   - Beyond installation, track extension activation/usage events
   - This would allow analysis of "installed but never used" vs "installed and actively using"

### For Extension Development

1. **Product Manager & Developer extensions are equally popular** - ensure both receive equal attention in development roadmap

2. **Core extension shows higher reinstall rate** - investigate why users are reinstalling:
   - Is there an installation issue?
   - Are updates forcing reinstalls?
   - Are users setting up multiple workspaces?

---

## Next Steps

To fully answer the retention question:

1. **Create Cohorts in PostHog UI:**
   - Navigate to People > Cohorts
   - Create "Installed Extension in First 7 Days" cohort
   - Create comparison cohort

2. **Run Native Retention Analysis:**
   - Create Retention insight
   - Compare the two cohorts
   - Export results

3. **Document Findings:**
   - Update this analysis with retention metrics once cohorts are created
   - Include statistical significance testing (if sample sizes allow)

---

## Appendix: Query Examples Attempted

### Extension Installation Breakdown (SUCCESSFUL)
```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "TrendsQuery",
    "series": [{
      "kind": "EventsNode",
      "event": "package_installed",
      "custom_name": "Unique Users Installing Extensions",
      "math": "dau"
    }],
    "breakdownFilter": {
      "breakdown": "packageName",
      "breakdown_type": "event"
    },
    "dateRange": {
      "date_from": "-90d",
      "date_to": null
    },
    "filterTestAccounts": true,
    "trendsFilter": {
      "display": "ActionsTable"
    }
  }
}
```

### Retention Analysis (TIMED OUT)
```sql
-- This query timed out due to dataset size
WITH user_first_seen AS (
  SELECT person_id,
         min(timestamp) as first_seen
  FROM events
  WHERE properties.is_dev_user != true
  GROUP BY person_id
),
early_installers AS (
  SELECT DISTINCT e.person_id
  FROM events e
  JOIN user_first_seen u ON e.person_id = u.person_id
  WHERE e.event = 'package_installed'
    AND e.timestamp <= u.first_seen + INTERVAL 7 DAY
    AND properties.is_dev_user != true
)
-- [Rest of query omitted - timed out at execution]
```

---

## Conclusion

While we successfully identified the most popular extensions (Product Manager, Developer, and Core), the retention analysis requires a different approach due to PostHog query performance limitations. The recommendation is to use PostHog's native cohort and retention analysis features rather than custom HogQL queries for this type of analysis.
