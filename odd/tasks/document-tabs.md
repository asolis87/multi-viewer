# Document tabs

## Requirements

- A second file command joins the active viewer and selects the file without opening another browser tab.
- Reopening a file selects its existing tab. File changes still live-reload, and unsaved edits belong to the document tab.
- `mview review` remains independent.

## Work units

1. Design: integrate file tabs into the Workbench toolbar; wrap the tab strip on narrow screens.
2. CLI: use a private local Unix socket for file registration, serve tabs by opaque ID, and watch the real target when a file is opened through a symbolic link.
3. Browser state: follow CLI selection without discarding the user's local selection on disk changes; preserve per-document edits and type.
4. Browser UI: render the accessible tab strip and integrate existing reload, reconnect, and review behavior.

## Verification

The integrated implementation was verified with 454 Vitest tests, type checking, a production build, independent CLI and frontend checks, and a real Chrome session. The Chrome check exercised sequential file opens, reselection, reload, unsaved edits, keyboard focus, narrow layout, and already-loaded tabs after the server stops. The Unix session is not enabled on Windows.
