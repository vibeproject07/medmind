---
name: Workflow port detection
description: Covers a recurring mismatch between managed workflow readiness and the actual Next.js server.
---

The managed `Start application` workflow can report that port 5000 never opened even though `npm run dev` reaches Next.js `Ready` and serves HTTP 200 when run directly.

**Why:** Multiple managed restarts timed out after logs showed a valid `0.0.0.0:5000` startup; the identical command launched temporarily from the shell became ready quickly and answered requests.

**How to apply:** After one managed retry, inspect logs instead of repeatedly restarting. If the app logged `Ready`, verify the identical command temporarily with an HTTP request and stop that temporary process after validation.