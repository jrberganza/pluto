import { intToBufferBE } from "$/buffer";
import { Identity } from "$/identity";
import {
  createCipheriv,
  createDecipheriv,
  createDiffieHellman,
  createDiffieHellmanGroup,
  DiffieHellman,
  DiffieHellmanGroup,
  hkdfSync,
  randomBytes,
} from "crypto";
import { parse, stringify } from "uuid";
import { Node, type Origin } from "../node";
import { TaggedFields } from "../taggedfields";
import { App } from "./app";

type Group = {
  interest: string; // uuid
  name: string; // uuid
  accessKey: Buffer;
  leader: {
    failureTimeout: NodeJS.Timeout | null; // Null if self is leader
    heartBeatInterval: NodeJS.Timeout | null; // Non-null if self is leader
    identity: Identity; // Readable Identity of the leader
    recognition: Set<string> | null; // Non-null if self is leader. Must be greater than half of the members
  };
  members: Map<string, Node>; // Keyed by readable identity
};

export class BaseApp extends App {
  node: Node;

  peers: Map<string, Node> = new Map(); // Keyed by readable identity
  secureChannels: Map<
    string,
    {
      dh: DiffieHellman | DiffieHellmanGroup;
      secret: Buffer | null;
    }
  > = new Map();

  knownGroups: {
    interest: string;
    name: string;
    announcers: Set<string>;
  }[] = [];
  ownGroups: Group[] = [];

  groupMessageListeners: {
    interest: string;
    name: string;
    type: Buffer;
    handler: (
      origin: Origin,
      group: Group,
      fields: TaggedFields,
      next: () => void
    ) => void;
  }[] = [];

  constructor(node: Node) {
    super(node);
    this.node = node;
  }

  mount(): void {
    this.node.onMessage(
      BaseApp.DISCOVER,
      "DISCOVER",
      this.DISCOVER_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.DISCOVER_RESPONSE,
      "DISCOVER_RESPONSE",
      this.DISCOVER_RESPONSE_HANDLER.bind(this)
    );
    this.node.onMessage(BaseApp.PEERS, "PEERS", this.PEERS_HANDLER.bind(this));
    this.node.onMessage(
      BaseApp.PEERS_RESPONSE,
      "PEERS_RESPONSE",
      this.PEERS_RESPONSE_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.ANNOUNCE_GROUP,
      "ANNOUNCE_GROUP",
      this.ANNOUNCE_GROUP_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.JOIN_GROUP,
      "JOIN_GROUP",
      this.JOIN_GROUP_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.ACCEPT_JOIN_REQUEST,
      "ACCEPT_JOIN_REQUEST",
      this.ACCEPT_JOIN_REQUEST_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.ANNOUNCE_MEMBER,
      "ANNOUNCE_MEMBER",
      this.ANNOUNCE_MEMBER_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.HEARTBEAT,
      "HEARTBEAT",
      this.HEARTBEAT_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.CAMPAIGN,
      "CAMPAIGN",
      this.CAMPAIGN_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.RECOGNIZE,
      "RECOGNIZE",
      this.RECOGNIZE_HANDLER.bind(this)
    );
    this.node.onMessage(
      BaseApp.SHARE_DH_KEY,
      "SHARE_DH_KEY",
      this.SHARE_DH_KEY_HANDLER.bind(this)
    );

    const self = this;
    this.node.registerEncryptionHandler({
      getParameters() {
        return randomBytes(16);
      },
      encrypt(identity, data, parameters) {
        if (!self.secureChannels.get(identity.toReadable())?.secret)
          return null;

        const cipher = createCipheriv(
          "aes-256-cbc",
          self.secureChannels.get(identity.toReadable())!.secret!,
          parameters
        );
        return Buffer.concat([cipher.update(data), cipher.final()]);
      },
      decrypt(identity, data, parameters) {
        if (!self.secureChannels.get(identity.toReadable())?.secret)
          return null;

        const decipher = createDecipheriv(
          "aes-256-cbc",
          self.secureChannels.get(identity.toReadable())!.secret!,
          parameters
        );
        return Buffer.concat([decipher.update(data), decipher.final()]);
      },
    });

    // Discovery
    this.node.onListening(() => {
      this.DISCOVER();
      setInterval(() => {
        this.DISCOVER();
      }, 1000);
    });
  }

  unmount(): void {
    throw new Error("Method not implemented.");
  }

  getPeer(origin: { address: string | null; identity: Identity }): {
    peer: Node;
    known: boolean;
  } {
    const readableIdentity = origin.identity.toReadable();
    if (this.peers.has(readableIdentity)) {
      const node = this.peers.get(readableIdentity)!;
      if (origin.address) node.addresses.add(origin.address);
      return { peer: node, known: true };
    } else {
      const node = Node.other({
        addresses: new Set(origin.address ? [origin.address] : []),
        identity: origin.identity,
      });
      if (origin.address) this.peers.set(readableIdentity, node);
      this.startDh(node);
      return { peer: node, known: false };
    }
  }

  startDh(dest: Node) {
    const dh = createDiffieHellmanGroup("modp16");
    dh.generateKeys();
    this.secureChannels.set(dest.identity.toReadable(), {
      dh,
      secret: null,
    });
    this.SHARE_DH_KEY(
      dest,
      dh.getPrime(),
      dh.getGenerator(),
      dh.getPublicKey()
    );
  }

  static heartbeatIntervalMs = 1000;
  static failureTimeoutMs = BaseApp.heartbeatIntervalMs * 1.1;
  static failureJitter = BaseApp.failureTimeoutMs * 0.1;
  setLeader(group: Group, identity: Identity) {
    if (group.leader.identity.toReadable() === identity.toReadable()) return;

    if (identity.toReadable() === this.node.identity.toReadable()) {
      if (group.leader.failureTimeout !== null) {
        clearTimeout(group.leader.failureTimeout);
        group.leader.failureTimeout = null;
      }
      if (group.leader.heartBeatInterval === null)
        group.leader.heartBeatInterval = setInterval(() => {
          this.sendHeartbeats(group);
        }, BaseApp.heartbeatIntervalMs);
      group.leader.identity = identity;
      group.leader.recognition = new Set();
    } else {
      if (group.leader.failureTimeout === null)
        group.leader.failureTimeout = setTimeout(() => {
          group.leader.failureTimeout = null;
          this.startCampaign(group);
        }, BaseApp.failureTimeoutMs + Math.random() * BaseApp.failureJitter);
      if (group.leader.heartBeatInterval !== null) {
        clearInterval(group.leader.heartBeatInterval);
        group.leader.heartBeatInterval = null;
      }
      group.leader.identity = identity;
      group.leader.recognition = new Set();
    }
  }

  registerHeartbeat(group: Group, identity: Identity) {
    if (
      group.leader.identity.toReadable() !== identity.toReadable() ||
      group.leader.identity.toReadable() === this.node.identity.toReadable()
    )
      return;

    if (group.leader.failureTimeout !== null)
      clearTimeout(group.leader.failureTimeout);
    group.leader.failureTimeout = setTimeout(() => {
      group.leader.failureTimeout = null;
      this.startCampaign(group);
    }, BaseApp.failureTimeoutMs + Math.random() * BaseApp.failureJitter);
  }

  startCampaign(group: Group) {
    this.setLeader(group, this.node.identity);
    for (const [, member] of group.members) {
      this.CAMPAIGN(member, group);
    }
  }

  sendHeartbeats(group: Group) {
    if (group.leader.identity !== this.node.identity) return;
    if (group.leader.recognition!.size < group.members.size / 2) return;

    for (const [, member] of group.members) {
      this.HEARTBEAT(member, group);
    }
  }

  createGroup(
    interest: string,
    name: string,
    accessKey: string | Buffer,
    announce: boolean = false
  ) {
    const group: Group = {
      interest,
      name,
      accessKey: Buffer.from(accessKey),
      leader: {
        failureTimeout: null,
        heartBeatInterval: setInterval(() => {
          this.sendHeartbeats(group);
        }, BaseApp.heartbeatIntervalMs),
        identity: this.node.identity,
        recognition: new Set(),
      },
      members: new Map(),
    };
    this.ownGroups.push(group);
    if (announce) this.ANNOUNCE_GROUP(null, interest, name);
  }

  getGroup(interest: string, name: string): Group | undefined {
    const group = this.ownGroups.find(
      (g) => g.interest === interest && g.name === name
    );
    return group;
  }

  sendToGroup(interest: string, name: string, fields: TaggedFields) {
    const group = this.getGroup(interest, name);
    if (!group) return;

    fields.clearAndSet("intr", Buffer.from(parse(interest)));
    fields.clearAndSet("name", Buffer.from(parse(name)));

    if (
      group.leader.identity.toReadable() === this.node.identity.toReadable()
    ) {
      for (const [, member] of group.members) {
        this.node.sendTo(member, fields, true);
      }
      this.node.sendTo(this.node, fields);
    } else {
      const peer = this.peers.get(group.leader.identity.toReadable());
      if (!peer) return;
      this.node.sendTo(peer, fields);
    }
  }

  onGroupMessage(
    interest: string,
    type: string | Buffer | null,
    typeName: string | null,
    handler: (
      origin: Origin,
      group: Group,
      fields: TaggedFields,
      next: () => void
    ) => void
  ) {
    this.node.onMessage(type, typeName, (origin, fields, next) => {
      if (!fields.get("intr") || !fields.get("name")) return next();

      const mInterest = stringify(fields.get("intr")!);
      if (mInterest !== interest) return next();
      const name = stringify(fields.get("name")!);

      const group = this.getGroup(mInterest, name);
      if (!group) return next();

      if (
        this.node.identity.toReadable() ===
          group.leader.identity.toReadable() &&
        origin.identity.toReadable() !== this.node.identity.toReadable()
      ) {
        for (const [, member] of group.members) {
          this.node.sendTo(member, fields, true);
        }
      }

      handler(origin, group, fields, next);
    });
  }

  static DISCOVER = Buffer.from(parse("0191cff5-1f42-7dba-9a18-32570fe5d8f9"));
  DISCOVER() {
    this.node.sendTo(
      null,
      TaggedFields.from({
        type: BaseApp.DISCOVER,
        pkey: this.node.identity.toReadable(),
      })
    );
  }

  DISCOVER_HANDLER(origin: Origin) {
    if (origin.identity.toReadable() === this.node.identity.toReadable())
      return;
    const { peer, known } = this.getPeer(origin);
    if (!known) this.DISCOVER_RESPONSE(peer);
  }

  static DISCOVER_RESPONSE = Buffer.from(
    parse("0191cff5-1f42-7c17-98d7-8e170189fa3c")
  );
  DISCOVER_RESPONSE(dest: Node) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.DISCOVER_RESPONSE,
        pkey: this.node.identity.toReadable(),
      })
    );
  }

  DISCOVER_RESPONSE_HANDLER(origin: Origin) {
    this.getPeer(origin);
  }

  static PEERS = Buffer.from(parse("0191cff5-1f42-7ef9-bc15-c3cf0ee2f2be"));
  PEERS(dest: Node) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.PEERS,
        pkey: this.node.identity.toReadable(),
      })
    );
  }

  PEERS_HANDLER(origin: Origin) {
    const { peer } = this.getPeer(origin);
    this.PEERS_RESPONSE(peer);
  }

  static PEERS_RESPONSE = Buffer.from(
    parse("0191cff5-1f42-71a2-ae23-3af1fac4279f")
  );
  PEERS_RESPONSE(dest: Node) {
    const fields = TaggedFields.from({
      type: BaseApp.PEERS_RESPONSE,
    });
    for (const [readableIdentity, peer] of this.peers) {
      if (dest.identity.toReadable() === readableIdentity) continue;
      for (const addr of peer.addresses) {
        fields.add("oadd", addr);
        fields.add("okey", readableIdentity);
      }
    }
    this.node.sendTo(dest, fields);
  }

  PEERS_RESPONSE_HANDLER(origin: Origin, fields: TaggedFields) {
    this.getPeer(origin);
    const addresses = fields.getAll("oadd");
    const keys = fields.getAll("okey");
    for (let i = 0; i < keys.length && i < addresses.length; i++) {
      const address = addresses[i].toString();
      const identity = Identity.fromReadable(keys[i].toString());
      this.getPeer({ address, identity });
    }
  }

  static ANNOUNCE_GROUP = Buffer.from(
    parse("0191cff5-1f42-74e8-a0e9-a9cd969680de")
  );
  ANNOUNCE_GROUP(
    dest: Node | null,
    interest: string | Buffer,
    name: string | Buffer
  ) {
    const bufInterest =
      typeof interest === "string" ? Buffer.from(parse(interest)) : interest;
    const bufName = typeof name === "string" ? Buffer.from(parse(name)) : name;

    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.ANNOUNCE_GROUP,
        intr: bufInterest,
        name: bufName,
      })
    );
  }

  ANNOUNCE_GROUP_HANDLER(origin: Origin, fields: TaggedFields) {
    const interest = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);

    const announcer = origin.identity.toReadable();
    const foundGroup = this.knownGroups.find(
      (g) => g.interest === interest && g.name === name
    );
    if (foundGroup) {
      foundGroup.announcers.add(announcer);
    } else {
      this.knownGroups.push({
        interest,
        name,
        announcers: new Set([announcer]),
      });
    }
  }

  static JOIN_GROUP = Buffer.from(
    parse("0191cff5-1f42-73ce-ac38-3c74c9655cdf")
  );
  JOIN_GROUP(
    dest: Node,
    joiningAddress: string | null,
    joiningIdentity: string | null,
    interest: string | Buffer,
    name: string | Buffer,
    accessKey: string | Buffer
  ) {
    const bufInterest =
      typeof interest === "string" ? Buffer.from(parse(interest)) : interest;
    const bufName = typeof name === "string" ? Buffer.from(parse(name)) : name;
    const bufAccessKey =
      typeof accessKey === "string" ? Buffer.from(accessKey) : accessKey;

    const fields = TaggedFields.from({
      type: BaseApp.JOIN_GROUP,
      intr: bufInterest,
      name: bufName,
      akey: bufAccessKey,
    });

    if (joiningAddress) fields.add("oadd", joiningAddress);
    if (joiningIdentity) fields.add("okey", joiningIdentity);

    this.node.sendTo(dest, fields, true);
  }

  JOIN_GROUP_HANDLER(origin: Origin, fields: TaggedFields) {
    const oadd = fields.get("oadd")?.toString() ?? origin.address;
    const okey = fields.get("okey")?.toString() ?? origin.identity.toReadable();
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const akey = fields.get("akey")!;

    const group = this.getGroup(intr, name);
    if (!group) return;
    if (!akey.equals(group.accessKey)) return;

    if (
      group.leader.identity.toReadable() === this.node.identity.toReadable()
    ) {
      const otherIdentity = Identity.fromReadable(okey);
      const { peer } = this.getPeer({
        identity: otherIdentity,
        address: oadd,
      });

      for (const [, member] of group.members) {
        this.ANNOUNCE_MEMBER(member, oadd, otherIdentity, group);
      }
      group.members.set(okey, peer);
      group.leader.recognition!.add(okey);

      this.ACCEPT_JOIN_REQUEST(peer, group);
    } else {
      const { peer } = this.getPeer({
        identity: group.leader.identity,
        address: null,
      });
      this.JOIN_GROUP(peer, oadd, okey, intr, name, akey);
    }
  }

  static ACCEPT_JOIN_REQUEST = Buffer.from(
    parse("0191cff5-1f42-7c59-8716-dda08db61050")
  );
  ACCEPT_JOIN_REQUEST(dest: Node, group: Group) {
    const fields = TaggedFields.from({
      type: BaseApp.ACCEPT_JOIN_REQUEST,
      intr: Buffer.from(parse(group.interest)),
      name: Buffer.from(parse(group.name)),
      akey: group.accessKey,
    });
    for (const [readableIdentity, peer] of group.members) {
      if (dest.identity.toReadable() === readableIdentity) continue;
      for (const addr of peer.addresses) {
        fields.add("oadd", addr);
        fields.add("okey", readableIdentity);
      }
    }

    this.node.sendTo(dest, fields, true);
  }

  ACCEPT_JOIN_REQUEST_HANDLER(origin: Origin, fields: TaggedFields) {
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const akey = fields.get("akey")!;

    const members = new Map<string, Node>();
    const addresses = fields.getAll("oadd");
    const keys = fields.getAll("okey");
    for (let i = 0; i < keys.length && i < addresses.length; i++) {
      const address = addresses[i].toString();
      const identity = Identity.fromReadable(keys[i].toString());
      members.set(keys[i].toString(), this.getPeer({ address, identity }).peer);
    }
    members.set(origin.identity.toReadable(), this.getPeer(origin).peer);

    const group: Group = {
      interest: intr,
      name,
      accessKey: akey,
      leader: {
        failureTimeout: setTimeout(() => {
          group.leader.failureTimeout = null;
          this.startCampaign(group);
        }, BaseApp.failureTimeoutMs + Math.random() * BaseApp.failureJitter),
        heartBeatInterval: null,
        identity: origin.identity,
        recognition: null,
      },
      members,
    };

    this.ownGroups.push(group);
  }

  static ANNOUNCE_MEMBER = Buffer.from(
    parse("0191cff5-1f42-78b5-91a3-278d4bd58de1")
  );
  ANNOUNCE_MEMBER(
    dest: Node,
    address: string,
    identity: Identity,
    group: Group
  ) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.ANNOUNCE_MEMBER,
        intr: Buffer.from(parse(group.interest)),
        name: Buffer.from(parse(group.name)),
        oadd: address,
        okey: identity.toReadable(),
      }),
      true
    );
  }

  ANNOUNCE_MEMBER_HANDLER(origin: Origin, fields: TaggedFields) {
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const oadd = fields.get("oadd")!.toString();
    const okey = fields.get("okey")!.toString();

    const group = this.getGroup(intr, name);
    if (!group) return;

    group.members.set(
      okey,
      this.getPeer({ address: oadd, identity: Identity.fromReadable(okey) })
        .peer
    );
  }

  static HEARTBEAT = Buffer.from(parse("0191cff5-1f42-7802-9c79-184f49e562f5"));
  HEARTBEAT(dest: Node, group: Group) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.HEARTBEAT,
        intr: Buffer.from(parse(group.interest)),
        name: Buffer.from(parse(group.name)),
        time: intToBufferBE(Math.floor(Date.now() / 1000), true, 8),
      }),
      true
    );
  }

  HEARTBEAT_HANDLER(origin: Origin, fields: TaggedFields) {
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const beaterIdentity = origin.identity;

    const group = this.getGroup(intr, name);
    if (!group) return;
    if (beaterIdentity.toReadable() !== group.leader.identity.toReadable())
      return;

    this.registerHeartbeat(group, beaterIdentity);
  }

  static CAMPAIGN = Buffer.from(parse("0191cff5-1f42-7eb5-a018-44eb50286c41"));
  CAMPAIGN(dest: Node, group: Group) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.CAMPAIGN,
        intr: Buffer.from(parse(group.interest)),
        name: Buffer.from(parse(group.name)),
        time: intToBufferBE(Math.floor(Date.now() / 1000), true, 8),
      }),
      true
    );
  }

  CAMPAIGN_HANDLER(origin: Origin, fields: TaggedFields) {
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const beaterIdentity = origin.identity;

    const group = this.getGroup(intr, name);
    if (!group) return;

    this.setLeader(group, beaterIdentity);
    this.RECOGNIZE(this.getPeer(origin).peer, group);
  }

  static RECOGNIZE = Buffer.from(parse("0191cff5-1f42-764f-aa14-83cfa9bae5a7"));
  RECOGNIZE(dest: Node, group: Group) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.RECOGNIZE,
        intr: Buffer.from(parse(group.interest)),
        name: Buffer.from(parse(group.name)),
        time: intToBufferBE(Math.floor(Date.now() / 1000), true, 8),
      }),
      true
    );
  }

  RECOGNIZE_HANDLER(origin: Origin, fields: TaggedFields) {
    const intr = stringify(fields.get("intr")!);
    const name = stringify(fields.get("name")!);
    const recognizerIdentity = origin.identity.toReadable();

    const group = this.getGroup(intr, name);
    if (!group) return;

    group.leader.recognition!.add(recognizerIdentity);

    if (group.leader.recognition!.size < group.members.size / 2) return;
    this.sendHeartbeats(group);
  }

  static SHARE_DH_KEY = Buffer.from(
    parse("0191fcd2-8bd7-7b79-a684-687b02ac9455")
  );
  SHARE_DH_KEY(
    dest: Node,
    prime: Buffer,
    generator: Buffer,
    publicKey: Buffer
  ) {
    this.node.sendTo(
      dest,
      TaggedFields.from({
        type: BaseApp.SHARE_DH_KEY,
        prme: prime,
        gene: generator,
        pkey: publicKey,
      })
    );
  }

  SHARE_DH_KEY_HANDLER(origin: Origin, fields: TaggedFields) {
    const readableIdentity = origin.identity.toReadable();
    if (this.secureChannels.has(readableIdentity)) {
      const channel = this.secureChannels.get(readableIdentity)!;
      channel.secret = Buffer.from(
        hkdfSync(
          "sha512",
          channel.dh.computeSecret(fields.get("pkey")!),
          "",
          "",
          32
        )
      );
    } else {
      const dh = createDiffieHellman(fields.get("prme")!, fields.get("gene")!);
      dh.generateKeys();
      this.SHARE_DH_KEY(
        this.getPeer(origin).peer,
        dh.getPrime(),
        dh.getGenerator(),
        dh.getPublicKey()
      );
      this.secureChannels.set(origin.identity.toReadable(), {
        dh,
        secret: Buffer.from(
          hkdfSync("sha512", dh.computeSecret(fields.get("pkey")!), "", "", 32)
        ),
      });
    }
  }
}
