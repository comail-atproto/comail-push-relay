# Dependency updates

Dependabot opens weekly version updates and immediate security fixes. Compatible
patch/minor updates are grouped; major updates remain separate and need review.
GitHub-signed Dependabot commits may use the standing review policy below.

The trusted `dependency-automerge.yml` workflow may approve patch/minor Dependabot
PRs and enable GitHub auto-merge. It never checks out or runs PR code. GitHub must
still enforce signatures, an up-to-date branch, required tests and security scans.
Unsupported update types and major upgrades need review. Disable queued
auto-merge before editing a Dependabot PR by hand; those edits need normal review.

Before setting `COMAIL_DEPENDENCY_AUTOMERGE_ENABLED=true`, enable repository
auto-merge and verify that the required test and security contexts pass on a real
Dependabot PR. Keep the flag unset until those contexts are enforced. A green
metadata check alone is insufficient. Dependabot PRs receive Dependabot secrets,
not Actions secrets; provision only the source/cache reads their tests need.
Never give dependency PRs deployment credentials.

Unset the flag to stop approving new updates. To stop a PR already waiting for
checks, disable auto-merge on that PR too. Reverting this change removes the
workflows after the next merge; it does not undo dependency updates already merged.

Enable dependency graph alerts and security-fix PRs in repository settings.
Private CodeQL, dependency review and native secret protection need the relevant
GitHub entitlement. Keep existing secret, customer-data, credential-boundary and
Go source/binary scans until replacements are enabled and verified. Rotate leaked
credentials; a dependency merge does not remove that exposure.
