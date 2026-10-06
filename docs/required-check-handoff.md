# Push relay required-check handoff

The duplicate `Validate push relay` workflow is removed. The existing
`Test and deploy push relay` workflow produces both required checks:
`Build and test push relay` runs the tests, and `ci` confirms that it succeeded.
The result check fails if the build failed, was cancelled, was skipped, or has
no result. It has no repository permissions and does not rerun the tests.

`Test and deploy push relay` keeps every check the deleted workflow ran:
behavior tests, `npm audit --audit-level=high`, and the pinned TruffleHog secret
scan. It also runs the release health/identity script and, on main, packages the
immutable release artifact. The result check runs on pull requests and main
pushes; manual deployment and rollback dispatches retain their existing checks.

Repository ruleset `Main branch review and CI` (id 24007679, `active`) requires
`ci` and `Build and test push relay` with
`strict_required_status_checks_policy: true`. Both names remain available, so
this cleanup needs no repository settings change.

An administrator can later remove the redundant `ci` requirement after proving
that a failed `Build and test push relay` blocks merge. Remove the result job
only after that settings change. Keep human approval, signed commits, strict
branch freshness, and the substantive build check required.

After merge, verify a main-push build and its immutable release artifact. Leave
`COMAIL_PUSH_DEPLOY_ENABLED` unchanged unless the separate host and credential
preflight is approved.
