// See https://kit.svelte.dev/docs/types#app

import type { ChatApp, BaseApp, Node } from "library";

// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      node?: { node: Node; baseApp: BaseApp; chatApp: ChatApp };
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
