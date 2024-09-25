import { ChatApp } from "$lib/server/chat";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ locals }) => {
  const node = locals.node;
  if (!node) return new Response("", { status: 404 });

  return new Response(
    JSON.stringify(
      node.baseApp.ownGroups
        .filter((g) => g.interest === ChatApp.GUID)
        .map((g) => g.name)
    )
  );
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const node = locals.node;
  if (!node) return new Response("", { status: 404 });

  const json = await request.json();

  node.chatApp.createRoom(json.password);

  await new Promise((resolve) => setTimeout(resolve, 100));

  return new Response(JSON.stringify(node.chatApp.getRooms()));
};
