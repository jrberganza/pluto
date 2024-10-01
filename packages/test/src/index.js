import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const scriptPath = `${__dirname}/script.js`;
function runScript(name, createsGroup, totalRooms, totalNodes) {
  return new Promise((resolve) => {
    const scriptProc = spawn(process.argv[0], [
      scriptPath,
      name,
      createsGroup.toString(),
      totalRooms.toString(),
      totalNodes.toString(),
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

const numNodes = parseInt(process.argv[2], 10);

const nodeScripts = [];
console.log(`Starting ${numNodes} nodes...`);
for (let i = 0; i < numNodes; i++) {
  nodeScripts.push(runScript(i.toString(), i === 0, 1, numNodes));
}
console.log("Waiting for them to finish...");
const results = await Promise.all(nodeScripts);

writeFileSync(
  "results.json",
  JSON.stringify(
    results.map((r) => JSON.parse(r)),
    null,
    2,
  ),
);
