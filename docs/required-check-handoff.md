# Push relay required-check handoff

Removing the duplicate `Validate push relay` workflow leaves the required `ci`
check without a producer. The settings handoff below must happen before this
change can merge. Repository settings and deployment enablement are unchanged.

`Test and deploy push relay` keeps every check the deleted workflow ran:
behavior tests, `npm audit --audit-level=high`, and the pinned TruffleHog secret
scan. It also runs the release health/identity script and, on main, packages the
immutable release artifact. Release, deployment, and rollback workflows are
unchanged.

The blocker is repository ruleset `Main branch review and CI` (id 24007679,
`active`), whose required status checks are `ci` and
`Build and test push relay` with `strict_required_status_checks_policy: true`.
The `ci` context must be removed by an administrator before this deletion can
merge:

1. Require the observed `Build and test push relay` check (GitHub App
   `github-actions` source) on `main`; it is already listed.
2. Prove a pull request with a failed `Build and test push relay` cannot merge,
   keeping both checks required during the overlap.
3. Remove the `ci` requirement, confirm this branch's exact-head
   `Build and test push relay` run is green, then merge the deletion.
4. After merge, verify one pull-request run and one main-push build/artifact
   run. Leave `COMAIL_PUSH_DEPLOY_ENABLED` unchanged unless the separate host
   and credential preflight is approved.

If the replacement check cannot be made required, keep this branch open: the old
workflow stays on `main` supplying `ci` until the handoff is possible.
