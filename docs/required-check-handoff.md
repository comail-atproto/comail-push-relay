# Push relay required-check handoff

This document accompanies the draft removal of the duplicate `Validate push relay / ci` workflow. It does not change repository settings or enable deployment.

1. Merge the validation and release layers below this draft in native stack #3. Confirm the main-push `Build and test push relay` job runs the behavior tests, health check, high-severity dependency audit, pinned secret scan, and artifact package successfully.
2. With repository-admin access, inspect the actual classic branch protection and rulesets for `main`. This audit credential receives HTTP 403 for the classic protection read, so the current required contexts are unverified. Select the observed release build job as required, using its exact check name and GitHub App source shown in settings. Keep the old `ci` requirement during the overlap.
3. Verify a pull request with a failed release build cannot satisfy the required check. Then remove the old `ci` requirement, confirm this draft's exact-head release check is green, and only then merge the workflow deletion.
4. After merge, verify one PR validation run and one main-push build/artifact run. Leave `COMAIL_PUSH_DEPLOY_ENABLED` disabled until the separate host and credential preflight is approved.

If the replacement check cannot be required, leave this draft open. The old workflow continues to supply its check while the release build also runs the same gates.
