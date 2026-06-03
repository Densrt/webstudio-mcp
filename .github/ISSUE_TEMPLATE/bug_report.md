---
name: Bug report
about: Something the MCP did wrong (wrong patch, failed push, unexpected output)
title: "[bug] "
labels: bug
---

**What happened**
A clear description of the bug.

**Tool call**
The exact `mcp__webstudio__<tool>({ action: "...", ... })` you issued (redact cookies/CSRF/ids).

**Expected vs actual**
What you expected Webstudio to do vs what happened (UI symptom, publish failure, silent no-op…).

**Environment**
- Package version (`npm ls @densrt/webstudio-mcp` or the version in `meta.index`):
- Node version (`node -v`):
- MCP client (Claude Code / Cursor / Desktop / other):

**Notes**
Dry-run patch output is very helpful if you have it. Do **not** paste your session cookie or CSRF token.
