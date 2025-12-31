---
name: run
description: Build (if needed) and run Nimbalyst with isolated datastore
---
Build Nimbalyst if it isn't already built, then run it in an isolated development instance.

The command accepts an optional parameter to specify which datastore to use (default: 1).

This uses a completely separate database and data store from your production Nimbalyst, so you can develop and test without affecting your work.

Usage:
- `/run` - Uses datastore 1 (default)
- `/run 2` - Uses datastore 2
- `/run 3` - Uses datastore 3
- `/run test` - Uses datastore named "test"
- `/run stable` - Uses datastore named "stable"

Execute the nimbalyst-run.sh script from the repository root with the datastore parameter:

```bash
chmod +x nimbalyst-run.sh 2>/dev/null || true
./nimbalyst-run.sh {{arg1}}
```

Note: If no argument is provided to the command, the script will default to datastore "1".
