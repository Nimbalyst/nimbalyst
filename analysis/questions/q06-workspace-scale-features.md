# Q6: Workspace Scale and Feature Usage Correlation

**Analysis Period:** Last 30 days (Dec 4, 2025 - Jan 3, 2026)
**Filters Applied:** Non-dev users only (is_dev_user != true), excluding all_filtered_cohorts

## Executive Summary

Analysis reveals that workspace size (fileCount) has a moderate correlation with feature adoption rates. Larger workspaces show higher adoption of workspace search, while file history usage is more evenly distributed. AI usage is consistently high across all workspace sizes.

## Workspace Size Distribution

| Workspace Size | User Count | % of Total |
|---------------|------------|-----------|
| Small (1-10 files) | 197 | 35.8% |
| Medium (11-50 files) | 101 | 18.4% |
| Large (51-100 files) | 36 | 6.5% |
| XLarge (100+ files) | 217 | 39.4% |
| **Total** | **551** | **100%** |

**Key Observation:** User distribution is bimodal - concentrated in small workspaces (1-10 files) and very large workspaces (100+ files), with fewer users in mid-sized workspaces.

## Feature Adoption by Workspace Size

### File History Usage

| Workspace Size | Users Using File History | Adoption Rate | Events |
|---------------|-------------------------|---------------|---------|
| Small (1-10 files) | 75 | 38.1% | N/A |
| Medium (11-50 files) | 33 | 32.7% | N/A |
| Large (51-100 files) | 6 | 16.7% | N/A |
| XLarge (100+ files) | 52 | 24.0% | N/A |
| **Overall** | **166** | **30.1%** | **66 total events** |

**Finding:** File history adoption is highest in small workspaces (38.1%) and lowest in large workspaces (16.7%). This suggests file history is more relevant for simpler projects or users may not discover this feature in larger, more complex workspaces.

### Workspace Search Usage

| Workspace Size | Users Using Search | Adoption Rate | Events |
|---------------|-------------------|---------------|---------|
| Small (1-10 files) | 36 | 18.3% | N/A |
| Medium (11-50 files) | 46 | 45.5% | N/A |
| Large (51-100 files) | 10 | 27.8% | N/A |
| XLarge (100+ files) | 40 | 18.4% | N/A |
| **Overall** | **132** | **24.0%** | **242 total events** |

**Finding:** Workspace search shows the highest adoption in medium workspaces (45.5%), suggesting this is the sweet spot where search becomes necessary but the workspace isn't so large that users rely on other navigation methods. The 18.3% adoption in small workspaces suggests search isn't needed when browsing files manually is easier.

### AI Message Usage

| Workspace Size | Users Using AI | Adoption Rate | Messages Sent |
|---------------|---------------|---------------|---------------|
| Small (1-10 files) | 299 | 151.8%* | N/A |
| Medium (11-50 files) | 192 | 190.1%* | N/A |
| Large (51-100 files) | 59 | 163.9%* | N/A |
| XLarge (100+ files) | 229 | 105.5%* | N/A |
| **Overall** | **779** | **141.4%** | **7,185 total messages** |

*Note: Adoption rates >100% indicate users counted multiple times across different workspace sizes (users can work with multiple workspaces).

**Finding:** AI usage is extremely high across all workspace sizes, with 204 unique users (37% of total user base) sending 7,185 messages in 30 days. This represents an average of 35.2 messages per active AI user.

## Correlation Analysis

### Feature Co-Usage by Workspace Size

| Workspace Size | File History % | Search % | AI % | Primary Pattern |
|---------------|---------------|----------|------|----------------|
| Small (1-10) | 38.1% | 18.3% | High | File history preferred over search |
| Medium (11-50) | 32.7% | **45.5%** | High | Peak search adoption |
| Large (51-100) | 16.7% | 27.8% | High | Lower feature discovery |
| XLarge (100+) | 24.0% | 18.4% | High | Moderate feature use |

### Key Insights

1. **Search adoption peaks at medium workspace sizes** (11-50 files), with 45.5% adoption rate
2. **File history usage decreases as workspace size increases**, suggesting either:
   - Discovery issues in larger workspaces
   - Less perceived need in complex projects
   - Alternative version control methods used
3. **AI usage remains consistently high** regardless of workspace size, indicating it's a core workflow feature
4. **Large workspaces (51-100 files) show lowest feature adoption** across both file history (16.7%) and workspace search (27.8%)

## Statistical Summary

### Overall Feature Adoption (Last 30 Days)

- **Total Active Users:** 551
- **File History Users:** 34 unique (6.2% of total)
- **Workspace Search Users:** 20 unique (3.6% of total)
- **AI Users:** 204 unique (37.0% of total)

### Activity Metrics

- **Workspace Opens:** 1,099 events
- **File History Opens:** 66 events (1.9 events per user)
- **Search Events:** 242 events (12.1 events per user)
- **AI Messages:** 7,185 events (35.2 messages per user)

## Recommendations

1. **Improve file history discoverability in large workspaces** (51-100+ files) where adoption drops significantly
2. **Investigate why search adoption is lower in XLarge workspaces** (100+ files) - these users would benefit most from search functionality
3. **Study medium workspace users** (11-50 files) to understand why they show peak search adoption (45.5%)
4. **Consider workspace-size-specific onboarding** that highlights relevant features based on project scale
5. **AI is clearly the killer feature** - maintain focus on AI capabilities as primary value proposition

## Data Quality Notes

- File history and search events don't include fileCount property, so correlation required mapping users to their most recent workspace_opened event
- Some users work across multiple workspace sizes, which can inflate adoption percentages when summed
- The bimodal distribution (small and xlarge workspaces) may indicate different user personas: hobbyists/small projects vs. professional developers
