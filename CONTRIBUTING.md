# Contributing to comail-push-relay

See [README.md](README.md) for setup.

## Pull requests

Start from current `main` and use a feature branch. Keep changes focused and fill
out the PR template with the reason, resulting behavior, tests and any remaining
gaps. Link the relevant issue, or explain `No-Issue: <reason>` for a small change.
Required checks and an approving review must pass before merge. Commits need a
verified signature and a DCO sign-off (`git commit -s`).

The required PR sections are What & why, Test evidence, and Deployment impact.
Other sections, including Change shape, Before / after, and Rollback, are
optional. Omit unused headings. Include required visual evidence and relevant
dependency or rollback details in the required sections or a useful extra
section.

Use GitHub stacks for dependent PRs in this repository. Describe dependencies on
other repositories and any compatibility, deployment or rollback requirements.

For visual changes, attach before/after screenshots or recordings directly to
the PR using synthetic data. Keep the PR draft if required attachments are
unavailable. Never commit temporary review media; preserve existing review links.
Product assets and durable documentation images belong in the repository.

## Code and comments

Follow existing patterns and use consistent names and plain language. For behavior
changes, write a failing test first, make it pass and run the affected checks.
Update generated or vendored code through its source or dependency pin.

Keep comments brief: explain contracts, constraints and reasons the code does not
make clear. Keep local tool references, assistant instructions, work notes and
tracker IDs out of code and comments. Describe current limitations where they
are implemented.

Review the final diff and remove unused code, debugging leftovers and unnecessary
wrappers. Check usage before removing compatibility paths or rollout flags.
Preserve licenses, directives, diagnostics and security boundaries.

## Local checks

```sh
npm ci --ignore-scripts
npm test
bash scripts/test-health-release.sh
```

## Issues, security and AI

Search existing issues before opening one. Use the issue template to describe
the problem, reproduction steps and expected result. Report vulnerabilities
privately through [SECURITY.md](SECURITY.md).

Respect the repository's license and contributor authorship.
[AI-assisted contributions are allowed](AI_POLICY.md) without disclosure or model
attribution. Prefer omitting "AI-assisted" stamps and boilerplate model credits.
Contributors remain responsible for correctness, testing, authorship and the right
to submit their work.
