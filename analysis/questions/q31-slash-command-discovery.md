# Slash Command Discovery Timeline - Time-to-First-Use Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

How long after first app use do users discover slash commands? Track the distribution of discovery times (same day, 1-7 days, 7-30 days, never) and identify which commands are discovered first vs. which remain undiscovered even by active users.

---

## 2. Queries Used

### Query 1: Time to First Slash Command Use
```sql
WITH user_first_session AS (
  SELECT person_id,
         min(timestamp) as first_app_use
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
user_first_slash AS (
  SELECT person_id,
         min(timestamp) as first_slash_use
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
)
SELECT
  CASE
    WHEN dateDiff('day', ufs.first_app_use, ufsl.first_slash_use) = 0 THEN 'same_day'
    WHEN dateDiff('day', ufs.first_app_use, ufsl.first_slash_use) <= 7 THEN '1-7_days'
    WHEN dateDiff('day', ufs.first_app_use, ufsl.first_slash_use) <= 30 THEN '8-30_days'
    WHEN dateDiff('day', ufs.first_app_use, ufsl.first_slash_use) > 30 THEN '30+_days'
    ELSE 'never'
  END as discovery_timeline,
  count(DISTINCT ufs.person_id) as user_count,
  round(count(DISTINCT ufs.person_id) * 100.0 / (SELECT count(*) FROM user_first_session), 2) as pct_of_users
FROM user_first_session ufs
LEFT JOIN user_first_slash ufsl ON ufs.person_id = ufsl.person_id
GROUP BY discovery_timeline
ORDER BY
  CASE discovery_timeline
    WHEN 'same_day' THEN 1
    WHEN '1-7_days' THEN 2
    WHEN '8-30_days' THEN 3
    WHEN '30+_days' THEN 4
    WHEN 'never' THEN 5
  END
```

### Query 2: First Command Discovered by Users
```sql
WITH user_first_slash AS (
  SELECT person_id,
         properties.command_name,
         timestamp,
         row_number() OVER (PARTITION BY person_id ORDER BY timestamp) as command_rank
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT command_name as first_command_discovered,
       count(*) as user_count,
       round(count(*) * 100.0 / (SELECT count(DISTINCT person_id) FROM user_first_slash WHERE command_rank = 1), 2) as pct_of_discoverers
FROM user_first_slash
WHERE command_rank = 1
GROUP BY command_name
ORDER BY user_count DESC
```

### Query 3: Command Adoption Rate by User Activity Level
```sql
WITH user_activity AS (
  SELECT person_id,
         count(*) as total_events,
         min(timestamp) as first_seen,
         max(timestamp) as last_seen,
         dateDiff('day', min(timestamp), max(timestamp)) as days_active
  FROM events
  WHERE timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
user_slash_usage AS (
  SELECT person_id,
         count(DISTINCT properties.command_name) as unique_commands_used,
         count(*) as total_slash_uses
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id
),
activity_levels AS (
  SELECT ua.person_id,
         CASE
           WHEN ua.total_events < 100 THEN 'low_activity'
           WHEN ua.total_events < 500 THEN 'medium_activity'
           ELSE 'high_activity'
         END as activity_level,
         ua.days_active,
         COALESCE(usu.unique_commands_used, 0) as commands_discovered,
         COALESCE(usu.total_slash_uses, 0) as slash_uses
  FROM user_activity ua
  LEFT JOIN user_slash_usage usu ON ua.person_id = usu.person_id
)
SELECT activity_level,
       count(*) as total_users,
       countIf(commands_discovered > 0) as users_using_slashes,
       round(countIf(commands_discovered > 0) * 100.0 / count(*), 2) as adoption_rate,
       round(avg(commands_discovered), 1) as avg_commands_per_user
FROM activity_levels
GROUP BY activity_level
ORDER BY
  CASE activity_level
    WHEN 'low_activity' THEN 1
    WHEN 'medium_activity' THEN 2
    WHEN 'high_activity' THEN 3
  END
```

### Query 4: Undiscovered Commands (Active Users Only)
```sql
WITH active_users AS (
  SELECT person_id
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
  GROUP BY person_id
  HAVING count(*) >= 50 -- active users with 50+ events
),
command_usage AS (
  SELECT person_id,
         properties.command_name
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
),
all_commands AS (
  SELECT DISTINCT properties.command_name as command
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT ac.command,
       count(DISTINCT au.person_id) as active_users,
       count(DISTINCT cu.person_id) as users_who_used_command,
       count(DISTINCT au.person_id) - count(DISTINCT cu.person_id) as users_havent_discovered,
       round(count(DISTINCT cu.person_id) * 100.0 / count(DISTINCT au.person_id), 2) as discovery_rate
FROM active_users au
CROSS JOIN all_commands ac
LEFT JOIN command_usage cu
  ON au.person_id = cu.person_id
  AND ac.command = cu.command_name
GROUP BY ac.command
ORDER BY discovery_rate ASC
```

### Query 5: Discovery Method Analysis
```sql
WITH slash_discoveries AS (
  SELECT person_id,
         properties.command_name,
         properties.discovery_method, -- e.g., 'autocomplete', 'documentation', 'tooltip'
         min(timestamp) as first_use
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
  GROUP BY person_id, properties.command_name, properties.discovery_method
)
SELECT discovery_method,
       count(*) as discovery_count,
       count(DISTINCT person_id) as unique_users,
       count(DISTINCT command_name) as unique_commands,
       round(count(*) * 100.0 / (SELECT count(*) FROM slash_discoveries), 2) as pct_of_discoveries
FROM slash_discoveries
WHERE discovery_method IS NOT NULL
GROUP BY discovery_method
ORDER BY discovery_count DESC
```

### Query 6: Progressive Command Discovery
```sql
WITH user_command_timeline AS (
  SELECT person_id,
         properties.command_name,
         timestamp,
         row_number() OVER (PARTITION BY person_id ORDER BY timestamp) as discovery_order
  FROM events
  WHERE event = 'slash_command_used'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT discovery_order,
       count(DISTINCT person_id) as users_reaching_this_level,
       round(count(DISTINCT person_id) * 100.0 / (SELECT count(DISTINCT person_id) FROM user_command_timeline), 2) as pct_of_slash_users,
       groupUniqArray(5)(command_name) as common_commands_at_level
FROM user_command_timeline
WHERE discovery_order <= 10
GROUP BY discovery_order
ORDER BY discovery_order
```

---

## 3. Raw Results

### Time to First Slash Command Discovery

| Discovery Timeline | User Count | % of All Users |
|-------------------|-----------|---------------|
| Same day | [TBD] | [TBD]% |
| 1-7 days | [TBD] | [TBD]% |
| 8-30 days | [TBD] | [TBD]% |
| 30+ days | [TBD] | [TBD]% |
| Never discovered | [TBD] | [TBD]% |

### First Commands Discovered

| Command | User Count | % of Discoverers |
|---------|-----------|-----------------|
| [/help] | [TBD] | [TBD]% |
| [/new] | [TBD] | [TBD]% |
| [/commit] | [TBD] | [TBD]% |
| [/search] | [TBD] | [TBD]% |

### Command Adoption by Activity Level

| Activity Level | Total Users | Users Using Slashes | Adoption Rate | Avg Commands |
|---------------|------------|-------------------|--------------|-------------|
| Low activity | [TBD] | [TBD] | [TBD]% | [TBD] |
| Medium activity | [TBD] | [TBD] | [TBD]% | [TBD] |
| High activity | [TBD] | [TBD] | [TBD]% | [TBD] |

### Undiscovered Commands (Active Users)

| Command | Active Users | Users Who Used | Haven't Discovered | Discovery Rate |
|---------|-------------|---------------|-------------------|---------------|
| [command_1] | [TBD] | [TBD] | [TBD] | [TBD]% |
| [command_2] | [TBD] | [TBD] | [TBD] | [TBD]% |

### Discovery Methods

| Method | Discoveries | Unique Users | % of All Discoveries |
|--------|------------|-------------|---------------------|
| [autocomplete] | [TBD] | [TBD] | [TBD]% |
| [documentation] | [TBD] | [TBD] | [TBD]% |
| [tooltip] | [TBD] | [TBD] | [TBD]% |

### Progressive Discovery Pattern

| Nth Command | Users Reaching | % of Slash Users | Common Commands |
|------------|---------------|-----------------|----------------|
| 1st | [TBD] | 100% | [TBD] |
| 2nd | [TBD] | [TBD]% | [TBD] |
| 3rd | [TBD] | [TBD]% | [TBD] |
| 5th | [TBD] | [TBD]% | [TBD] |
| 10th | [TBD] | [TBD]% | [TBD] |

---

## 4. Visualizations

### Recommended Charts

1. **Stacked Area Chart: Cumulative Discovery Over Time**
   - X-axis: Days since first app use
   - Y-axis: % of users who discovered slashes
   - Shows discovery curve

2. **Bar Chart: First Commands Discovered**
   - Y-axis: Command names
   - X-axis: Number of users
   - Shows entry points into slash commands

3. **Grouped Bar Chart: Adoption by Activity Level**
   - Groups: Activity levels
   - Bars: Total users vs. Slash users
   - Shows correlation between activity and discovery

4. **Heat Map: Command Discovery Rates**
   - Rows: Commands
   - Columns: User segments (new, intermediate, power)
   - Color intensity: Discovery rate
   - Shows which commands are universally vs. niche

5. **Funnel Chart: Progressive Command Discovery**
   - Steps: 1st, 2nd, 3rd, 5th, 10th command
   - Shows drop-off in exploration

---

## 5. Takeaways

### Expected Findings

1. **Discovery timeline:**
   - Target: >50% discover within 7 days
   - If lower: Discoverability problem
   - If higher: Good onboarding/affordance

2. **Never-discover rate:**
   - Target: <30% never discover
   - If higher: Critical feature hidden
   - Need better prompts/education

3. **Activity correlation:**
   - High activity users should have >80% adoption
   - If not: Feature not compelling even to power users

### Potential Insights

4. **First commands shape perception:**
   - If /help is first: Users seeking guidance
   - If /commit is first: Users doing real work
   - If /new is first: Users exploring features

5. **Undiscovered commands:**
   - Commands with <20% discovery by active users: Poor discoverability
   - Commands with >80% discovery: Well-promoted or essential

6. **Discovery methods:**
   - If autocomplete dominates: Typing interface works
   - If documentation dominates: Users actively seeking features
   - If tooltips dominate: UI hints effective

---

## 6. Suggested Actions / Product Direction

### If Discovery is Slow (>30% take 8+ days)

1. **Improve onboarding:**
   - Slash command tutorial
   - Interactive walkthrough
   - First-use tooltip on text input
   - "Try typing /" prompt

2. **Better affordance:**
   - Visual "/" indicator in input field
   - Animated hint on first few sessions
   - Command palette keyboard shortcut

### If Many Users Never Discover (<50% adoption)

3. **Active promotion:**
   - In-app notifications about slash commands
   - Contextual suggestions ("Try /commit")
   - Email campaign for inactive features

4. **Reduce friction:**
   - Auto-show command menu on "/"
   - Make autocomplete instant
   - Add search/fuzzy matching

### If Certain Commands Remain Hidden

5. **Improve command discoverability:**
   - Surface less-known commands in autocomplete
   - "Command of the day" feature
   - Group commands by use case
   - Add command categories

6. **Context-aware suggestions:**
   - Suggest /commit when in git repo
   - Suggest /search in large workspaces
   - Suggest /test in test files

### If Discovery Methods Vary

7. **Optimize high-performing methods:**
   - If autocomplete works: Improve it further
   - If docs work: Create video tutorials
   - If tooltips work: Add more contextual hints

8. **Address underperforming methods:**
   - If docs have low impact: Improve docs
   - If tooltips ignored: Make them more prominent
   - If autocomplete unused: Improve trigger UX

### General Improvements

9. **Progressive disclosure:**
   - Start with essential commands (new, help, commit)
   - Gradually introduce advanced commands
   - Track user journey and adapt

10. **Measure command value:**
    - Track usage frequency after discovery
    - Identify high-value vs. low-value commands
    - Prioritize discoverability for high-value ones

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `slash_command_used` event
- **First App Use:** Minimum timestamp across all events for user
- **Active Users:** Users with 50+ events in last 30 days
- **Discovery Method:** May not be tracked for all slash command uses
- **Command List:** Depends on which commands are instrumented in codebase
