import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ locals }) => {
  const node = locals.node;
  if (!node) return new Response("", { status: 404 });

  return new Response(JSON.stringify(Array.from(node.baseApp.peers.keys())));
};
