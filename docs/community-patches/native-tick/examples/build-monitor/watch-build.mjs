import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

const inputPath = process.env.T3_JOB_INPUT;
const outputPath = process.env.T3_JOB_OUTPUT;
if (!inputPath || !outputPath) throw new Error("Run this example as a configured T3 command job.");

const snapshot = JSON.parse(NodeFS.readFileSync(inputPath, "utf8"));
const build = JSON.parse(NodeFS.readFileSync("build-result.json", "utf8"));
if (typeof build.revision !== "string" || !build.revision.trim())
  throw new Error("A build revision is required.");
if (!["pending", "passed", "failed"].includes(build.status))
  throw new Error("Unsupported build status.");
if (!Array.isArray(snapshot.workers)) throw new Error("The job input must contain workers.");

const fingerprint = NodeCrypto.createHash("sha256")
  .update(JSON.stringify([build.revision, build.status]))
  .digest("hex");
let previous;
try {
  previous = JSON.parse(NodeFS.readFileSync(".build-monitor-state.json", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (build.status !== "pending" && previous?.fingerprint !== fingerprint) {
  NodeFS.appendFileSync(
    "build-notifications.jsonl",
    `${JSON.stringify({
      revision: build.revision,
      status: build.status,
      recordedWorkers: snapshot.workers.length,
    })}\n`,
    "utf8",
  );
}
NodeFS.writeFileSync(".build-monitor-state.json", `${JSON.stringify({ fingerprint })}\n`, "utf8");
NodeFS.writeFileSync(outputPath, `${JSON.stringify({ requests: [] })}\n`, "utf8");
