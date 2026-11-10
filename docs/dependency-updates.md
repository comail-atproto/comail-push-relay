# Dependency updates

Dependabot groups weekly patch and minor updates per ecosystem. Major upgrades
remain separate. Security fixes have their own group, including fixes that need
a major upgrade and human review.
Each ecosystem has at most one open routine update PR. Security updates use
their separate queue and are not capped by this setting.
The policy permits automated review and merge of tested application
patches and stable minor updates. Actions, Nix, Native, pre-1.0 minors, and minors
without version metadata for every updated package require human review.
Bot identity and signatures are checked before approval; the approval job never
checks out PR code.

Only a single verified Dependabot commit qualifies. Multi-commit PRs require
review because the metadata action reads only the first commit.

The metadata workflow runs from main with `pull_request_target` and never checks
out PR code. A repository-scoped App token performs the merge so main CI/CD runs.
Its key lives in the main-only `dependency-automation` environment. The merge controller
checks out only the trusted workflow revision, never PR code. Workflow changes require review.

Keep `COMAIL_DEPENDENCY_AUTOMERGE_ENABLED` unset until GitHub enforces
verified signatures, full application tests and `dependency-security`, and a
real App-merged Dependabot PR passes them and starts main CI/CD. Retain existing
secret, customer-data, Go binary and deployment health checks. Dependabot needs its own read-only source/cache
secrets; never give it deployment credentials. Existing release holds still apply.

The metadata action records a policy approval for one exact verified Dependabot
commit. The controller runs after CI and checks the current head, signature,
approval, base, draft state and the `human` hold label again. GitHub then enforces
required checks and reviews against that exact SHA. It never queues a native
merge request, so an earlier approval cannot authorize a later writer commit.
Majors, missing metadata and agent repairs keep their normal review requirements.

The shared CI policy suite tests its current source. Push Relay keeps tests for
its pinned v0.1.0 `comail-policy` bundle from `atmosphere-mail`, which the shared
suite does not verify. Those tests cover stale approvals and the workflow rule
against persistent native auto-merge requests. They run with deployment
safeguards in the required build job. The maintained metadata action still
classifies all packages.

`scripts/dependency-merge.py` keeps the bundled authorization rules and uses the
current reviewed PR title as the squash subject. The bundle's original CLI uses
the commit subject, so this public entry point adapts its merge API payload.
The signed commit body and trailers stay intact. Controller tests cover the
title change and confirm that the readiness check cannot request a merge.

To pause automation, unset the flag and cancel active runs of this workflow.
Before upgrading the old controller, disable its existing native auto-merge
requests too. No new native requests are created by this controller.

Push Relay is public and cannot call the private shared CI actions or use the
private runner group. Keep its hosted jobs and bundled policy until a public
shared-action distribution is reviewed.
