import { Node, Origin } from "$/node.js";
import { TaggedFields } from "$/taggedfields.js";
import { parse, v7 } from "uuid";
import { App } from "./app.js";
import { BaseApp, Group } from "./base.js";

export class ChatApp extends App {
  baseApp: BaseApp;

  myName: string;

  messages: Record<
    string,
    {
      author: string;
      text: string;
    }[]
  > = {};

  authorNames: Record<string, string> = {};

  constructor(nodeOrApp: Node | BaseApp, name: string) {
    super(nodeOrApp instanceof Node ? nodeOrApp : nodeOrApp.node);
    this.baseApp =
      nodeOrApp instanceof Node ? new BaseApp(nodeOrApp) : nodeOrApp;
    this.myName = name;
  }

  static GUID = "019214cf-55cb-7571-a417-45f895792971";

  mount() {
    this.baseApp.onGroupMessage(
      ChatApp.GUID,
      ChatApp.PLAIN,
      "PLAIN",
      this.PLAIN_HANDLER.bind(this)
    );
    this.baseApp.onGroupMessage(
      ChatApp.GUID,
      ChatApp.WHOIS,
      "WHOIS",
      this.WHOIS_HANDLER.bind(this)
    );
    this.baseApp.onGroupMessage(
      ChatApp.GUID,
      ChatApp.IAM,
      "IAM",
      this.IAM_HANDLER.bind(this)
    );
  }

  unmount() {
    throw new Error("Method not implemented.");
  }

  getRooms() {
    const knownNames = this.baseApp.knownGroups
      .filter((g) => g.interest === ChatApp.GUID)
      .map((g) => g.name);
    const ownNames = this.baseApp.ownGroups
      .filter((g) => g.interest === ChatApp.GUID)
      .map((g) => g.name);

    return Array.from(new Set([...knownNames, ...ownNames]));
  }

  createRoom(password?: string): string {
    const room = v7();
    this.baseApp.createGroup(ChatApp.GUID, room, password ?? "", true);
    return room;
  }

  joinRoom(room: string, password?: string): boolean {
    const group = this.baseApp.knownGroups.find(
      (g) => g.interest === ChatApp.GUID && g.name === room
    );
    if (!group) return false;

    this.baseApp.JOIN_GROUP(
      Array.from(group.announcers.values())[0],
      null,
      null,
      ChatApp.GUID,
      room,
      password ?? ""
    );

    return true;
  }

  static PLAIN = Buffer.from(parse("0191cff5-1f42-70f4-92a9-80b263fdba30"));
  PLAIN(room: string, data: string) {
    this.baseApp.sendToGroup(
      ChatApp.GUID,
      room,
      TaggedFields.from({
        type: ChatApp.PLAIN,
        data: Buffer.from(data),
      })
    );
  }

  PLAIN_HANDLER(origin: Origin, group: Group, fields: TaggedFields) {
    if (!(group.name in this.messages)) {
      this.messages[group.name] = [];
    }
    this.messages[group.name].push({
      author: origin.identity.toReadable(),
      text: fields.get("data")!.toString(),
    });
  }

  static WHOIS = Buffer.from(parse("0192150c-db15-787b-926b-a41f5e809bda"));
  WHOIS(room: string) {
    this.baseApp.sendToGroup(
      ChatApp.GUID,
      room,
      TaggedFields.from({
        type: ChatApp.WHOIS,
      })
    );
  }

  WHOIS_HANDLER(origin: Origin, group: Group, _fields: TaggedFields) {
    this.IAM(group.name);
  }

  static IAM = Buffer.from(parse("01921529-8e6d-7741-8261-c98fe8e548f6"));
  IAM(room: string) {
    this.baseApp.sendToGroup(
      ChatApp.GUID,
      room,
      TaggedFields.from({
        type: ChatApp.IAM,
        name: this.myName,
      })
    );
  }

  IAM_HANDLER(origin: Origin, _group: Group, fields: TaggedFields) {
    this.authorNames[origin.identity.toReadable()] = fields
      .get("name")!
      .toString();
  }
}
