import * as NodeFS from "node:fs";

const inputPath = process.env.T3_JOB_INPUT;
const outputPath = process.env.T3_JOB_OUTPUT;
if (!inputPath || !outputPath) {
  throw new Error("Run this example as a configured T3 command job.");
}

const snapshot = JSON.parse(NodeFS.readFileSync(inputPath, "utf8"));
NodeFS.writeFileSync(outputPath, `${JSON.stringify({ requests: [] })}\n`, "utf8");
console.log(`Checked ${snapshot.workers.length} recorded workers. No action requested.`);
