import { writeFileSync } from "node:fs";
import { join } from "node:path";

const status = JSON.parse(process.env.RELEASE_STATUS);
const identity = process.env.RELEASE_IDENTITY;
const digest = status.archive_sha256;
if (!/^[0-9a-f]{40}-[0-9a-f]{16}$/.test(identity) ||
    !/^[0-9a-f]{64}$/.test(digest) ||
    status.active !== identity ||
    identity.slice(41) !== digest.slice(0, 16) ||
    status.app !== process.env.RELEASE_APP ||
    status.environment !== process.env.DEPLOY_TARGET ||
    status.state?.phase !== "complete") {
  throw new Error("host status does not match the selected release");
}
const receipt = {
  app: status.app,
  environment: status.environment,
  operation: process.env.RELEASE_OPERATION,
  release_identity: identity,
  source_sha: identity.slice(0, 40),
  archive_sha256: digest,
  previous: process.env.RELEASE_PREVIOUS || null,
  workflow_run_id: process.env.GITHUB_RUN_ID,
  workflow_run_number: Number(process.env.GITHUB_RUN_NUMBER),
  workflow_run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  serving_verified: process.env.RELEASE_VERIFIED === "true",
};
writeFileSync(join(process.env.RUNNER_TEMP, "comail-release-receipt.json"), JSON.stringify(receipt) + "\n");
