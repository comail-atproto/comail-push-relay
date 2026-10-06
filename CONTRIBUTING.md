# Contributing to comail-push-relay

See [README.md](README.md) for repository ownership and setup.

## Review and delivery

Start from current `main` and use a feature branch and pull request. Describe the
problem and resulting behavior, summarize validation and any gaps, and state the
deployment and rollback effects. An authorized reviewer must approve the PR and
required checks must pass before merge. Sign commits and verify GitHub marks them
Verified; a DCO sign-off is a separate requirement. Preserve the contributor's
authorship, licenses, and dependency pins. Agents open PRs as `comail-agents[bot]`.

Use a native GitHub stack when one PR depends on another open PR in this repository:
`gh stack submit`, or `gh stack link` for existing PRs. Verify that each dependent
PR has a non-null REST `stack` object with the expected trunk, position, and size.
A child base branch alone is incomplete. Record dependencies on other repositories
in the PR body because GitHub stacks cannot span repositories. Independent changes
can use separate PRs.

Upload before/after screenshots and recordings as native GitHub attachments and
embed them inline in the PR. Capture them under ignored `review-evidence/`, using
synthetic data and no credentials. Never commit PR evidence images or videos.
Product assets and durable documentation images belong in their normal source
locations. Existing evidence paths remain frozen so old review links still work.
If attachment upload is unavailable, keep the PR draft until the evidence is
attached. Do not substitute a committed screenshot. Nonvisual changes can use
command output and a brief explanation.

App releases use the owning repository's protected workflow. Host, network,
credential, and infrastructure changes belong to `comail-infra`. Record compatible
API rollout order when a consumer needs a new authority operation. Never deploy
by restarting production services from a workstation.

## Issues and AI contributions

Search GitHub and Linear before creating an issue. Use the owning repository's
GitHub execution issue and its existing Linear mirror; GitHub feeds Linear in one
direction. Keep broader planning in Linear. Chainlink is retired: do not create
Chainlink issues or sessions. Preserve historical records. Link the tracker in the
PR, or explain `No-Issue: <reason>` when no issue is needed.

Use the issue template for the problem, reproduction steps, expected outcome,
acceptance criteria, and dependencies. Keep small issues short. Agent-authored
issues use `automated`; a `human` label or known human authorship prevents agent
edits without explicit authorization. Do not create duplicate mirrors.

The [AI contribution policy](AI_POLICY.md) permits AI-assisted code, prose, and
agent submissions. AI use does not need disclosure or model attribution. The
contributor remains responsible for understanding the change, testing it, and
having the right to submit it. Follow the same review, licensing, and DCO rules.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Code and comments

For behavior changes, write a failing test first and make it pass. Keep diffs
focused and run the relevant checks from this repository. Do not edit generated
or vendored code to change product behavior; update its source and regenerate or
repin it. Preserve authentication, authorization, privacy, and transaction boundaries.

Keep comments brief. Explain contracts, constraints, and reasons that the code
does not make clear. Omit narration that repeats the code. Keep local development
tools, assistant instructions, work notes, progress updates, and tracker references
out of product code and comments.
Tool setup belongs in development documentation or configuration; work history
belongs in issues and PRs. Describe current limitations next to the code that owns them. Preserve
necessary security reasoning, protocol details, licenses, and generator directives.

Review the complete diff before publication and run the affected checks. Remove
temporary probes, unused code, and redundant wrappers. Verify callers and
operational use before removing compatibility paths or rollout flags; retain
uncertain candidates. Preserve production diagnostics. Work in reviewable batches
across related packages.

## Local checks

```sh
npm ci --ignore-scripts
npm test
bash scripts/test-health-release.sh
```

Run `python3 -B scripts/test_review_media.py` for review policy changes.
Check staged files with `python3 scripts/check-review-media.py --staged`.

## Names and prose

Use familiar domain terms and keep one name for each concept. Name workflows and
jobs for the action they perform and the thing they act on, such as "Test and
deploy operator". Use descriptive API, type, and file names. Keep phase numbers,
tracker IDs, slogans, and temporary rollout state out of permanent names.

Write README text, comments, issues, PRs, logs, and error messages in plain language.
State what happened, what it affects, and what the reader can do next. Remove
filler, exaggerated claims, staged openings, and repeated conclusions. Preserve
facts and constraints when editing prose. Prefer existing project patterns and
standard platform features; add a custom mechanism only for a concrete requirement.
