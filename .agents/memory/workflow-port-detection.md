---
name: Workflow port detection
description: Covers a recurring mismatch between managed workflow readiness and the actual Next.js server.
---

The managed `Start application` workflow can report that port 5000 never opened even though `npm run dev` reaches Next.js `Ready`.

**Why:** Workflow regeneration removed the explicit local-5000-to-external-80 mapping. Next.js logged `Ready` and handled internal requests, but Replit reported no open ports and stopped the workflow at its readiness timeout.

**How to apply:** After one managed retry, inspect logs and workflow `openPorts`. If Next is ready but `openPorts` is empty, verify that port 5000 is published externally as 80, then replace `.replit` through its validator and restart once.