---
name: sharpen
description: Go deep on one part of the codebase after a burst of work, and find how to make it simpler — one job per class, one meaning per word, names that follow the project's conventions, and less code. Reports a class map, a proposed glossary and a numbered list; makes no edits until the user picks.
disable-model-invocation: true
argument-hint: "the part to sharpen, for example: `the graphics system`, `modules/pixi/`, `the save path`"
---

> "I have made this longer than usual because I have not had time to make it shorter." — Blaise Pascal

Fast work leaves things longer than they need to be: classes that picked up a second job, words that mean two things, names that drifted from the project's conventions, code that was an experiment. This skill is the time to make it shorter. It goes deep on **one part** of the codebase. (`/suggest` goes wide over the whole repo, `/bughunt` looks for logic bugs, `/reflect` brings docs up to date.)

**Report first. Don't edit any file until the user has picked what to do.** Then see "After the user picks", below.

**Don't change things for their own sake.** Every finding says what gets simpler: fewer concepts to hold, fewer places to change, a rule or a caveat that disappears. Prefer deleting and merging to adding layers. Don't propose an abstraction for two cases. A refactor that only moves code around isn't a finding, unless the next planned work needs it moved; then tie it to that work.

## 1. Pick the part, and understand it as it is now

1. The part is the argument (a system, a folder, a set of classes). If there isn't one, suggest the part that changed most in recent commits, and ask.
2. Read `AGENTS.md` (and the folder's own `AGENTS.md` and `README.md`), the part's design docs, and the recent commits and PRs that touched it, for what it's meant to do and what changed.
3. Write a short **"what it is now"**: its pieces, how work flows through them, and where it ends and its libraries or platform begin (what's ours and what's theirs, by job, not by lines).

## 2. Give each class one sentence

List every class or module in the part with **one sentence saying its job**. A job that needs "and", or a list, is a finding: name the jobs, and say which one could move and where. Note the size outliers. Check the folder's README describes each one; a vague entry ("base class for all layers") is a finding too.

## 3. Settle the words

Collect the domain words the part uses, in identifiers, comments and docs (with `grep`, and counts, so the scale is visible). Look for:
- **One word with several meanings.** Especially where a library or the platform already uses the word for something else (a library's "batch", the browser's "frame").
- **Several words for one thing.**
- **A word used for a shape of work it no longer has** (a "pass" that no longer walks anything).

Propose a **glossary**: one meaning per word, a sentence or two each, and which uses change. Where the meanings are about how work flows over time (a loop, a pipeline, a request's path), a small diagram of one cycle helps more than the definitions alone.

## 4. Check the names

Find the project's naming conventions: the written ones in `AGENTS.md`, and the patterns the code follows (how a subclass is named after its parent, prefixes, ID types). List every departure, with how many references a rename would touch, and **check that the new name doesn't collide** with something that exists. A misspelled name is a finding.

## 5. Look for what can go

- **The project's own rules broken** (`AGENTS.md`): state the rules say a system must own, patterns they forbid.
- **APIs that need two calls in a row** ("call X, then always call Y"), and callers that forgot, or worked around it with something heavier.
- **Near-duplicate siblings**: classes that differ in a few lines.
- **Dead code and finished experiments**: commented-out blocks, debug paths nothing calls, flags that are always one value (unless a test uses them as an oracle).
- **Objects that are growing several jobs** (from step 2), and pieces that the next planned work will need pulled out.
- **Docs that became a log**: a design doc that's mostly dated steps and measurements, where the current design is hard to find.

Check every claim before it goes on the list: find the callers, count the references, read the code. Don't report a pattern from one example.

## 6. Report

In this order:
1. **What it is now**, in a paragraph or two.
2. **The class map**: a table of class → one-sentence job, with the ones that don't fit in a sentence marked.
3. **The proposed glossary**, if words need settling.
4. **Numbered findings** (numbers run across sections, so the user can say "let's do 4"), grouped as Architecture, Code, Naming and Docs. Mark each:
   - 🔥 broken, or a rule the project already has, broken
   - 👉 worth doing
   - 💡 bigger, or tied to later work: track it
   For each: what gets simpler, where (`file:line`), and roughly what it touches.
5. **A suggested order**: the small, safe ones first, and the bigger ones tied to the work that will need them.

## After the user picks

- Make the changes they picked, one theme per commit when there are several (renames, words, removals), and run the project's checks and tests.
- Rename with the project's file-editing tools or careful, word-bounded replacements, and `git mv` renamed files. Re-check with `grep` that nothing of the old name is left, in docs and tests too.
- Write the agreed glossary where the people and agents working on the part will find it: near the top of its design doc, with a pointer from the folder's `AGENTS.md` asking that the words be used that way.
- Record anything left for later in the project's backlog, if it has one.
