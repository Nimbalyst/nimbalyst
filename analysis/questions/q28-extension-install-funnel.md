# Extension Install Funnel - Settings to Install Success Rates Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

What percentage of users who view extension settings successfully install an extension? Track the funnel from settings view → browse extensions → install attempt → install success, and identify where users drop off (failed installs, configuration issues, cancelled installations).

---

## 2. Queries Used

### Query 1: Extension Settings Funnel
```
FunnelQuery:
- Steps:
  1. extension_settings_opened
  2. extension_browse_opened
  3. extension_install_started
  4. extension_installed
- Date Range: Last 90 days
- Conversion window: 1 hour
- Filters: is_dev_user != true, exclude all_filtered_cohorts
```

### Query 2: Extended Funnel with Failures
```
FunnelQuery:
- Steps:
  1. extension_settings_opened
  2. extension_browse_opened
  3. extension_install_started
  4. extension_installed OR extension_install_failed
- Date Range: Last 90 days
- Breakdown by: outcome (success vs failure)
```

### Query 3: Install Failure Reasons
```sql
WITH install_attempts AS (
  SELECT properties.extension_id,
         properties.extension_name,
         person_id,
         timestamp as attempt_time
  FROM events
  WHERE event = 'extension_install_started'
    AND timestamp >= now() - INTERVAL 90 DAY
),
failures AS (
  SELECT properties.extension_id,
         properties.failure_reason,
         properties.error_message,
         person_id,
         timestamp as failure_time
  FROM events
  WHERE event = 'extension_install_failed'
    AND timestamp >= now() - INTERVAL 90 DAY
),
successes AS (
  SELECT properties.extension_id,
         person_id,
         timestamp as success_time
  FROM events
  WHERE event = 'extension_installed'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT f.failure_reason,
       count(*) as failure_count,
       round(count(*) * 100.0 / (SELECT count(*) FROM failures), 2) as pct_of_failures
FROM failures f
GROUP BY f.failure_reason
ORDER BY failure_count DESC
```

### Query 4: Time to Install Success
```sql
WITH install_starts AS (
  SELECT properties.extension_id,
         person_id,
         timestamp as start_time
  FROM events
  WHERE event = 'extension_install_started'
    AND timestamp >= now() - INTERVAL 90 DAY
),
install_success AS (
  SELECT properties.extension_id,
         person_id,
         timestamp as success_time
  FROM events
  WHERE event = 'extension_installed'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT
  CASE
    WHEN dateDiff('second', ist.start_time, isn.success_time) <= 10 THEN '0-10s'
    WHEN dateDiff('second', ist.start_time, isn.success_time) <= 30 THEN '11-30s'
    WHEN dateDiff('second', ist.start_time, isn.success_time) <= 60 THEN '31-60s'
    WHEN dateDiff('second', ist.start_time, isn.success_time) <= 300 THEN '1-5min'
    ELSE '5min+'
  END as install_duration,
  count(*) as install_count
FROM install_starts ist
JOIN install_success isn
  ON ist.extension_id = isn.extension_id
  AND ist.person_id = isn.person_id
  AND isn.success_time > ist.start_time
  AND dateDiff('hour', ist.start_time, isn.success_time) <= 1
GROUP BY install_duration
ORDER BY install_count DESC
```

### Query 5: Cancelled Installations
```sql
SELECT count(DISTINCT person_id) as users_who_cancelled,
       count(*) as total_cancellations,
       round(count(*) * 1.0 / count(DISTINCT person_id), 2) as avg_cancels_per_user
FROM events
WHERE event = 'extension_install_cancelled'
  AND timestamp >= now() - INTERVAL 90 DAY
```

### Query 6: Configuration Step Drop-off
```
FunnelQuery:
- Steps:
  1. extension_installed
  2. extension_config_opened
  3. extension_config_saved
  4. extension_activated
- Date Range: Last 90 days
- Conversion window: 24 hours
```

### Query 7: Most Installed Extensions
```sql
SELECT properties.extension_id,
       properties.extension_name,
       count(DISTINCT person_id) as unique_installers,
       count(*) as total_installs
FROM events
WHERE event = 'extension_installed'
  AND timestamp >= now() - INTERVAL 90 DAY
GROUP BY properties.extension_id, properties.extension_name
ORDER BY unique_installers DESC
LIMIT 20
```

---

## 3. Raw Results

### Main Funnel: Settings to Install

| Funnel Step | Users | Conversion Rate | Drop-off Rate |
|------------|-------|----------------|---------------|
| Opened extension settings | [TBD] | 100% | - |
| Browsed extensions | [TBD] | [TBD]% | [TBD]% |
| Started install | [TBD] | [TBD]% | [TBD]% |
| Successfully installed | [TBD] | [TBD]% | [TBD]% |

**Overall Settings → Install Rate:** [TBD]%

### Install Outcomes

| Outcome | Count | % of Install Attempts |
|---------|-------|---------------------|
| Success | [TBD] | [TBD]% |
| Failed | [TBD] | [TBD]% |
| Cancelled | [TBD] | [TBD]% |
| Abandoned | [TBD] | [TBD]% |

### Install Failure Reasons

| Failure Reason | Count | % of Failures |
|---------------|-------|--------------|
| [dependency_missing] | [TBD] | [TBD]% |
| [network_error] | [TBD] | [TBD]% |
| [permission_denied] | [TBD] | [TBD]% |
| [incompatible_version] | [TBD] | [TBD]% |
| [unknown_error] | [TBD] | [TBD]% |

### Install Duration

| Duration | Successful Installs | % of Successes |
|----------|-------------------|---------------|
| 0-10 seconds | [TBD] | [TBD]% |
| 11-30 seconds | [TBD] | [TBD]% |
| 31-60 seconds | [TBD] | [TBD]% |
| 1-5 minutes | [TBD] | [TBD]% |
| 5+ minutes | [TBD] | [TBD]% |

### Configuration Funnel

| Step | Users | Conversion Rate |
|------|-------|----------------|
| Extension installed | [TBD] | 100% |
| Config opened | [TBD] | [TBD]% |
| Config saved | [TBD] | [TBD]% |
| Extension activated | [TBD] | [TBD]% |

### Most Popular Extensions

| Extension Name | Unique Installers | Total Installs |
|---------------|------------------|---------------|
| [Extension 1] | [TBD] | [TBD] |
| [Extension 2] | [TBD] | [TBD] |
| [Extension 3] | [TBD] | [TBD] |

---

## 4. Visualizations

### Recommended Charts

1. **Funnel Chart: Settings to Install**
   - Standard funnel showing 4 steps
   - Drop-off percentages between each step
   - Highlights where users abandon process

2. **Pie Chart: Install Outcomes**
   - Segments: Success, Failed, Cancelled, Abandoned
   - Shows success rate vs. problem areas

3. **Horizontal Bar Chart: Failure Reasons**
   - Y-axis: Failure types
   - X-axis: Count
   - Sorted by frequency
   - Highlights top issues to fix

4. **Histogram: Time to Install**
   - X-axis: Duration buckets
   - Y-axis: Number of installs
   - Shows typical install time

5. **Sankey Diagram: Full User Journey**
   - From settings → browse → install → configure → activate
   - Shows all paths including failures and drop-offs

---

## 5. Takeaways

### Expected Findings

1. **Browsing drop-off (Settings → Browse):**
   - If high (>30%): Users not finding compelling extensions
   - If low (<10%): Good discoverability

2. **Install initiation (Browse → Start Install):**
   - If high drop-off: Extensions not appealing or unclear value
   - If low drop-off: Good extension descriptions and trust signals

3. **Install success rate (Start → Success):**
   - Target: >90% success rate
   - If lower: Technical issues need addressing

4. **Common failure patterns:**
   - Dependency issues: Extension ecosystem maturity problem
   - Network errors: Infrastructure reliability
   - Permission errors: User understanding or system security

### Potential Insights

5. **Configuration abandonment:**
   - If >30% don't configure after install: Config is too complex
   - If >50%: Extensions may not need config (good!)

6. **Install duration:**
   - Most installs should be <30 seconds
   - Long installs (>1 minute) may cause user anxiety

7. **Cancellation patterns:**
   - If users cancel frequently: Install process too slow or unclear
   - If low cancellation: Good UX and expectations setting

---

## 6. Suggested Actions / Product Direction

### If Browse Drop-off is High

1. **Improve extension discovery:**
   - Better categorization
   - Featured extensions section
   - Personalized recommendations
   - User ratings and reviews

2. **Clearer value proposition:**
   - Show screenshots/demos
   - "Most popular" badges
   - Use case examples

### If Install Failures are Common

3. **Address top failure reasons:**
   - Pre-check dependencies before install
   - Better error messages with solutions
   - Automatic retry on network errors
   - Version compatibility checks

4. **Improve install UX:**
   - Show progress bar
   - Explain what's happening
   - Set time expectations
   - Offer offline install option

### If Configuration Drop-off is High

5. **Simplify configuration:**
   - Sensible defaults
   - Guided setup wizard
   - "Quick setup" vs. "Advanced" options
   - Skip configuration if not required

6. **Better onboarding:**
   - Extension-specific tutorials
   - Example configurations
   - "Test your extension" step

### General Improvements

7. **Install success optimizations:**
   - Dependency bundling
   - Faster downloads (CDN)
   - Background installation option
   - Batch install capability

8. **Trust and transparency:**
   - Permission explanations
   - Developer verification
   - Security scanning results
   - Community ratings

9. **Recovery mechanisms:**
   - Auto-retry failed installs
   - Resume interrupted installs
   - Rollback bad installs
   - Easy uninstall/reinstall

10. **Funnel optimization:**
    - A/B test install button placement
    - Experiment with one-click install
    - Try "install and configure later" option
    - Reduce steps where possible

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `extension_settings_opened`, `extension_browse_opened`, `extension_install_started`, `extension_installed`, `extension_install_failed`, `extension_install_cancelled`
- **Conversion Window:** 1 hour for install funnel, 24 hours for configuration funnel
- **Attribution:** Events linked by extension_id and person_id
- **Success Definition:** `extension_installed` event fired without prior failure
