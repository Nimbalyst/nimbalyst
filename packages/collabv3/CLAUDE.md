# CollabV3 Package (Sync Server)

This package contains the Cloudflare Workers-based sync server for Nimbalyst that enables real-time multi-device synchronization of AI chat sessions.

## Overview

CollabV3 provides:

- **Real-time WebSocket sync** between desktop and mobile devices
- **Durable Object-backed storage** using SQLite for message persistence
- **End-to-end encryption** - server only sees encrypted content
- **JWT-based authentication** via Stytch
- **Session index** for fast mobile startup
- **Device presence awareness** across connected clients

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                            │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ index.ts     │───▶│ SessionRoom  │    │  IndexRoom   │      │
│  │ (Router)     │    │ (DO)         │    │  (DO)        │      │
│  └──────────────┘    │              │    │              │      │
│         │            │ - Messages   │    │ - Session    │      │
│         │            │ - Metadata   │    │   Index      │      │
│         │            │ - WebSocket  │    │ - Projects   │      │
│         │            │   Broadcast  │    │ - Devices    │      │
│         │            └──────────────┘    └──────────────┘      │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐                                              │
│  │ auth.ts      │ JWT validation via Stytch JWKS               │
│  └──────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Durable Objects

- **SessionRoom**: Manages a single AI session's messages and real-time sync. One instance per session.
- **IndexRoom**: Manages the session index for a user. One instance per user. Provides fast session list on mobile startup.

### Room ID Format

- Session rooms: `user:{userId}:session:{sessionId}` - Routes to SessionRoom DO
- Index rooms: `user:{userId}:index` - Routes to IndexRoom DO
- Projects rooms: `user:{userId}:projects` - Also routes to IndexRoom DO (alias)

Note: The "projects" room ID is an alias that routes to the same IndexRoom instance as the "index" room. The IndexRoom manages both the session index and project data.

## Development

### Prerequisites

- Node.js 18+
- npm
- Cloudflare account (for deployment)
- Stytch account (for authentication)

### Setup

```bash
# Install dependencies
npm install

# Run local development server
npm run dev
```

The dev server runs on `http://localhost:8790` by default.

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start local development server |
| `npm run deploy:production` | Bump version, deploy to production, print tag commands |
| `npm run deploy:staging` | Bump version, deploy to staging, print tag commands |
| `npm run deploy` | Raw deploy (no version bump, for manual use) |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type check without emitting |

## Configuration

### Environment Variables

Set these in `wrangler.toml` or via Cloudflare dashboard:

| Variable | Required | Description |
| --- | --- | --- |
| `ENVIRONMENT` | Yes | `development`, `staging`, or `production` |
| `STYTCH_PROJECT_ID` | Yes | Stytch project ID (e.g., `project-test-xxx`) |
| `STYTCH_SECRET_KEY` | Yes | Stytch secret key (set as secret, not in toml) |
| `STYTCH_PUBLIC_TOKEN` | No | Stytch public token for OAuth flows |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins |

### Setting Secrets

```bash
# Set Stytch secret key
wrangler secret put STYTCH_SECRET_KEY

# Set for staging
wrangler secret put STYTCH_SECRET_KEY --env staging
```

### D1 Database Setup

Before first deployment, create the D1 database:

```bash
# Create the database
wrangler d1 create nimbalyst-collabv3

# Update wrangler.toml with the returned database_id
```

## API Reference

### WebSocket Endpoints

#### `/sync/{roomId}`

WebSocket connection for real-time sync.

**Authentication**: JWT via `?token={jwt}` query parameter or `Authorization: Bearer {jwt}` header.

**Client Messages**:

| Type | Description |
| --- | --- |
| `sync_request` | Request messages since cursor |
| `append_message` | Add new encrypted message |
| `update_metadata` | Update session metadata |
| `delete_session` | Delete entire session |
| `index_sync_request` | Request full index sync |
| `index_update` | Update session in index |
| `index_batch_update` | Bulk update sessions in index |
| `index_delete` | Delete session from index |
| `device_announce` | Announce device presence |

**Server Messages**:

| Type | Description |
| --- | --- |
| `sync_response` | Response to sync_request with messages |
| `message_broadcast` | New message from another device |
| `metadata_broadcast` | Metadata change from another device |
| `index_sync_response` | Full index response |
| `index_broadcast` | Index update from another device |
| `index_delete_broadcast` | Session deleted from another device |
| `devices_list` | List of connected devices |
| `device_joined` | New device connected |
| `device_left` | Device disconnected |
| `error` | Error response |

### REST Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `POST` | `/api/auth/magic-link` | Send magic link email |
| `GET` | `/api/sessions` | List user's sessions |
| `GET` | `/api/session/{id}/status` | Get session status |
| `POST` | `/api/bulk-index` | Bulk update session index |
| `GET` | `/auth/callback` | OAuth/Magic link callback |
| `POST` | `/auth/refresh` | Refresh session JWT |
| `GET` | `/auth/login/google` | Initiate Google OAuth |

## Deployment

### First-Time Setup

1. Create D1 database:
```bash
wrangler d1 create nimbalyst-collabv3
```

2. Update `wrangler.toml` with the database ID

3. Set secrets:
```bash
wrangler secret put STYTCH_SECRET_KEY
```

4. Deploy:
```bash
npm run deploy
```

### Versioned Deployment

Deployments use `scripts/deploy.sh` which bumps the version in `package.json`, injects it at build time via wrangler `--define`, and deploys. The version is exposed on the `/health` endpoint.

```bash
# Patch bump + deploy (default)
npm run deploy:production
npm run deploy:staging

# Minor or major bump
./scripts/deploy.sh minor --env production
./scripts/deploy.sh major --env production
```

After deploying, verify the version:
```bash
curl https://sync.nimbalyst.com/health
# → {"status":"ok","version":"0.2.0","environment":"production"}
```

The script prints git commands to commit and tag the deploy. Tags use the format `collabv3-vX.Y.Z`.

After deployment, the worker is available at:
- **Default**: `nimbalyst-collabv3.workers.dev`
- **Custom domain**: `sync.nimbalyst.com` (configured in wrangler.toml)

### Custom Domain Setup

The production environment is configured to use `sync.nimbalyst.com`:

1. Add `nimbalyst.com` domain to Cloudflare (if not already)
2. Deploy with `npm run deploy` - Cloudflare will automatically:
  - Create a DNS record for `sync.nimbalyst.com`
  - Provision SSL certificate
  - Route traffic to the worker

Clients should connect to `wss://sync.nimbalyst.com/sync/{roomId}`.

## Security

### Authentication

All requests are authenticated using Stytch JWTs:

1. JWTs are validated against Stytch's JWKS endpoint
2. The `sub` claim contains the user ID
3. Room access is authorized by matching user ID in room ID

### Encryption

- All message content is end-to-end encrypted by clients
- Server only stores encrypted ciphertext and IVs
- Session titles are also encrypted in the index

### CORS

- Development: Allows localhost and local network IPs
- Production: Restricted to configured origins

## Hibernation Support

Durable Objects use WebSocket hibernation to reduce costs:

- WebSocket connections persist across hibernation
- Connection state is stored in WebSocket tags
- Device presence is restored on reconnection

## Testing

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch
```

## Monitoring

### Cloudflare Observability

The worker has observability enabled in `wrangler.toml`:

```toml
[observability]
enabled = true
head_sampling_rate = 1  # 100% sampling
```

This provides:
- **Logs**: Persistent logs viewable in Cloudflare dashboard
- **Traces**: Request traces with timing breakdowns
- **Metrics**: Request counts, error rates, latency percentiles

Access via: Cloudflare Dashboard > Workers & Pages > nimbalyst-collabv3 > Logs/Metrics

### Status Endpoints

Each Durable Object exposes a `/status` endpoint for debugging:

**SessionRoom Status**:
```json
{
  "room_id": "...",
  "connections": 2,
  "message_count": 150,
  "metadata": { "title": "...", "provider": "claude" }
}
```

**IndexRoom Status**:
```json
{
  "room_id": "...",
  "connections": 3,
  "session_count": 45,
  "project_count": 5,
  "devices": [{ "name": "MacBook Pro", "type": "desktop" }]
}
```

### Logs

View real-time logs:
```bash
wrangler tail
```

## License

Private - Nimbalyst internal use only.
