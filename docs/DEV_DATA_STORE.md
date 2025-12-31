# Development Data Store Isolation

When developing Nimbalyst within itself, you can isolate all persistent data using the `DEV_DATA_STORE` environment variable:

```bash
# Run with isolated datastore (e.g., "3")
DEV_DATA_STORE=3 npm run dev

# Each number gets its own isolated storage
DEV_DATA_STORE=test npm run dev
DEV_DATA_STORE=stable npm run dev
```

## What Gets Isolated

- PGLite database → `~/.config/nimbalyst_3/pglite-db/`
- Database backups → `~/.config/nimbalyst_3/db-backups/`
- Electron Store configs → `~/.config/@nimbalyst_3/electron/`
- Log files → `~/.config/nimbalyst_3/logs/`
- Credentials → `~/.config/nimbalyst_3/*.enc`
- Chat attachments → `~/.config/nimbalyst_3/chat-attachments/`
- Extensions → `~/.config/nimbalyst_3/extensions/`

## Visual Indicators

- Window titles show `[DS3]` prefix when using isolated datastore
- Logs show isolation status on startup

## Use Cases

- Testing migrations without corrupting production data
- Running multiple Nimbalyst instances simultaneously
- Keeping stable vs experimental development environments separate

## Using the /run Command

The easiest way to use isolated datastores is via the `/run` Claude Code command:

- `/run` - Uses datastore 1 (default)
- `/run 2` - Uses datastore 2
- `/run 3` - Uses datastore 3
- `/run test` - Uses datastore named "test"
- `/run stable` - Uses datastore named "stable"

This command automatically builds the app if needed and launches it with the specified isolated datastore.
