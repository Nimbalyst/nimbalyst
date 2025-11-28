# @nimbalyst/collabv2

Cloudflare Workers-based Y.js sync server for single-user device sync with E2E encryption.

## Architecture

- **Cloudflare Workers**: Routing and auth
- **Durable Objects**: In-memory Y.Doc state and real-time sync
- **D1 Database**: Persistent snapshots and session metadata
- **WebSocket Hibernation**: Cost optimization for idle connections

## Local Development

```bash
# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Start local dev server (uses Miniflare)
npm run dev

# Server runs at ws://localhost:8787/sync/{sessionId}
```

## Testing

```bash
# Unit tests
npm test

# Integration tests (with Miniflare)
npm run test:integration

# Watch mode
npm run test:watch
```

## Deployment

```bash
# Build
npm run build

# Deploy to Cloudflare
npm run deploy
```

## Project Structure

```
src/
├── worker.ts           # Worker entry point and routing
├── durable-object.ts   # YjsSyncObject Durable Object
├── persistence.ts      # D1 snapshot logic
├── protocol.ts         # Y.js sync protocol handling
└── types.ts            # TypeScript types

test/
├── unit/              # Unit tests
├── integration/       # Integration tests with Miniflare
└── fixtures/          # Test data

migrations/
└── 0001_initial.sql   # D1 database schema
```

## Documentation

See `/design/MobileSync/` for:
- `architecture-decisions.md` - Key architectural decisions
- `local-development.md` - Development and testing guide
- `durable-objects-yjs-sync.md` - Detailed implementation reference

## License

MIT
