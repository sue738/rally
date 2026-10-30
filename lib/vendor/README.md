# vendor/ — the transcript readers, copied in

rally has **no dependencies**. These files are a copy of a transcript-reader
layer maintained in a separate (private) tool of the same author, taken 2026-09-21.

## Why a copy instead of a dependency

The two tools answer different questions — one measures what the agents did,
one shows what they are doing right now — and neither should have to wait on
the other's release to ship. A shared package would couple their versions for
the sake of ~1,000 lines that change only when an agent changes its on-disk
format.

## What is here

| file | what it does |
|---|---|
| `model.js` | `Session` / `Event`: the one shape every reader produces |
| `dialogue.js` | tells a person's turn from runtime-injected text |
| `readers/index.js` | the registry: `readAll`, `rawAll`, `byName` |
| `readers/claude.js` | `~/.claude/projects/**/*.jsonl` |
| `readers/codex.js` | `~/.codex/sessions/**/rollout-*.jsonl` |
| `readers/gemini.js` | `~/.gemini/tmp/*/chats/*.jsonl` |
| `readers/cursor.js` | Cursor's `state.vscdb` via `node:sqlite` |
| `readers/antigravity.js` | Antigravity runs started by the board (not part of the copy) |
| `overlap.js` | the same file written by two sessions close together (the Conflicts panel) — a pure function over events, no other imports |

## Keeping it current

These change when an agent changes its transcript format, which is rare. Fix
it here by hand — there is no build step and no automatic sync, on purpose.
