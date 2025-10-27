---
planStatus:
  planId: plan-pglite-corruption-mitigation
  title: PGLite Database Corruption Investigation & Mitigation
  status: draft
  planType: bug-fix
  priority: critical
  owner: ghinkle
  stakeholders:
    - ghinkle
  tags:
    - database
    - reliability
    - data-integrity
  created: "2025-10-20"
  updated: "2025-10-20T19:25:00.000Z"
  progress: 0
---
# PGLite Database Corruption Investigation & Mitigation
<!-- plan-status -->


## Problem

The PGLite database became corrupted, preventing app startup with error:
```javascript
Error: Aborted(). Build with -sASSERTIONS for more info.
```

**Impact**: Critical - app completely unusable when database is corrupted. User loses access to:
- AI chat sessions
- App settings
- Project state
- Document history
- Session data

**Workaround**: Moving database files aside allows app to start, but loses all data.

## Investigation Areas

### 1. Root Cause Analysis

**Potential causes:**
- Unclean shutdown (app crash, force quit, system crash)
- Concurrent access from multiple app instances
- WASM file loading issues in Electron worker threads
- File system issues (permissions, disk full, network drives)
- PGLite version compatibility issues
- Migration failures leaving database in bad state

**Evidence to collect:**
- When did corruption occur (correlate with crash logs, system events)
- Was app force-quit or crashed
- Were multiple instances running
- Check disk space and file permissions
- Review PGLite version and recent updates

### 2. Database Integrity Checks

**Current state:**
- No integrity checks on startup
- No validation that database is accessible
- No graceful degradation if database fails

**Need:**
- Pre-startup database integrity check
- Validation query before full initialization
- Better error messages identifying corruption vs other issues

### 3. Corruption Detection Patterns

**Questions:**
- Does this happen on clean shutdown?
- Does it happen after crashes?
- Is it related to specific operations (migrations, bulk writes)?
- Does it happen more on certain platforms?

## Mitigation Strategy

### Short-term Fixes (High Priority)

#### 1. Startup Resilience
```typescript
// Add to database initialization
async function validateDatabase() {
  try {
    // Simple query to test database accessibility
    await db.query('SELECT 1');
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      canRecover: error.message.includes('Aborted')
    };
  }
}
```

#### 2. Automatic Backup Before Startup
- Backup database directory before initialization
- Keep last N known-good backups
- Rotate backups (daily, keep 7 days)

#### 3. Recovery Dialog
When corruption detected:
- Show user-friendly error dialog
- Explain what happened
- Offer options:
  1. Restore from backup (if available)
  2. Start fresh (moves corrupted DB to quarantine)
  3. Exit and let user investigate

#### 4. Graceful Degradation
- Don't block app startup on database failure
- Fall back to in-memory or file-based storage
- Allow user to access workspace even without database
- Show warning banner about limited functionality

### Medium-term Improvements

#### 5. Corruption Prevention

**Write-Ahead Logging (WAL) mode:**
```javascript
// Enable WAL mode for better crash resistance
await db.exec('PRAGMA journal_mode=WAL');
await db.exec('PRAGMA synchronous=NORMAL');
```

**Proper shutdown handling:**
```javascript
// On app quit
app.on('before-quit', async () => {
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await db.close();
});
```

#### 6. Health Monitoring
- Periodic integrity checks (PRAGMA integrity_check)
- Log database operations and errors
- Track database size and growth
- Monitor for performance degradation (sign of corruption)

#### 7. Automatic Backups
- Backup on successful startup
- Backup before migrations
- Backup on clean shutdown
- Export data to JSON periodically

### Long-term Solutions

#### 8. Alternative Storage Strategy

**Options:**
1. **SQLite with better-sqlite3** - More mature, tested in Electron
2. **Dual storage** - PGLite for features, file-based for critical data
3. **Cloud sync** - Sync to user's cloud storage as backup

#### 9. Database Migrations Safety
- Test migrations on copy of database first
- Rollback capability
- Schema versioning
- Migration validation

#### 10. Monitoring & Telemetry
- Track corruption frequency
- Identify patterns (platform, operations, timing)
- Alert on anomalies

## Implementation Plan

### Phase 1: Emergency Fixes (This Week)
- [ ] Add database validation on startup
- [ ] Implement recovery dialog
- [ ] Add automatic backup before initialization
- [ ] Test corruption recovery flow

### Phase 2: Prevention (Next Week)
- [ ] Enable WAL mode
- [ ] Add proper shutdown handling
- [ ] Implement periodic backups
- [ ] Add health monitoring

### Phase 3: Robustness (Next Sprint)
- [ ] Evaluate alternative storage options
- [ ] Implement graceful degradation
- [ ] Add telemetry for corruption tracking
- [ ] Document recovery procedures

## Testing Plan

### Corruption Scenarios to Test
1. Force quit during write operation
2. Kill process during migration
3. Simulate disk full condition
4. Corrupt database files manually
5. Multiple app instances accessing DB
6. System crash simulation

### Recovery Testing
1. Verify backup restoration works
2. Test fresh start flow
3. Validate data migration
4. Check graceful degradation

## Success Criteria

1. App never fails to start due to database corruption
2. User data is automatically backed up
3. Recovery is automatic or 1-click
4. Data loss limited to recent changes only
5. Clear user communication about issues
6. Corruption incidents logged for analysis

## Notes

- PGLite is relatively new and may have stability issues
- Electron worker thread environment adds complexity
- WASM loading in workers is fragile
- Consider if benefits of PostgreSQL features outweigh complexity
- May need to reconsider storage architecture long-term
