import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";

export class MissingPrivateKey extends Error {
  constructor() {
    super("Identity has no private key");
  }
}

export class UnsupportedKeyType extends Error {
  constructor(type?: string) {
    super(`Unsupported key type loaded: ${type ?? "uknown"}`);
  }
}

export class Identity {
  algorithm: "rsa" | "ed25519";
  publicKey: KeyObject;
  privateKey: KeyObject | null;

  constructor(opts: {
    algorithm: "rsa" | "ed25519";
    publicKey: KeyObject;
    privateKey: KeyObject | null;
  }) {
    this.algorithm = opts.algorithm;
    this.publicKey = opts.publicKey;
    this.privateKey = opts.privateKey ?? null;
  }

  static load(path: string) {
    const privateKeyData = existsSync(path) ? readFileSync(path) : null;
    const privateKey = privateKeyData ? createPrivateKey(privateKeyData) : null;
    const publicKeyData = existsSync(path + ".pub")
      ? readFileSync(path + ".pub")
      : null;
    const publicKey = privateKey
      ? createPublicKey(privateKey)
      : publicKeyData
      ? createPublicKey(publicKeyData)
      : null;
    if (!publicKey) {
      throw new Error("No valid key found");
    }

    const algorithm = publicKey.asymmetricKeyType;
    if (algorithm !== "rsa" && algorithm !== "ed25519") {
      throw new UnsupportedKeyType(algorithm);
    }
    return new Identity({ algorithm: algorithm, publicKey, privateKey });
  }

  static generate(opts?: { algorithm?: "rsa" | "ed25519" }) {
    const algorithm = opts?.algorithm ?? "ed25519";
    const { privateKey: privateKeyRaw } =
      algorithm === "ed25519"
        ? generateKeyPairSync("ed25519", {
            privateKeyEncoding: { format: "pem", type: "pkcs8" },
            publicKeyEncoding: { format: "pem", type: "spki" },
          })
        : generateKeyPairSync("rsa", {
            modulusLength: 4096,
            privateKeyEncoding: { format: "pem", type: "pkcs8" },
            publicKeyEncoding: { format: "pem", type: "spki" },
          });

    const privateKey = createPrivateKey(privateKeyRaw);
    const publicKey = createPublicKey(privateKey);

    return new Identity({
      algorithm,
      publicKey,
      privateKey,
    });
  }

  static loadOrGenSave(path: string, opts?: { algorithm?: "rsa" | "ed25519" }) {
    if (existsSync(path)) {
      return Identity.load(path);
    } else {
      const identity = Identity.generate(opts);
      identity.save(path);
      return identity;
    }
  }

  sign(message: Buffer) {
    if (this.privateKey === null) {
      throw new MissingPrivateKey();
    }

    const signature = sign(null, message, this.privateKey);

    return signature;
  }

  verify(message: Buffer, signature: Buffer) {
    return verify(null, message, this.publicKey, signature);
  }

  save(path: string) {
    if (this.privateKey !== null) {
      writeFileSync(
        path,
        this.privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 }
      );
    }
    writeFileSync(
      path + ".pub",
      this.publicKey.export({ format: "pem", type: "spki" }),
      { mode: 0o644 }
    );
  }

  toReadable() {
    return (
      this.algorithm +
      "." +
      this.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64url")
    );
  }

  static fromReadable(value: string) {
    const periodIndex = value.indexOf(".");
    const algorithm = value.slice(0, periodIndex);
    if (algorithm !== "rsa" && algorithm !== "ed25519")
      throw new UnsupportedKeyType(algorithm);
    const rawKey = Buffer.from(value.slice(periodIndex + 1), "base64url");
    return new Identity({
      algorithm,
      publicKey: createPublicKey({ key: rawKey, format: "der", type: "spki" }),
      privateKey: null,
    });
  }
}
