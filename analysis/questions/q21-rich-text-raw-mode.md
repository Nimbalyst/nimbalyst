# Q21: Rich Text (Lexical) vs Raw Mode (Monaco) Usage

## Question
What is the DAU split between Lexical editor (rich text) and Monaco editor (raw mode) users, and how do mode switchers differ in save frequency?

## Hypothesis
Some users prefer raw mode for technical editing while others prefer rich text, and users who switch between modes may have different editing patterns and save frequencies.

## Key Metrics
- DAU using Lexical vs Monaco (exclusive and overlapping)
- Mode switching frequency and patterns
- Save frequency by preferred mode
- Session duration by editor mode

## PostHog Analysis

### Query 1: Daily Editor Mode Usage Split
```hogql
SELECT
  toDate(timestamp) as date,
  COUNT(DISTINCT CASE WHEN uses_lexical AND NOT uses_monaco THEN person_id END) as lexical_only_dau,
  COUNT(DISTINCT CASE WHEN uses_monaco AND NOT uses_lexical THEN person_id END) as monaco_only_dau,
  COUNT(DISTINCT CASE WHEN uses_lexical AND uses_monaco THEN person_id END) as both_modes_dau,
  COUNT(DISTINCT person_id) as total_dau
FROM (
  SELECT
    person_id,
    toDate(timestamp) as date,
    MAX(CASE WHEN properties.editorType = 'lexical' THEN 1 ELSE 0 END) as uses_lexical,
    MAX(CASE WHEN properties.editorType = 'monaco' THEN 1 ELSE 0 END) as uses_monaco
  FROM events
  WHERE
    event IN ('file_opened', 'file_edited', 'file_saved')
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.editorType IN ('lexical', 'monaco')
  GROUP BY person_id, toDate(timestamp)
)
GROUP BY date
ORDER BY date DESC
LIMIT 30
```

### Query 2: Mode Switcher Identification and Behavior
```hogql
SELECT
  user_mode_preference,
  COUNT(DISTINCT person_id) as user_count,
  AVG(mode_switches) as avg_mode_switches,
  AVG(saves_per_day) as avg_saves_per_day,
  AVG(edit_events_per_day) as avg_edits_per_day
FROM (
  SELECT
    person_id,
    CASE
      WHEN lexical_days > 0 AND monaco_days = 0 THEN 'lexical_only'
      WHEN monaco_days > 0 AND lexical_days = 0 THEN 'monaco_only'
      WHEN lexical_days > monaco_days * 2 THEN 'lexical_primary'
      WHEN monaco_days > lexical_days * 2 THEN 'monaco_primary'
      ELSE 'balanced_switcher'
    END as user_mode_preference,
    mode_switches,
    total_saves / NULLIF(active_days, 0) as saves_per_day,
    total_edits / NULLIF(active_days, 0) as edit_events_per_day
  FROM (
    SELECT
      person_id,
      COUNT(DISTINCT CASE WHEN editor_type = 'lexical' THEN toDate(timestamp) END) as lexical_days,
      COUNT(DISTINCT CASE WHEN editor_type = 'monaco' THEN toDate(timestamp) END) as monaco_days,
      COUNT(DISTINCT toDate(timestamp)) as active_days,
      SUM(CASE WHEN prev_editor != editor_type THEN 1 ELSE 0 END) as mode_switches,
      COUNT(CASE WHEN event = 'file_saved' THEN 1 END) as total_saves,
      COUNT(CASE WHEN event = 'file_edited' THEN 1 END) as total_edits
    FROM (
      SELECT
        person_id,
        timestamp,
        event,
        properties.editorType as editor_type,
        lagInFrame(properties.editorType, 1) OVER (PARTITION BY person_id ORDER BY timestamp) as prev_editor
      FROM events
      WHERE
        event IN ('file_opened', 'file_edited', 'file_saved')
        AND timestamp >= now() - INTERVAL 30 DAY
        AND properties.is_dev_user != true
        AND NOT has(['all_filtered_cohorts'], cohort)
        AND properties.editorType IN ('lexical', 'monaco')
    )
    GROUP BY person_id
  )
)
GROUP BY user_mode_preference
ORDER BY user_count DESC
```

### Query 3: Save Frequency by Editor Mode
```hogql
SELECT
  editor_type,
  COUNT(DISTINCT person_id) as users,
  COUNT(*) as total_saves,
  COUNT(*) / COUNT(DISTINCT person_id) as saves_per_user,
  quantile(0.5)(saves_per_session) as median_saves_per_session,
  quantile(0.75)(saves_per_session) as p75_saves_per_session
FROM (
  SELECT
    person_id,
    properties.editorType as editor_type,
    properties.$session_id as session_id,
    COUNT(*) as saves_per_session
  FROM events
  WHERE
    event = 'file_saved'
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.editorType IN ('lexical', 'monaco')
  GROUP BY person_id, editor_type, session_id
)
GROUP BY editor_type
ORDER BY editor_type
```

### Query 4: File Type Preferences by Editor Mode
```hogql
SELECT
  editor_type,
  file_extension,
  COUNT(*) as open_count,
  COUNT(DISTINCT person_id) as unique_users,
  (COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY editor_type)) as pct_of_mode_usage
FROM (
  SELECT
    person_id,
    properties.editorType as editor_type,
    CASE
      WHEN properties.fileExtension IS NOT NULL AND properties.fileExtension != ''
      THEN properties.fileExtension
      ELSE splitByChar('.', properties.filePath)[-1]
    END as file_extension
  FROM events
  WHERE
    event = 'file_opened'
    AND timestamp >= now() - INTERVAL 30 DAY
    AND properties.is_dev_user != true
    AND NOT has(['all_filtered_cohorts'], cohort)
    AND properties.editorType IN ('lexical', 'monaco')
)
WHERE file_extension != ''
GROUP BY editor_type, file_extension
HAVING open_count > 10
ORDER BY editor_type, open_count DESC
LIMIT 20
```

## Expected Insights
- Daily usage split between Lexical and Monaco editors
- Proportion of users who switch between modes vs those who stick to one
- Save frequency differences between editor modes and mode switchers
- File type preferences that drive editor mode selection

## Follow-up Questions
- Do mode switchers have higher retention than single-mode users?
- Are there specific file types that predict mode switching behavior?
- How does editor mode preference correlate with other features like AI usage or git operations?
