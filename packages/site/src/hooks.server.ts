import { getNode } from "$lib/server/node";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const keyPath = event.url.searchParams.get("keypath");
  const name = event.url.searchParams.get("name");
  if (keyPath && name) {
    const node = await getNode(keyPath, name);
    event.locals.node = node;
  }

  return await resolve(event);
};
