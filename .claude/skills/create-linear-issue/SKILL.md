---
name: create-linear-issue
description: Use when creating or updating Linear issues — provides issue template, field requirements, and quality checklist
---

# Creating Linear Issues

## When to Create Issues

- Infrastructure, convention, or architectural changes
- Bugs discovered during implementation
- Follow-up work identified while working on another issue
- Always ask the user before creating — never auto-create

## Required Fields

Every issue MUST have:
- **title** — concise, imperative mood, lowercase after first word (e.g., "Add audit logging for admin database client usage")
- **team** — always `Roviq`
- **description** — structured markdown (see template below)
- **labels** — use ONLY existing labels from Linear (fetch with `list_issue_labels` if unsure). Never create new labels without asking the user first.
- **priority** — 1=Urgent, 2=High, 3=Normal, 4=Low (default to 3 unless context demands otherwise)

## Optional but Encouraged

- **project** — assign to a project if the work belongs to one
- **milestone** — assign if the project has relevant milestones
- **blockedBy** / **blocks** — always set dependency relations when they exist
- **estimate** — set if scope is clear enough to estimate

## Description Template

Use this structure. Omit sections that don't apply, but always include Summary and at minimum one of Changes/What to Do/Acceptance Criteria.

```markdown
## Summary

One-liner explaining the why — not just the what.

## Context

(Optional) Background needed to understand the issue. Reference design docs, prior issues, or architectural decisions.

## Changes / What to Do

Bulleted list of concrete implementation steps:
* Step one — specific files, functions, or modules to touch
* Step two — include code snippets when they clarify intent
* Step three

## Acceptance Criteria

* Observable outcomes that prove the issue is done
* Testable conditions, not vague goals
* Include expected CLI output, UI behavior, or test results when possible

## Blocked by

* ROV-XX (description) — only if there are actual dependencies

## Does NOT Change

* List things explicitly out of scope to prevent scope creep
* Especially important for issues that touch shared infrastructure

## Ref

Links to design docs, related issues, or external resources.
```

## Title Conventions

- Imperative mood: "Add X", "Fix Y", "Implement Z" — not "Added" or "Adding"
- Include scope when useful: "Build impersonation UI — banner + write toggle"
- Keep under 80 characters
- Never use the word "school" — always "institute"

## Quality Checklist

Before creating an issue, verify:
- [ ] Title is clear and actionable without reading the description
- [ ] Description has enough context for someone unfamiliar to start work
- [ ] Steps/changes reference specific files or modules, not vague areas
- [ ] "Does NOT Change" is set for issues touching shared code
- [ ] Dependency relations (`blockedBy`/`blocks`) are set correctly
- [ ] Labels are chosen from existing Linear labels (never invented)
- [ ] No occurrences of "school" anywhere in the issue
- [ ] Code snippets use fenced blocks with language identifiers
