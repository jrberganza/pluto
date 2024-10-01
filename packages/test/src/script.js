import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { BaseApp, ChatApp, Identity, Node, TaggedFields } from "library";

function waitUntil(func, checkInterval) {
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      if (func()) {
        clearInterval(intervalId);
        resolve(undefined);
      }
    }, checkInterval);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (!existsSync("./data")) {
  mkdirSync("./data");
}

const identityName = process.argv[2] ?? Date.now().toString();
const createRooms = process.argv[3] === "true";
const totalRooms = parseInt(process.argv[4], 10);
const totalNodes = parseInt(process.argv[5], 10);

const node = await Node.me(Identity.loadOrGenSave(`./data/me_${identityName}`));
const baseApp = new BaseApp(node);
baseApp.discoverIntervalEnabled = false;
baseApp.mount();
const chatApp = new ChatApp(baseApp, `Nodo ${identityName}`);
chatApp.mount();

const latencies = [];
function ping() {
  const uuid = randomUUID();
  const time = Date.now();

  node.sendTo(
    null,
    TaggedFields.from({
      type: PING,
      time: time.toString(),
      uuid,
    })
  );
}

const PING = Buffer.from("01922b6d1b85799991e5ee65bbe37a33", "hex");
node.onMessage(PING, "PING", (origin, fields) => {
  if (origin.identity.toReadable() === node.identity.toReadable()) return;

  const { peer } = baseApp.getPeer(origin);
  fields.clearAndSet("type", PONG);
  node.sendTo(peer, fields);
});

const PONG = Buffer.from("01922b6d3b03799991e5f77c512fb2e3", "hex");
node.onMessage(PONG, "PONG", (_, fields) => {
  const thenTime = parseInt(fields.get("time")?.toString(), 10);
  const nowTime = Date.now();
  const difference = nowTime - thenTime;

  latencies.push(difference);
});

await delay(1 * 1000);

if (createRooms) {
  chatApp.createRoom();
}

const joinInterval = setInterval(() => {
  for (const room of chatApp.getRooms()) {
    if (
      baseApp.ownGroups.find(
        (g) => g.interest === ChatApp.GUID && g.name === room
      )
    ) {
      baseApp.ANNOUNCE_GROUP(null, ChatApp.GUID, room);
    } else {
      chatApp.joinRoom(room);
    }
  }
}, 1 * 1000);

let joinTimedout = false;
setTimeout(() => {
  joinTimedout = true;
}, 10 * 1000);

await waitUntil(() => {
  if (joinTimedout) return true;
  if (baseApp.ownGroups.length < totalRooms) return false;
  for (const group of baseApp.ownGroups) {
    if (group.members.size < totalNodes - 1) return false;
  }
  return true;
}, 1 * 1000);

clearInterval(joinInterval);

let sent = 0;
const messageInterval = setInterval(() => {
  if (sent >= 30) return;
  for (const room of chatApp.getRooms()) {
    chatApp.PLAIN(room, `Hola ${sent}`);
  }
  sent++;
}, 1 * 1000);

const pingInterval = setInterval(() => {
  ping();
}, 1 * 1000);

let messageTimedout = false;
setTimeout(() => {
  messageTimedout = true;
}, 120 * 1000);

await waitUntil(() => {
  if (sent < 30) return false;
  if (messageTimedout) return true;
  for (const messages of Object.values(chatApp.messages)) {
    if (messages.length < totalNodes * 30) return false;
  }
  return true;
}, 1 * 1000);

clearInterval(messageInterval);
clearInterval(pingInterval);

console.log(
  JSON.stringify({
    identity: node.identity.toReadable(),
    avgLatency:
      latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length,
    messages: Object.fromEntries(
      Object.entries(chatApp.messages).map(([room, messages]) => [
        room,
        messages.length,
      ])
    ),
  })
);
process.exit(0);
