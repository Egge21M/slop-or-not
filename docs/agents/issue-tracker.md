# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Egge21M/slop-or-not`. Use `gh` from the repo root; it infers the repository from the Git remote.

## Ticket operations

- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --comments`. Fetch labels with `gh issue view <number> --json labels` when needed.
- List: `gh issue list --state open --json number,title,body,labels,comments`, with appropriate label and state filters.
- Comment: `gh issue comment <number> --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Write multiline bodies to a temporary file and pass `--body-file`.

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. Resolve an ambiguous reference with `gh pr view <number>`, then fall back to `gh issue view <number>`.

## Wayfinding operations

For `/wayfinder`:

- Keep the map in one issue labelled `wayfinder:map`, with Notes, Decisions-so-far, and Fog in its body.
- Link child tickets as GitHub sub-issues using `gh api`. If unavailable, use a task list in the map and put `Part of #<map>` at the top of each child.
- Label children `wayfinder:<type>`: `research`, `prototype`, `grilling`, or `task`.
- Record blockers with native GitHub issue dependencies using database IDs. If unavailable, put `Blocked by: #<n>, #<n>` at the top of the child. A ticket is unblocked when every blocker is closed.
- Select the first open, unassigned child in map order that has no open blockers.
- Claim with `gh issue edit <number> --add-assignee @me` as the session's first write.
- Resolve by commenting with the answer, closing the ticket, and appending a gist plus link to the map's Decisions-so-far.
