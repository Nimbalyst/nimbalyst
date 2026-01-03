# AI Response Patterns - Acceptance by Response Type Analysis

**Analysis Date:** January 3, 2026
**Time Period:** Last 90 days (October 5, 2025 - January 3, 2026)
**Data Filters:** Excluded `all_filtered_cohorts` cohort, `is_dev_user != true`, test accounts filtered

---

## 1. Research Question

Which AI response types (code, text, mixed, diff) have the highest acceptance rates? Analyze whether users are more likely to accept code-only responses vs. text explanations vs. mixed responses, and whether acceptance correlates with response length or streaming interruptions.

---

## 2. Queries Used

### Query 1: Response Type Distribution
```
TrendsQuery:
- Event: ai_response_received
- Breakdown: response_type property
- Math: total count
- Date Range: Last 90 days
- Filters: is_dev_user != true, exclude all_filtered_cohorts
```

### Query 2: Acceptance Rate by Response Type
```sql
WITH responses AS (
  SELECT properties.response_id,
         properties.response_type,
         properties.has_code,
         properties.has_text,
         properties.char_count,
         person_id
  FROM events
  WHERE event = 'ai_response_received'
    AND timestamp >= now() - INTERVAL 90 DAY
),
acceptances AS (
  SELECT properties.response_id,
         true as accepted
  FROM events
  WHERE event = 'ai_diff_accepted'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT r.response_type,
       count(DISTINCT r.response_id) as total_responses,
       count(DISTINCT a.response_id) as accepted_responses,
       round(count(DISTINCT a.response_id) * 100.0 / count(DISTINCT r.response_id), 2) as acceptance_rate
FROM responses r
LEFT JOIN acceptances a ON r.response_id = a.response_id
GROUP BY r.response_type
ORDER BY acceptance_rate DESC
```

### Query 3: Acceptance by Content Composition
```sql
WITH responses AS (
  SELECT properties.response_id,
         CASE
           WHEN properties.has_code AND NOT properties.has_text THEN 'code_only'
           WHEN properties.has_text AND NOT properties.has_code THEN 'text_only'
           WHEN properties.has_code AND properties.has_text THEN 'mixed'
           ELSE 'unknown'
         END as content_type,
         properties.char_count,
         person_id
  FROM events
  WHERE event = 'ai_response_received'
    AND timestamp >= now() - INTERVAL 90 DAY
),
acceptances AS (
  SELECT properties.response_id,
         true as accepted
  FROM events
  WHERE event = 'ai_diff_accepted'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT r.content_type,
       count(DISTINCT r.response_id) as total_responses,
       count(DISTINCT a.response_id) as accepted,
       round(count(DISTINCT a.response_id) * 100.0 / count(DISTINCT r.response_id), 2) as acceptance_rate,
       round(avg(r.char_count), 0) as avg_char_count
FROM responses r
LEFT JOIN acceptances a ON r.response_id = a.response_id
GROUP BY r.content_type
ORDER BY acceptance_rate DESC
```

### Query 4: Acceptance by Response Length Buckets
```sql
WITH responses AS (
  SELECT properties.response_id,
         properties.response_type,
         CASE
           WHEN properties.char_count < 500 THEN 'short'
           WHEN properties.char_count < 2000 THEN 'medium'
           WHEN properties.char_count < 5000 THEN 'long'
           ELSE 'very_long'
         END as length_bucket,
         properties.char_count
  FROM events
  WHERE event = 'ai_response_received'
    AND timestamp >= now() - INTERVAL 90 DAY
),
acceptances AS (
  SELECT properties.response_id,
         true as accepted
  FROM events
  WHERE event = 'ai_diff_accepted'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT r.length_bucket,
       count(DISTINCT r.response_id) as total_responses,
       count(DISTINCT a.response_id) as accepted,
       round(count(DISTINCT a.response_id) * 100.0 / count(DISTINCT r.response_id), 2) as acceptance_rate,
       min(r.char_count) as min_chars,
       max(r.char_count) as max_chars
FROM responses r
LEFT JOIN acceptances a ON r.response_id = a.response_id
GROUP BY r.length_bucket
ORDER BY min_chars
```

### Query 5: Impact of Streaming Interruptions
```sql
WITH responses AS (
  SELECT properties.response_id,
         properties.response_type,
         person_id
  FROM events
  WHERE event = 'ai_response_received'
    AND timestamp >= now() - INTERVAL 90 DAY
),
interruptions AS (
  SELECT properties.response_id,
         true as was_interrupted
  FROM events
  WHERE event = 'ai_stream_interrupted'
    AND timestamp >= now() - INTERVAL 90 DAY
),
acceptances AS (
  SELECT properties.response_id,
         true as accepted
  FROM events
  WHERE event = 'ai_diff_accepted'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT
  CASE WHEN i.was_interrupted THEN 'interrupted' ELSE 'completed' END as stream_status,
  count(DISTINCT r.response_id) as total_responses,
  count(DISTINCT a.response_id) as accepted,
  round(count(DISTINCT a.response_id) * 100.0 / count(DISTINCT r.response_id), 2) as acceptance_rate
FROM responses r
LEFT JOIN interruptions i ON r.response_id = i.response_id
LEFT JOIN acceptances a ON r.response_id = a.response_id
GROUP BY stream_status
```

### Query 6: Diff Responses Specifically
```sql
WITH diff_responses AS (
  SELECT properties.response_id,
         properties.diff_size,
         properties.files_changed,
         person_id
  FROM events
  WHERE event = 'ai_response_received'
    AND properties.response_type = 'diff'
    AND timestamp >= now() - INTERVAL 90 DAY
),
acceptances AS (
  SELECT properties.response_id,
         properties.acceptance_action,
         true as accepted
  FROM events
  WHERE event = 'ai_diff_accepted'
    AND timestamp >= now() - INTERVAL 90 DAY
)
SELECT
  CASE
    WHEN d.files_changed = 1 THEN 'single_file'
    WHEN d.files_changed <= 3 THEN 'few_files'
    WHEN d.files_changed <= 10 THEN 'many_files'
    ELSE 'very_many_files'
  END as diff_scope,
  count(DISTINCT d.response_id) as total_diffs,
  count(DISTINCT a.response_id) as accepted,
  round(count(DISTINCT a.response_id) * 100.0 / count(DISTINCT d.response_id), 2) as acceptance_rate,
  round(avg(d.diff_size), 0) as avg_diff_size
FROM diff_responses d
LEFT JOIN acceptances a ON d.response_id = a.response_id
GROUP BY diff_scope
ORDER BY total_diffs DESC
```

---

## 3. Raw Results

### Response Type Distribution

| Response Type | Total Responses | % of All Responses |
|--------------|----------------|-------------------|
| [diff] | [TBD] | [TBD]% |
| [code] | [TBD] | [TBD]% |
| [text] | [TBD] | [TBD]% |
| [mixed] | [TBD] | [TBD]% |

### Acceptance Rate by Response Type

| Response Type | Total Responses | Accepted | Acceptance Rate |
|--------------|----------------|----------|----------------|
| [diff] | [TBD] | [TBD] | [TBD]% |
| [code] | [TBD] | [TBD] | [TBD]% |
| [text] | [TBD] | [TBD] | [TBD]% |
| [mixed] | [TBD] | [TBD] | [TBD]% |

### Acceptance by Content Composition

| Content Type | Total | Accepted | Acceptance Rate | Avg Chars |
|-------------|-------|----------|----------------|-----------|
| code_only | [TBD] | [TBD] | [TBD]% | [TBD] |
| mixed | [TBD] | [TBD] | [TBD]% | [TBD] |
| text_only | [TBD] | [TBD] | [TBD]% | [TBD] |

### Acceptance by Response Length

| Length | Total | Accepted | Acceptance Rate | Char Range |
|--------|-------|----------|----------------|-----------|
| short | [TBD] | [TBD] | [TBD]% | 0-499 |
| medium | [TBD] | [TBD] | [TBD]% | 500-1999 |
| long | [TBD] | [TBD] | [TBD]% | 2000-4999 |
| very_long | [TBD] | [TBD] | [TBD]% | 5000+ |

### Impact of Streaming Interruptions

| Stream Status | Total | Accepted | Acceptance Rate |
|--------------|-------|----------|----------------|
| completed | [TBD] | [TBD] | [TBD]% |
| interrupted | [TBD] | [TBD] | [TBD]% |

### Diff Scope Impact

| Diff Scope | Total | Accepted | Acceptance Rate | Avg Diff Size |
|-----------|-------|----------|----------------|---------------|
| single_file | [TBD] | [TBD] | [TBD]% | [TBD] |
| few_files | [TBD] | [TBD] | [TBD]% | [TBD] |
| many_files | [TBD] | [TBD] | [TBD]% | [TBD] |
| very_many_files | [TBD] | [TBD] | [TBD]% | [TBD] |

---

## 4. Visualizations

### Recommended Charts

1. **Horizontal Bar Chart: Acceptance Rate by Response Type**
   - Y-axis: Response types (diff, code, text, mixed)
   - X-axis: Acceptance rate percentage
   - Color code by rate (green >70%, yellow 40-70%, red <40%)

2. **Grouped Bar Chart: Volume vs. Acceptance**
   - Groups: Response types
   - Bars: Total responses (blue), Accepted responses (green)
   - Shows both popularity and acceptance

3. **Line Chart: Acceptance Rate by Response Length**
   - X-axis: Character count buckets
   - Y-axis: Acceptance rate
   - Shows optimal response length

4. **Comparison Chart: Interrupted vs. Completed Streams**
   - Side-by-side bars showing acceptance rates
   - Highlights impact of interruptions

5. **Scatter Plot: Response Length vs. Acceptance**
   - X-axis: Character count
   - Y-axis: Acceptance (0 or 1)
   - Color by response type
   - Shows patterns and outliers

---

## 5. Takeaways

### Expected Findings

1. **Code/diff responses likely have higher acceptance:**
   - Actionable outputs are easier to evaluate
   - Clear value proposition (saves typing)

2. **Text-only responses may have lower acceptance:**
   - Harder to measure "acceptance"
   - May not have accept/reject UI

3. **Length correlation:**
   - Very short responses: Low acceptance (incomplete)
   - Medium responses: Optimal acceptance (right-sized)
   - Very long responses: Lower acceptance (overwhelming)

### Potential Insights

4. **Mixed responses performance:**
   - If high acceptance: Users value explanations with code
   - If low acceptance: Too much information, users want concise code

5. **Interruption impact:**
   - If interrupted responses have low acceptance: Users need complete responses
   - If similar acceptance: Users can evaluate partial responses

6. **Diff scope sweet spot:**
   - Single file changes likely highest acceptance (easy to review)
   - Multi-file changes lower (harder to verify)

---

## 6. Suggested Actions / Product Direction

### If Code/Diff Have Highest Acceptance

1. **Optimize for actionable outputs:**
   - Encourage AI to provide code over explanations
   - Add "show me the code" quick action
   - Detect when text response would be better as code

2. **Improve diff UX:**
   - Make review faster (quick approve/reject)
   - Add partial acceptance for multi-file diffs
   - Show confidence scores per change

### If Length Correlates Negatively

3. **Response length guidance:**
   - Set optimal length targets for AI responses
   - Break long responses into chunks
   - Add "show more" for explanatory text

4. **Progressive disclosure:**
   - Show code first, explanation on expand
   - Summary view with detail on demand

### If Interruptions Hurt Acceptance

5. **Improve streaming reliability:**
   - Better error handling
   - Resume capability
   - Show partial results more clearly

6. **User control:**
   - Pause/resume streaming
   - Accept partial responses
   - Regenerate from interruption point

### If Mixed Responses Perform Poorly

7. **Separate code and explanation:**
   - Code block first, explanation collapsed
   - "Explain this code" secondary action
   - User preference for verbosity level

### General Improvements

8. **A/B test response formats:**
   - Code-first vs. explanation-first
   - Verbose vs. concise
   - Inline comments vs. separate explanation

9. **Track response quality:**
   - Add feedback mechanism beyond accept/reject
   - "This was helpful because..." prompts
   - Learn which formats work for which queries

10. **Acceptance prediction:**
    - Use ML to predict acceptance likelihood
    - Adjust response style based on context
    - Surface low-confidence responses for review

---

## Appendix: Data Quality Notes

- **Cohort Exclusions:** Excluded `all_filtered_cohorts` and `is_dev_user = true`
- **Time Period:** 90-day window from October 5, 2025 to January 3, 2026
- **Event Tracking:** Based on `ai_response_received`, `ai_diff_accepted`, `ai_stream_interrupted`
- **Response Types:** May vary by AI provider implementation
- **Acceptance Definition:** Explicit user action (accept button), not implicit usage
- **Response ID:** Used for attribution between response and acceptance events
