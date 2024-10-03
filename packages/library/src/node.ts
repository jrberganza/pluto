import { createSocket, type RemoteInfo, Socket } from "dgram";
import { Identity } from "./identity.js";
import { TaggedFields } from "./taggedfields.js";

const MULTICAST_ADDRESS = "225.0.0.1";
const HOST_INTERFACE = "0.0.0.0";
const MULTICAST_PORT = 40808;
const PACKET_PREFIX = Buffer.from("PLUTO 0.1\n");

export type Origin = { address: string; identity: Identity };

export class Node {
  addresses: Set<string>;
  identity: Identity;

  socket?: Socket;
  multicastSocket?: Socket;
  socketsListening: number;

  typeNames: Record<string, string>;

  messageListeners: {
    type: Buffer | null;
    handler: (origin: Origin, fields: TaggedFields, next: () => void) => void;
  }[];
  listeningListeners: Set<() => void>;

  encryptionHandlers: Set<{
    getParameters: (identity: Identity) => Buffer;
    decrypt: (
      identity: Identity,
      data: Buffer,
      parameters: Buffer
    ) => Buffer | null;
    encrypt: (
      identity: Identity,
      data: Buffer,
      parameters: Buffer
    ) => Buffer | null;
  }>;

  debugLog: boolean;

  constructor(opts: {
    addresses: Set<string>;
    identity: Identity;
    socket?: Socket;
    multicastSocket?: Socket;
    debugLog?: boolean;
  }) {
    this.addresses = opts.addresses;
    this.identity = opts.identity;
    this.socket = opts.socket;
    this.multicastSocket = opts.multicastSocket;
    this.socketsListening = 0;
    this.typeNames = {};
    this.messageListeners = [];
    this.listeningListeners = new Set();
    this.encryptionHandlers = new Set();
    this.debugLog = opts.debugLog ?? false;
  }

  static async me(identity: Identity, { port }: { port?: number } = {}) {
    const multicastSocket = createSocket({
      type: "udp4",
      reuseAddr: true,
    });

    const socket = createSocket({
      type: "udp4",
      reuseAddr: false,
    });

    const node = new Node({
      addresses: new Set(),
      identity,
      socket,
      multicastSocket,
    });

    multicastSocket.on("listening", node.listeningHandler.bind(node));
    multicastSocket.on("message", node.messageHandler.bind(node));

    await new Promise<void>((resolve) =>
      multicastSocket.bind(MULTICAST_PORT, HOST_INTERFACE, resolve)
    );

    multicastSocket.setBroadcast(true);
    multicastSocket.addMembership(MULTICAST_ADDRESS, HOST_INTERFACE);

    socket.on("listening", node.listeningHandler.bind(node));
    socket.on("message", node.messageHandler.bind(node));

    await new Promise<void>((resolve) =>
      socket.bind(port ?? 0, HOST_INTERFACE, resolve)
    );

    socket.setBroadcast(false);

    const bindedAdress = socket.address();
    node.addresses.add("127.0.0.1:" + bindedAdress.port);

    return node;
  }

  static other(opts: {
    addresses: string[] | Set<string>;
    identity: Identity;
  }) {
    const node = new Node({
      addresses: new Set(opts.addresses),
      identity: opts.identity,
    });

    return node;
  }

  listeningHandler() {
    this.socketsListening++;
    for (const listener of this.listeningListeners) {
      listener();
    }
  }

  async messageHandler(msg: Buffer, rinfo: RemoteInfo) {
    if (!msg.subarray(0, PACKET_PREFIX.byteLength).equals(PACKET_PREFIX)) {
      return;
    }

    const metaFields = TaggedFields.deserialize(
      msg.subarray(PACKET_PREFIX.byteLength)
    );

    const rawData = metaFields.get("data")!;
    const sign = metaFields.get("sign")!;
    const pkey = metaFields.get("pkey")!.toString();
    const encr = metaFields.get("encr")!;

    const originIdentity = Identity.fromReadable(pkey);
    if (!originIdentity.verify(rawData, sign)) {
      return;
    }

    let data = rawData;
    if (encr.byteLength > 0) {
      for (const { decrypt } of this.encryptionHandlers) {
        try {
          const decryptedData = decrypt(originIdentity, rawData, encr);
          if (decryptedData) {
            data = decryptedData;
            break;
          }
        } catch {
          continue;
        }
      }
      if (data === rawData) {
        return;
      }
    }

    const fields = TaggedFields.deserialize(data);

    const bufType = fields.get("type") ?? null;
    if (this.debugLog) {
      console.error(
        `@${this.identity.toReadable()} received ${(bufType
          ? this.typeNames[bufType.toString("hex")] ?? bufType.toString("hex")
          : "<null>"
        ).padEnd(36, " ")} from @${originIdentity.toReadable()}`
      );
    }

    const origin = {
      address: rinfo.address + ":" + rinfo.port,
      identity: originIdentity,
    };
    const foundListeners = this.messageListeners.filter(
      (l) => l.type === null || bufType?.equals(l.type)
    );
    for (const listener of foundListeners) {
      let doBreak = true;
      listener.handler(origin, fields, () => {
        doBreak = false;
      });
      if (doBreak) break;
    }
  }

  onMessage(
    type: string | Buffer | null,
    typeName: string | null,
    handler: (
      origin: { address: string; identity: Identity },
      fields: TaggedFields,
      next: () => void
    ) => void
  ) {
    if (!this.socket) return;

    const bufType = typeof type === "string" ? Buffer.from(type) : type;
    if (bufType && typeName) this.typeNames[bufType.toString("hex")] = typeName;

    this.messageListeners.push({
      type: bufType,
      handler,
    });
  }

  onListening(handler: () => void) {
    if (!this.socket) return;

    this.listeningListeners.add(handler);

    if (this.socketsListening >= 2) {
      handler();
    }
  }

  buildMessage(data: Buffer, encrypted: Buffer | null) {
    return Buffer.concat([
      PACKET_PREFIX,
      TaggedFields.from({
        pkey: this.identity.toReadable(),
        sign: this.identity.sign(data),
        encr: encrypted ?? "",
        data,
      }).serialize(),
    ]);
  }

  sendTo(to: Node | null, fields: TaggedFields, forceEncryption?: boolean) {
    if (!this.socket) return;

    const destAddr =
      to?.addresses ?? new Set([MULTICAST_ADDRESS + ":" + MULTICAST_PORT]);

    const rawData = fields.serialize();

    let data = rawData;
    let encrypted: Buffer | null = null;
    if (to) {
      for (const { encrypt, getParameters } of this.encryptionHandlers) {
        const parameters = getParameters(to.identity);
        try {
          const encryptedData = encrypt(to.identity, rawData, parameters);
          if (encryptedData) {
            data = encryptedData;
            encrypted = parameters;
            break;
          }
        } catch {
          continue;
        }
      }
      if (forceEncryption && !encrypted) return;
    }

    if (this.debugLog) {
      console.error(
        `@${this.identity.toReadable()} sent     ${(fields.get("type")
          ? this.typeNames[fields.get("type")!.toString("hex")] ??
            fields.get("type")!.toString("hex")
          : "<null>"
        ).padEnd(36, " ")} to   @${to?.identity?.toReadable() ?? "everyone"}`
      );
    }

    for (const fullAddr of destAddr) {
      const [addr, port] = fullAddr.split(":");
      try {
        this.socket.send(
          this.buildMessage(data, encrypted),
          parseInt(port, 10),
          addr
        );
        break;
      } catch {
        continue;
      }
    }
  }

  registerEncryptionHandler(handler: {
    getParameters: (identity: Identity) => Buffer;
    decrypt: (
      identity: Identity,
      data: Buffer,
      parameters: Buffer
    ) => Buffer | null;
    encrypt: (
      identity: Identity,
      data: Buffer,
      parameters: Buffer
    ) => Buffer | null;
  }) {
    this.encryptionHandlers.add(handler);
  }
}
