---
name: Next development assets
description: Prevent Next development previews from sharing generated assets with production builds.
---

Use a separate output directory for the Next development server, leaving the
production build output directory exclusively for build and start commands.

**Why:** Sharing an output directory lets a build replace development CSS and
chunks while the dev server still references them, which can render the UI
unstyled or produce missing-module errors.

**How to apply:** Keep the phase-specific output setting and ensure the dev
command clears only the development output directory before starting.