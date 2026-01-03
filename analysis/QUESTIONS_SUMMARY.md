# PostHog Analytics Questions - Complete Summary

**Total Questions:** 97
**Status:** All templates created and ready for implementation
**Last Updated:** 2026-01-03

## Overview

This document provides a comprehensive summary of all 97 analytics questions designed to drive data-informed product decisions for Nimbalyst. Each question has a dedicated template file with detailed analysis approach, required events, cohorts, and success metrics.

## Critical Filter Requirements

**ALL ANALYSES MUST:**
- Exclude the `all_filtered_cohorts` cohort
- Filter where `is_dev_user != true`

This ensures analysis focuses on real user behavior, excluding internal testing and development activity.

## Question Categories

### 1. Growth & Acquisition (Q1-Q5)
- **Q1:** User acquisition channels and effectiveness
- **Q2:** Conversion rates from trial to paid
- **Q3:** Activation rate and time to first value
- **Q4:** Referral program effectiveness
- **Q5:** Viral coefficient and organic growth

**Priority:** High - Foundation for growth strategy

### 2. Engagement & Retention (Q6-Q15)
- **Q6:** DAU/WAU/MAU trends and seasonality
- **Q7:** Session duration and depth patterns
- **Q8:** Feature usage frequency distributions
- **Q9:** Power user identification and behavior
- **Q10:** User lifecycle stages and transitions
- **Q11:** Retention curves by cohort
- **Q12:** Churn prediction signals
- **Q13:** Re-activation of dormant users
- **Q14:** Habit formation indicators
- **Q15:** Engagement scoring models

**Priority:** High - Core product health metrics

### 3. AI Features (Q16-Q24)
- **Q16:** AI provider and model usage patterns
- **Q17:** AI feature adoption rates
- **Q18:** Prompt engineering patterns
- **Q19:** AI-generated content quality perception
- **Q20:** AI feature retention impact
- **Q21:** MCP tool usage patterns
- **Q22:** AI model switching behavior
- **Q23:** AI cost per user and optimization
- **Q24:** AI feature discovery pathways

**Priority:** High - Core product differentiator

### 4. Feature Discovery & Adoption (Q25-Q30)
- **Q25:** Feature discovery pathways
- **Q26:** Collaboration feature adoption
- **Q27:** Extension ecosystem usage
- **Q28:** Advanced formatting adoption
- **Q29:** Keyboard shortcuts mastery
- **Q30:** Template usage patterns

**Priority:** Medium - Feature optimization

### 5. Monetization & Premium (Q31-Q40)
- **Q31:** Free-to-paid conversion triggers
- **Q32:** Pricing tier satisfaction
- **Q33:** Feature paywall effectiveness
- **Q34:** Upgrade friction points
- **Q35:** Premium feature utilization
- **Q36:** Price sensitivity analysis
- **Q37:** Discount and promotion effectiveness
- **Q38:** Enterprise sales cycle analysis
- **Q39:** Premium tier usage patterns
- **Q40:** Payment method preferences

**Priority:** High - Revenue optimization

### 6. Performance & Technical (Q41-Q55)
- **Q41:** App launch time impact
- **Q42:** Sync latency tolerance
- **Q43:** Memory usage patterns
- **Q44:** Crash frequency and impact
- **Q45:** Platform-specific issues
- **Q46:** Network resilience
- **Q47:** Battery consumption (mobile)
- **Q48:** Storage usage patterns
- **Q49:** Extension performance impact
- **Q50:** Search performance
- **Q51:** Document size limits
- **Q52:** Export/import success rates
- **Q53:** Auto-save reliability
- **Q54:** Error recovery patterns
- **Q55:** Performance degradation triggers

**Priority:** High - User experience foundation

### 7. Mobile Experience (Q56-Q60)
- **Q56:** Mobile vs desktop usage patterns
- **Q57:** Mobile-specific feature gaps
- **Q58:** Mobile onboarding completion
- **Q59:** Mobile gesture usage
- **Q60:** Mobile notification effectiveness

**Priority:** Medium - Platform parity

### 8. Workspace & Organization (Q61-Q70)
- **Q61:** Multi-workspace usage
- **Q62:** Document organization patterns
- **Q63:** Search effectiveness
- **Q64:** Tag and metadata usage
- **Q65:** Folder hierarchy depth
- **Q66:** Workspace switching frequency
- **Q67:** Document archival patterns
- **Q68:** Bulk operations usage
- **Q69:** Workspace templates
- **Q70:** Cross-workspace workflows

**Priority:** Medium - Organization features

### 9. Collaboration & Sharing (Q71-Q75)
- **Q71:** Commenting and annotation adoption
- **Q72:** Team approval workflows
- **Q73:** Enterprise feature stacking
- **Q74:** Sharing with CollabV3
- **Q75:** Permission grants in enterprise

**Priority:** High - Team/enterprise focus

### 10. Cross-Platform & Sync (Q76-Q87)
- **Q76:** Session device handoff
- **Q77:** Enterprise provider consolidation
- **Q78:** Mobile and desktop session continuity
- **Q79:** Touch input confidence
- **Q80:** Offline mode effectiveness
- **Q81:** Platform switching workflows
- **Q82:** Responsive design engagement
- **Q83:** Sync bottlenecks
- **Q84:** Mobile feature adoption vs desktop
- **Q85:** Touch vs keyboard tradeoffs
- **Q86:** File form factor optimization
- **Q87:** Cross-device conflict resolution

**Priority:** High - Multi-platform experience

### 11. Support & Education (Q88-Q97)
- **Q88:** Support trigger detection
- **Q89:** Help documentation effectiveness
- **Q90:** Tutorial completion funnel
- **Q91:** In-app guidance timing
- **Q92:** Feature announcement effectiveness
- **Q93:** Feedback after errors
- **Q94:** Bug report quality
- **Q95:** Community engagement
- **Q96:** Social sharing and referrals
- **Q97:** Onboarding support needs

**Priority:** Medium - Support optimization

## Implementation Priority Framework

### Phase 1: Foundation (Weeks 1-4)
**Critical business metrics that inform all other decisions**

1. **Growth Fundamentals**
   - Q1: Acquisition channels
   - Q2: Trial to paid conversion
   - Q3: Activation metrics
   - Q6: DAU/WAU/MAU trends

2. **Retention Core**
   - Q11: Retention curves
   - Q12: Churn signals
   - Q15: Engagement scoring

3. **Monetization Basics**
   - Q31: Free-to-paid triggers
   - Q35: Premium utilization
   - Q39: Tier usage patterns

### Phase 2: Product Intelligence (Weeks 5-8)
**Understanding how users interact with core features**

1. **AI Features (Core Differentiator)**
   - Q16: Provider/model usage
   - Q17: AI feature adoption
   - Q20: AI retention impact
   - Q23: AI cost analysis

2. **Performance & Reliability**
   - Q41: Launch time
   - Q44: Crash impact
   - Q53: Auto-save reliability
   - Q54: Error recovery

3. **Feature Discovery**
   - Q25: Discovery pathways
   - Q26: Collaboration adoption
   - Q27: Extension usage

### Phase 3: Optimization (Weeks 9-12)
**Deep dives into specific experiences**

1. **Mobile & Cross-Platform**
   - Q56: Mobile vs desktop patterns
   - Q78: Session continuity
   - Q80: Offline effectiveness
   - Q83: Sync bottlenecks

2. **Enterprise & Collaboration**
   - Q73: Feature stacking
   - Q74: CollabV3 sharing
   - Q75: Permission usage
   - Q77: Provider consolidation

3. **Support & Education**
   - Q88: Support trigger detection
   - Q90: Tutorial completion
   - Q97: Onboarding support needs

### Phase 4: Advanced Insights (Weeks 13+)
**Detailed behavioral analysis and optimization**

1. **Power User & Advanced Features**
   - Q9: Power user behavior
   - Q29: Keyboard shortcuts
   - Q64: Tag/metadata usage
   - Q68: Bulk operations

2. **Community & Growth**
   - Q95: Community engagement
   - Q96: Social sharing
   - Q4: Referral effectiveness
   - Q5: Viral coefficient

3. **Specialized Analysis**
   - All remaining questions based on specific needs

## Query Patterns & Best Practices

### Common Cohort Definitions
```
Active Users:
  - Exclude: all_filtered_cohorts
  - Filter: is_dev_user != true
  - Definition: Users with activity in last 30 days

New Users (Week 0):
  - Signup within last 7 days
  - Exclude dev users

Activated Users:
  - Completed first meaningful action
  - Exclude dev users

Premium Users:
  - Active subscription
  - Exclude dev users
```

### Standard Funnel Template
```
1. Entry point (signups, feature discovery)
2. Engagement step (first usage)
3. Value realization (completion/success)
4. Retention (repeated usage)
```

### Property Breakdown Standards
- **User segments:** Plan tier, signup source, platform
- **Temporal:** Day of week, time of day, days since signup
- **Behavioral:** Power user status, feature adoption level
- **Technical:** Platform, OS, app version

### Time-Based Analysis
- **Trends:** Daily/weekly/monthly for different metrics
- **Cohorts:** By signup week for retention analysis
- **Time to convert:** Minutes/hours/days based on action
- **Session duration:** Engagement depth indicator

## Success Metrics Framework

Each question template includes specific success metrics. General targets:

### Engagement Metrics
- DAU/MAU ratio: >30% (SaaS benchmark)
- Session duration: Increasing over user lifetime
- Feature adoption: >50% for core features within 30 days
- Retention (Day 1/7/30): 60%/40%/20% or better

### Conversion Metrics
- Trial to paid: >20%
- Activation rate: >60% within first week
- Free to premium: >5% within 90 days
- Upgrade funnel completion: >40%

### Performance Metrics
- App launch: <3 seconds (P95)
- Sync latency: <1 second (P95)
- Crash rate: <0.1% of sessions
- Error recovery: >95% success

### Support Metrics
- Self-service resolution: >70%
- Tutorial completion: >60%
- Support contact within 30 days: <20%
- Bug report actionability: >80%

## Related Documentation

- **POSTHOG_EVENTS.md**: Complete event catalog with properties
- **ANALYTICS_GUIDE.md**: Implementation guidelines for tracking
- **ANALYSIS_STATUS.md**: Current implementation status tracker

## Next Steps

1. **Prioritization Workshop**: Align stakeholders on Phase 1 questions
2. **Event Audit**: Verify all required events are properly instrumented
3. **Dashboard Creation**: Build initial dashboards for Phase 1 questions
4. **Analysis Schedule**: Establish weekly/monthly review cadence
5. **Iteration**: Refine questions based on initial findings

## Maintenance

This framework should be:
- **Reviewed quarterly** for relevance and priority adjustments
- **Updated** as new features ship or business priorities shift
- **Extended** with new questions as needed
- **Archived** questions that are no longer relevant

## Contact

For questions about this framework or specific analyses:
- Review question templates in `/analysis/questions/`
- Check implementation status in `ANALYSIS_STATUS.md`
- Reference event definitions in `POSTHOG_EVENTS.md`

---

**Framework Version:** 1.0
**Created:** 2026-01-03
**Questions:** 97 complete templates ready for implementation
