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
pushes.

The `ci` and `Build and test push relay` checks remain available for branch
protection. Keep human approval, signed commits, strict branch freshness, and
the substantive build check required.
