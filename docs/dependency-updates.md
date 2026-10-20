# Dependency updates

Dependabot groups weekly patch and minor updates per ecosystem. Major upgrades
remain separate. Security fixes have their own group, including fixes that need
a major upgrade and human review.
Each ecosystem has at most one open routine update PR. Security updates use
their separate queue and are not capped by this setting.
Scott's standing policy permits automated review and merge of tested application
patches and stable minor updates. Actions, Nix, Native, pre-1.0 minors, and minors
without version metadata for every updated package require human review.
Bot identity and signatures are checked before approval; the approval job never
checks out PR code.

Keep `COMAIL_DEPENDENCY_AUTOMERGE_ENABLED` unset until GitHub enforces DCO,
verified signatures, full application tests and `dependency-security`, and a
real Dependabot PR passes them. Retain existing secret, customer-data, Go binary
and deployment health checks. Dependabot needs its own read-only source/cache
secrets; never give it deployment credentials. Existing release holds still apply.

To stop automation, unset the flag and disable auto-merge on already queued PRs.
Human edits to a bot PR also need queued auto-merge disabled and normal review.
