---
name: Source text preservation
description: Contract for keeping source content intact through document and transcription enrichment.
---

Treat the complete raw extraction or provider transcript as canonical. Never reconstruct or replace it from partial segments, an AI transformation, tokenization, or chunking output; return those artifacts separately with their provenance.

**Why:** Segment lists may be partial, and optional AI/NLP services may rewrite, truncate, or fail. Using any of them as the source silently removes valid phrases before note creation.

**How to apply:** For every document, image, link, audio, or video path, select raw text first, pass that exact text to tokenization/chunking, preserve offsets and source units, and report auxiliary failures without suppressing the raw content.