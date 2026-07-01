Add in an option to 'kick off a feature'
- Add in name of branches to checkout
- Select the repos which will change.
- Have some kind of grouping display.
- Be able to add repos to the grouping as you go.

---

# Plan: Multi-repo "Feature Workspaces" (assessment + decision gates)

> Tick `[ ]` -> `[x]` as you decide/complete each item. Items marked `[Good]`
> are informational (no action needed).

## Summary
This is a **multi-repo feature-workspace** feature: define a named *group* of
repos, then create/checkout a same-named branch across all of them at once
(GitKraken "Workspaces" style). It fits the current architecture well because
repos are already stored as bookmarks and every git call already takes a `cwd`.

- [Good] Existing `RepoBookmark[]` + `activeRepoPath` model extends naturally to groups.
- [Good] `runGit(cwd, args)` already isolates per-repo calls — batch = a loop on the main side.
- [Good] `createBranch(name, checkoutNew, startPoint)` already exists; batch is orchestration.
- [Good] Hardest part is **partial-failure UX**, not the git commands themselves.

## Decision gate (answer these first)
- [ ] Do I regularly work across **2+ repos that move together** (front/back, microservices)?
      If NO -> stop here, not worth the UI cost.
- [ ] Would a *named group + one-click branch-across-repos* actually save me time vs. switching the active repo?
- [ ] Am I OK with the MVP being "start feature" only (no batch commit/push at first)?

## Open questions to settle before building
- [ ] Group persistence: store groups alongside repo bookmarks in the main store (same file/pattern)?
- [ ] Base ref per feature: single base for all repos (e.g. `main`), or per-repo base?
- [ ] Behaviour if a repo has a **dirty working tree** — block, auto-stash, or skip that repo?
- [ ] Behaviour if the **branch already exists** in a repo — checkout it, or report as skipped?
- [ ] Should a repo be allowed in multiple groups at once?
- [ ] Does "kick off a feature" also create a branch on repos added to the group *later*?

## Phased build plan (each phase is independently shippable)

### Phase 1 — Repo groups (data model + display)  — effort: M
- [ ] Add a `RepoGroup` type (`id`, `name`, `repoIds: string[]`) to `src/shared/types.ts`.
- [ ] Persist groups in the main store (`src/main/store.ts`) with list/create/rename/delete/assign IPC.
- [ ] Extend the 7-layer chain: `channels.ts` -> `ipc.ts` -> `preload/index.ts` -> renderer `store.ts`.
- [ ] Sidebar: grouping display (collapsible group headers listing member repos).
- [ ] "Add repo to group" as you go (context menu / drag or a picker).
- [ ] Typecheck + manual test with 2 dummy repos.

### Phase 2 — "Start a feature" action  — effort: M/L (the real value)
- [ ] Dialog: feature/branch name, base ref, checkboxes to pick which repos in the group change.
- [ ] Main-side batch op: loop selected repos, `createBranch(name, checkout=true, base)` each.
- [ ] Aggregate results into a **per-repo outcome list** (created / checked-out-existing / skipped-dirty / failed+reason).
- [ ] Result panel/modal showing each repo's outcome (this is where the UX effort concentrates).
- [ ] Decide dirty-tree policy from the open questions above and implement it.
- [ ] Typecheck + test the partial-failure paths deliberately.

### Phase 3 (optional) — Group overview / batch status  — effort: M
- [ ] Show current branch + ahead/behind per repo in the group at a glance.
- [ ] Batch fetch / pull / push across the group with the same aggregated-result panel.

### Phase 4 (optional) — Finish/cleanup a feature  — effort: M
- [ ] Batch delete the feature branch across the group (with safety confirmation).
- [ ] Optional: batch checkout back to base.

## Risks / watch-outs
- [ ] Partial failure reporting must be crystal clear or the feature feels broken.
- [ ] Detached HEAD / missing base branch / protected branches per repo.
- [ ] Group membership drifting out of sync if a repo bookmark is removed (cascade cleanup).
- [ ] Scope creep — resist adding batch-commit until Phase 1+2 prove the workflow is used.

## Recommendation
Pursue **only if the first decision-gate answer is YES**. If so, build Phase 1
then Phase 2 and stop to evaluate real usage before investing in Phases 3-4.