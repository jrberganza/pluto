import { ChatApp } from "library";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ locals }) => {
  const node = locals.node;
  if (!node) return new Response("", { status: 404 });

  return new Response(
    JSON.stringify({
      identity: node.node.identity.toReadable(),
      addresses: Array.from(node.node.addresses),
      messages: node.chatApp.messages,
      peers: Array.from(node.baseApp.peers.keys()),
      rooms: node.chatApp.getRooms(),
      joinedRooms: node.baseApp.ownGroups
        .filter((g) => g.interest === ChatApp.GUID)
        .map((g) => g.name),
      authorNames: node.chatApp.authorNames,
    })
  );
};
