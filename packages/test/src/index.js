import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(readFileSync("./data/config.json", "utf-8"));
const nodeExec = process.argv[0];

const scriptPath = `${__dirname}/script.js`;
function runScript(name, createsGroup) {
  return new Promise((resolve) => {
    const scriptProc = spawn(nodeExec, [
      scriptPath,
      name,
      createsGroup.toString(),
    ]);
    let result = "";
    scriptProc.stdout.on("data", (data) => {
      result += data;
    });
    scriptProc.stderr.on("data", (data) => {
      console.error(data.toString().slice(0, -1));
    });
    scriptProc.on("exit", function (code) {
      resolve(result);
    });
  });
}

const nodeScripts = [];
console.log(`Starting ${config.numNodes} nodes...`);
for (let i = 0; i < config.numNodes; i++) {
  let k = i + config.offset;
  nodeScripts.push(runScript(k.toString(), k === 0));
}
console.log("Waiting for them to finish...");
const results = await Promise.all(nodeScripts);

writeFileSync(
  "results.json",
  JSON.stringify(
    results.map((r) => JSON.parse(r)),
    null,
    2
  )
);
