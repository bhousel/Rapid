---
description: Reflect on recent work and bring all project documentation up to date
argument-hint: additional optional context
---

You are doing a documentation update pass. Recent decisions and work may have left docs, guides, and inline source comments out of date. Your job is to find and fix those gaps. The documentation should reflect the current state of the project and should be helpful for both humans and agents.

Feel free to suggest any improvements that you find, including:
- Fix inconsistencies or spelling mistakes
- Reword text for clarity or simplicity
- Offer suggestions where documentation is missing
- Remove guidance that has become stale and is no longer needed

## How to approach this

1. Check with the `AGENTS` file to understand the project structure.
2. Review the current chat session history — this is your primary source of context for what was discussed, decided, and changed.
3. Run `git log --oneline -20` to see recent commits and confirm what was actually landed.
4. Use `#codebase` to survey the current state of the project.

Then, make any updates needed in:
- Inline source documentation (JSDoc, comments, etc.) - add JSDoc blocks where missing
- Markdown files (`README`, design docs, contributing guides, etc.)
- Agent instructions (`AGENTS`, `copilot-instructions`, etc.)
- Your working memory files (`SCRATCHPAD`, `.scratchpad/*`, etc.)
- Any other files that have become outdated due to recent work.

Make all edits and do not commit changes. The user will review your findings before committing.
