# Q11: Session Duration and Editor Type Correlation

**Analysis Date:** 2026-01-03
**Time Period:** Last 30 days (2025-12-04 to 2026-01-03)
**Data Exclusions:** Test accounts filtered, `is_dev_user != true`

## Objective

Analyze the correlation between average session duration and editor type (markdown/monaco/mockup) to understand which editor types engage users for longer periods.

## Methodology

Used PostHog trends query to measure average session duration (`session_duration_ms` property) for `session_ended` events, broken down by `editor_type` property.

## Key Findings

### Data Availability Issue

**No session duration data available** for the analysis period.

- The `session_ended` event exists in the schema but returned zero results for all editor types
- Average session duration: **0 ms** for all editor types (markdown, monaco, mockup)
- This suggests either:
  1. Session tracking is not yet implemented in the current version
  2. Session duration is tracked via different events or properties
  3. The `session_ended` event is not being fired properly

## Recommendations

1. **Verify Session Tracking Implementation**
   - Check if `session_ended` event is being fired correctly
   - Verify `session_duration_ms` property is being captured
   - Consider if session tracking needs to be added/fixed

2. **Alternative Data Sources**
   - Investigate using `nimbalyst_session_start` event (424 DAU in period)
   - Calculate session duration from event timestamps rather than relying on explicit session_ended events
   - Consider tracking editor usage time through file editing events

3. **Future Analysis**
   - Once session tracking is implemented, re-run this analysis to understand:
     - Which editor types have longest engagement
     - Whether users switch between editors mid-session
     - Correlation between editor type and user retention

## Data Quality Notes

- `nimbalyst_session_start` event shows 424 daily active users, indicating active usage
- Other events (file operations, AI features) show healthy activity levels
- Only session duration tracking appears to be missing

## PostHog Query Used

```json
{
  "kind": "InsightVizNode",
  "source": {
    "kind": "TrendsQuery",
    "series": [
      {
        "kind": "EventsNode",
        "event": "session_ended",
        "custom_name": "Markdown Sessions",
        "math": "avg",
        "math_property": "session_duration_ms",
        "properties": [
          {"key": "editor_type", "operator": "exact", "value": "markdown", "type": "event"}
        ]
      },
      {
        "kind": "EventsNode",
        "event": "session_ended",
        "custom_name": "Monaco Sessions",
        "math": "avg",
        "math_property": "session_duration_ms",
        "properties": [
          {"key": "editor_type", "operator": "exact", "value": "monaco", "type": "event"}
        ]
      },
      {
        "kind": "EventsNode",
        "event": "session_ended",
        "custom_name": "Mockup Sessions",
        "math": "avg",
        "math_property": "session_duration_ms",
        "properties": [
          {"key": "editor_type", "operator": "exact", "value": "mockup", "type": "event"}
        ]
      }
    ],
    "dateRange": {"date_from": "-30d", "date_to": null},
    "filterTestAccounts": true,
    "interval": "day"
  }
}
```
