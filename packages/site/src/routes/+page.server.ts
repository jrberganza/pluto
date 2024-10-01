import { ChatApp } from "library";
import type { PageServerLoad } from "./$types";

export const load = (async ({ locals }) => {
  const node = locals.node;

  return {
    node: node
      ? {
          identity: node.node.identity.toReadable(),
          addresses: Array.from(node.node.addresses),
          messages: node.chatApp.messages,
          peers: Array.from(node.baseApp.peers.keys()),
          rooms: node.chatApp.getRooms(),
          joinedRooms: node.baseApp.ownGroups
            .filter((g) => g.interest === ChatApp.GUID)
            .map((g) => g.name),
          authorNames: node.chatApp.authorNames,
        }
      : null,
  };
}) satisfies PageServerLoad;
