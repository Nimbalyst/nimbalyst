# Security Review: Sync & Authentication Systems

This document provides a comprehensive security review of Nimbalyst's sync and authentication infrastructure in preparation for a formal security audit.

## Executive Summary

Nimbalyst uses a multi-layered security architecture:
1. **User Authentication**: Stytch Consumer (B2C) platform for identity management
2. **Sync Authentication**: Device-specific tokens for WebSocket connections
3. **Data Protection**: End-to-end AES-256-GCM encryption for all synced content

The desktop app (Electron) and mobile app (Capacitor) share the same security model with platform-specific credential storage.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT APPS                                     │
├─────────────────────────────────┬───────────────────────────────────────────┤
│         Electron (Desktop)      │           Capacitor (Mobile)              │
│  ┌───────────────────────────┐  │  ┌───────────────────────────────────┐    │
│  │ StytchAuthService         │  │  │ (Future: StytchAuthService)       │    │
│  │ - OAuth/Magic Link        │  │  │ - Same auth flow                  │    │
│  │ - Session token storage   │  │  │ - Keychain storage                │    │
│  └───────────────────────────┘  │  └───────────────────────────────────┘    │
│  ┌───────────────────────────┐  │  ┌───────────────────────────────────┐    │
│  │ CredentialService         │  │  │ CollabV3SyncContext               │    │
│  │ - Sync credentials        │  │  │ - Sync credentials (from QR)      │    │
│  │ - Encryption key seed     │  │  │ - Encryption key seed             │    │
│  └───────────────────────────┘  │  └───────────────────────────────────┘    │
│  ┌───────────────────────────┐  │  ┌───────────────────────────────────┐    │
│  │ SyncManager               │  │  │ CollabV3Sync                      │    │
│  │ - Key derivation          │  │  │ - Key derivation                  │    │
│  │ - E2E encryption          │  │  │ - E2E encryption                  │    │
│  └───────────────────────────┘  │  └───────────────────────────────────┘    │
└─────────────────────────────────┴───────────────────────────────────────────┘
                                    │
                                    │ HTTPS / WSS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CollabV3 (Cloudflare Worker)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────┐  ┌───────────────────────────────────────┐   │
│  │ Auth Routes (/auth/*)     │  │ Sync Routes (/sync/*)                 │   │
│  │ - OAuth initiation        │  │ - WebSocket upgrade                   │   │
│  │ - Token validation        │  │ - Token auth (query params)           │   │
│  │ - Deep link redirect      │  │ - Room routing                        │   │
│  └───────────────────────────┘  └───────────────────────────────────────┘   │
│  ┌───────────────────────────┐  ┌───────────────────────────────────────┐   │
│  │ Stytch Integration        │  │ Durable Objects                       │   │
│  │ - Secret key (server-only)│  │ - SessionRoom (per-session)           │   │
│  │ - Token authentication    │  │ - IndexRoom (per-user)                │   │
│  └───────────────────────────┘  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS (server-to-server)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Stytch API                                      │
│  - User management                                                           │
│  - OAuth providers (Google)                                                  │
│  - Magic link email delivery                                                 │
│  - Session token issuance                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. User Authentication (Stytch)

### 1.1 Architecture

| Component | Location | Responsibility |
| --- | --- | --- |
| Public tokens | `packages/runtime/src/config/stytch.ts` | Committed to git, used for OAuth URL construction |
| Secret key | Cloudflare secrets | Server-only, never in client code |
| Auth service | `packages/electron/src/main/services/StytchAuthService.ts` | Deep link handling, session storage |
| Server routes | `packages/collabv3/src/index.ts` | Token validation, OAuth flow |

### 1.2 Authentication Flows

#### Google OAuth Flow
```
1. User clicks "Sign in with Google"
2. Desktop opens: https://collabv3.../auth/login/google
3. Server redirects to Stytch OAuth URL with public_token
4. User authenticates with Google
5. Stytch redirects to: https://collabv3.../auth/callback?token=...
6. Server validates token using SECRET KEY
7. Server redirects to: nimbalyst://auth/callback?session_token=...
8. Desktop app receives deep link, stores session token
```

#### Magic Link Flow
```
1. User enters email, clicks "Send Magic Link"
2. Desktop calls: POST https://collabv3.../api/auth/magic-link
3. Server calls Stytch API with SECRET KEY to send email
4. User clicks link in email
5. Browser opens: https://collabv3.../auth/callback?token=...
6. Server validates token using SECRET KEY
7. Server redirects to: nimbalyst://auth/callback?session_token=...
8. Desktop app receives deep link, stores session token
```

### 1.3 Security Assessment

#### Strengths
- [x] Secret key never leaves server
- [x] Session tokens stored with OS keychain encryption (safeStorage)
- [x] Deep links prevent token interception in browser
- [x] Session expiration enforced (7 days default)

#### Concerns / Questions
- [ ] **Deep link hijacking**: Can a malicious app register `nimbalyst://` scheme?
  - Mitigation: macOS app signature verification, iOS entitlements
  - TODO: Verify Windows/Linux behavior
- [ ] **Token in URL**: Session token visible in deep link URL
  - Mitigation: Deep links are local-only, not logged
  - TODO: Consider encrypting deep link params
- [ ] **Session refresh**: Currently no automatic session refresh
  - TODO: Implement Stytch session refresh before expiry
- [ ] **Rate limiting**: Magic link endpoint has no rate limiting
  - TODO: Add rate limiting on `/api/auth/magic-link`

### 1.4 Credential Storage

| Platform | Storage Mechanism | Encryption |
| --- | --- | --- |
| macOS | Electron safeStorage (Keychain) | AES-256 via Keychain |
| Windows | Electron safeStorage (DPAPI) | DPAPI encryption |
| Linux | Electron safeStorage (libsecret) | Keyring encryption |
| iOS | (Future) Keychain Services | Hardware-backed |
| Android | (Future) Keystore | Hardware-backed |

**File locations:**
- Encrypted credentials: `~/Library/Application Support/@nimbalyst/electron/stytch-credentials`
- Device tokens: `~/Library/Application Support/@nimbalyst/electron/stytch-device-tokens`

---

## 2. Sync Authentication

### 2.1 Architecture

Sync uses a separate credential system from user authentication:

| Component | Purpose |
| --- | --- |
| `userId` | UUIDv4, identifies user for sync rooms |
| `authToken` | 256-bit random token, authenticates WebSocket connections |
| `encryptionKeySeed` | 256-bit random, derives E2E encryption key |

### 2.2 Credential Generation

```typescript
// CredentialService.ts
{
  userId: crypto.randomUUID(),              // UUIDv4
  authToken: crypto.randomBytes(32),        // 256-bit
  encryptionKeySeed: crypto.randomBytes(32) // 256-bit, NEVER sent to server
}
```

### 2.3 WebSocket Authentication

```
wss://collabv3.../sync/user:{userId}:session:{sessionId}?user_id={userId}&token={authToken}
```

**Server validation:**
```typescript
// collabv3/src/index.ts
const auth = parseAuth(request);
if (!auth || auth.user_id !== parsed.userId) {
  return new Response('Unauthorized', { status: 401 });
}
```

### 2.4 Security Assessment

#### Strengths
- [x] Credentials stored with OS keychain encryption
- [x] Auth token is 256-bit random (high entropy)
- [x] Encryption key seed never transmitted over network
- [x] User can only access their own rooms (userId in path must match auth)

#### Concerns / Questions
- [ ] **Token in URL**: Auth token visible in WebSocket URL
  - Concern: May be logged by proxies/CDN
  - Mitigation: HTTPS/WSS encryption prevents interception
  - TODO: Consider moving to header-based auth
- [ ] **Token revocation**: No mechanism to revoke sync tokens
  - TODO: Implement token revocation API
- [ ] **No token rotation**: Auth token never changes
  - TODO: Implement periodic token rotation
- [ ] **Simple auth bypass**: If attacker gets userId + authToken, full access
  - Mitigation: Credentials are encrypted at rest
  - TODO: Consider adding device attestation

---

## 3. End-to-End Encryption

### 3.1 Key Derivation

```typescript
// PBKDF2 key derivation
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'PBKDF2',
    salt: encoder.encode(`nimbalyst:${userId}`),
    iterations: 100000,
    hash: 'SHA-256'
  },
  keyMaterial,  // encryptionKeySeed
  { name: 'AES-GCM', length: 256 },
  false,        // not extractable
  ['encrypt', 'decrypt']
);
```

### 3.2 Message Encryption

```typescript
// AES-256-GCM encryption
const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV
const encrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  aesKey,
  plaintext
);
```

### 3.3 Security Assessment

#### Strengths
- [x] AES-256-GCM: Authenticated encryption (confidentiality + integrity)
- [x] PBKDF2 with 100k iterations: Resistant to brute-force
- [x] User-specific salt: Prevents rainbow table attacks
- [x] Random IV per message: Prevents pattern analysis
- [x] Key non-extractable: Cannot be exported from WebCrypto

#### Concerns / Questions
- [ ] **Key derivation salt**: Uses `nimbalyst:${userId}` which is predictable
  - Low risk: Still need encryptionKeySeed to derive key
  - TODO: Consider adding random salt component
- [ ] **No forward secrecy**: Compromise of encryptionKeySeed decrypts all messages
  - TODO: Consider implementing message-level key rotation
- [ ] **Metadata leakage**: Timestamps, message direction, tool names are unencrypted
  - Design decision: Needed for server-side indexing
  - TODO: Document what metadata is visible to server

---

## 4. Mobile Device Pairing

### 4.1 QR Code Contents

```json
{
  "userId": "uuid",
  "authToken": "base64-token",
  "encryptionKeySeed": "base64-seed",
  "serverUrl": "wss://..."
}
```

### 4.2 Security Assessment

#### Strengths
- [x] QR code is local-only (camera scan, not network)
- [x] Contains encryption key seed: true E2E encryption
- [x] One-time pairing: credentials stored after scan

#### Concerns / Questions
- [ ] **QR code exposure**: Anyone who sees QR code has full access
  - Mitigation: QR modal warns user, auto-closes
  - TODO: Add QR code expiration (time-limited)
- [ ] **No device verification**: Cannot verify which device scanned QR
  - TODO: Consider adding device attestation
- [ ] **No pairing approval**: Desktop doesn't confirm pairing
  - TODO: Add confirmation dialog after mobile connects
- [ ] **QR screenshot attack**: Malware could screenshot QR code
  - Low risk: Requires compromised desktop
  - TODO: Consider QR code obfuscation

---

## 5. Data at Rest

### 5.1 Desktop (Electron)

| Data | Location | Encryption |
| --- | --- | --- |
| Stytch credentials | `stytch-credentials` | safeStorage (OS keychain) |
| Sync credentials | `sync-credentials` | safeStorage (OS keychain) |
| Device tokens | `stytch-device-tokens` | safeStorage (OS keychain) |
| AI sessions (local) | PGLite database | Unencrypted (local-only) |
| App settings | electron-store | Unencrypted |

### 5.2 Mobile (Capacitor)

| Data | Location | Encryption |
| --- | --- | --- |
| Sync credentials | Keychain/Keystore | Platform encryption |
| Session cache | In-memory | N/A (not persisted) |

### 5.3 Server (Cloudflare)

| Data | Location | Encryption |
| --- | --- | --- |
| Message content | Durable Object SQLite | E2E encrypted (AES-256-GCM) |
| Session metadata | Durable Object SQLite | Unencrypted |
| Stytch secret | Cloudflare secrets | Cloudflare encryption |

---

## 6. Network Security

### 6.1 Transport Security

| Connection | Protocol | Certificate |
| --- | --- | --- |
| Desktop -> CollabV3 | HTTPS/WSS | Cloudflare managed |
| Mobile -> CollabV3 | HTTPS/WSS | Cloudflare managed |
| CollabV3 -> Stytch | HTTPS | Stytch managed |

### 6.2 Security Assessment

#### Strengths
- [x] All connections use TLS 1.2+
- [x] Cloudflare edge provides DDoS protection
- [x] No direct database exposure

#### Concerns / Questions
- [ ] **Certificate pinning**: Not implemented
  - TODO: Consider implementing for high-security mode
- [ ] **Local development**: Uses HTTP (not HTTPS)
  - Mitigation: Only for local testing
  - TODO: Document security implications

---

## 7. Attack Vectors

### 7.1 Client-Side Attacks

| Attack | Risk | Mitigation | Status |
| --- | --- | --- | --- |
| Malicious Electron update | High | Code signing, notarization | Implemented |
| Deep link hijacking | Medium | Platform-specific protections | Partial |
| QR code screenshot | Low | User awareness | TODO: Add warning |
| Memory dump | Low | Credentials in keychain | Implemented |
| Malicious extension | Medium | No extension API | N/A |

### 7.2 Server-Side Attacks

| Attack | Risk | Mitigation | Status |
| --- | --- | --- | --- |
| Stytch secret leak | Critical | Cloudflare secrets | Implemented |
| Database compromise | Low | E2E encryption | Implemented |
| DDoS | Medium | Cloudflare protection | Implemented |
| Durable Object abuse | Medium | User isolation | Implemented |

### 7.3 Network Attacks

| Attack | Risk | Mitigation | Status |
| --- | --- | --- | --- |
| MITM | Low | TLS 1.2+ | Implemented |
| Token interception | Low | TLS + E2E encryption | Implemented |
| Replay attack | Low | Unique message IDs | Implemented |

---

## 8. Compliance Considerations

### 8.1 Data Residency

- Cloudflare Workers run at edge locations globally
- Durable Objects have location hints but no guarantees
- TODO: Document data residency for enterprise customers

### 8.2 Data Retention

- Synced messages: Retained until user deletes session
- Local data: Retained until app uninstalled
- Server logs: Cloudflare default retention
- TODO: Implement data retention policies

### 8.3 User Data Rights

- Export: Can export AI sessions locally
- Deletion: Can delete sessions (local + server)
- TODO: Implement full account deletion

---

## 9. Recommendations

### 9.1 Critical (Before Launch)

1. **Rate limit magic link endpoint** - Prevent email bombing
2. **Add session refresh** - Prevent session expiry issues
3. **Document metadata visibility** - Clear privacy policy on what server sees

### 9.2 High Priority (Next Release)

1. **Token rotation** - Rotate sync auth tokens periodically
2. **Device pairing confirmation** - Desktop confirms mobile pairing
3. **QR code expiration** - Time-limited pairing codes
4. **Token revocation API** - Allow users to revoke device access

### 9.3 Medium Priority (Future)

1. **Certificate pinning** - Optional high-security mode
2. **Forward secrecy** - Message-level key rotation
3. **Device attestation** - Verify device integrity
4. **Audit logging** - Track authentication events

---

## 10. Testing Checklist

### 10.1 Authentication Tests

- [ ] OAuth flow completes successfully
- [ ] Magic link flow completes successfully
- [ ] Session persists across app restart
- [ ] Session expires after 7 days
- [ ] Sign out clears all credentials
- [ ] Invalid token is rejected

### 10.2 Sync Tests

- [ ] WebSocket connects with valid credentials
- [ ] WebSocket rejects invalid credentials
- [ ] Messages encrypt/decrypt correctly
- [ ] Cross-device sync works
- [ ] Offline changes sync on reconnect

### 10.3 Security Tests

- [ ] Credentials are encrypted at rest
- [ ] safeStorage is used when available
- [ ] Deep link is handled securely
- [ ] QR code contains correct data
- [ ] Server rejects cross-user access

---

## Appendix A: Key Files

| File | Purpose |
| --- | --- |
| `packages/runtime/src/config/stytch.ts` | Stytch public tokens |
| `packages/runtime/src/sync/CollabV3Sync.ts` | E2E encryption implementation |
| `packages/electron/src/main/services/StytchAuthService.ts` | User authentication |
| `packages/electron/src/main/services/CredentialService.ts` | Sync credential management |
| `packages/electron/src/main/services/SyncManager.ts` | Key derivation, sync setup |
| `packages/collabv3/src/index.ts` | Server auth routes |
| `packages/collabv3/src/auth.ts` | JWT/token parsing |

## Appendix B: Environment Variables

### Client (Electron)

None required - uses committed public tokens.

### Server (Cloudflare Worker)

| Variable | Purpose | Source |
| --- | --- | --- |
| `STYTCH_PROJECT_ID` | Stytch project identifier | Cloudflare secrets |
| `STYTCH_PUBLIC_TOKEN` | OAuth URL construction | Cloudflare secrets |
| `STYTCH_SECRET_KEY` | Token validation | Cloudflare secrets |

## Appendix C: Revision History

| Date | Author | Changes |
| --- | --- | --- |
| 2025-12-05 | Claude | Initial security review document |
