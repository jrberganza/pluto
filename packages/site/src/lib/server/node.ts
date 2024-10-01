import { BaseApp, Identity, Node } from "library";
import { resolve } from "node:path";
import { ChatApp } from "library";

const nodes: Record<
  string,
  { node: Node; baseApp: BaseApp; chatApp: ChatApp }
> = {};

export async function getNode(path: string, myName: string) {
  const fullPath = resolve(path);

  if (fullPath in nodes) return nodes[fullPath];

  const node = await Node.me(Identity.loadOrGenSave(path));

  const baseApp = new BaseApp(node);
  baseApp.mount();
  const chatApp = new ChatApp(baseApp, myName);
  chatApp.mount();

  nodes[fullPath] = { node, baseApp, chatApp };

  return nodes[fullPath];
}
