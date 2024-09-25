import { Node } from "$/node.js";

export abstract class App {
  node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  abstract mount(): void;

  abstract unmount(): void;

  getMessages(): Set<string> {
    const classProps = Object.getOwnPropertyNames(this.constructor);
    const protoProps = Object.getOwnPropertyNames(this.constructor.prototype);

    return new Set(
      classProps.filter(
        (p) =>
          /^[A-Z0-9_]+$/g.test(p) &&
          protoProps.includes(p) &&
          Buffer.isBuffer(this.constructor[p])
      )
    );
  }
}
