import { bufferToIntBE, intToBufferBE } from "./buffer.js";

const TAG_BYTE_LENGTH = 4;
const SIZE_BYTE_LENGTH = 4;

export class BadTag extends Error {
  constructor() {
    super("Tag needs to be 4 bytes long");
  }
}

export class TaggedFields {
  entries: [Buffer, Buffer][];

  constructor() {
    this.entries = [];
  }

  add(tag: string | Buffer, value: string | Buffer) {
    const bufTag = typeof tag === "string" ? Buffer.from(tag) : tag;
    const bufValue = typeof value === "string" ? Buffer.from(value) : value;

    if (bufTag.byteLength !== TAG_BYTE_LENGTH) {
      throw new BadTag();
    }

    this.entries.push([bufTag, bufValue]);
  }

  set(tag: string | Buffer, value: string | Buffer, i: number = -1) {
    const bufTag = typeof tag === "string" ? Buffer.from(tag) : tag;
    const bufValue = typeof value === "string" ? Buffer.from(value) : value;

    if (bufTag.byteLength !== TAG_BYTE_LENGTH) {
      throw new BadTag();
    }

    const foundIndexes = this.entries
      .map(([t], i) => [t, i] as const)
      .filter(([t]) => t.equals(bufTag))
      .map(([, i]) => i);
    if (foundIndexes.length === 0) return;

    const realIndex = i < 0 ? foundIndexes.length + i : i;
    const foundIndex = foundIndexes[realIndex];

    this.entries[foundIndex] = [bufTag, bufValue];
  }

  clear(tag: string | Buffer) {
    const bufTag = typeof tag === "string" ? Buffer.from(tag) : tag;
    if (bufTag.byteLength !== TAG_BYTE_LENGTH) {
      throw new BadTag();
    }

    this.entries = this.entries.filter(([t]) => !t.equals(bufTag));
  }

  clearAndSet(tag: string | Buffer, value: string | Buffer) {
    this.clear(tag);
    this.add(tag, value);
  }

  getAll(tag: string | Buffer) {
    const bufTag = typeof tag === "string" ? Buffer.from(tag) : tag;
    if (bufTag.byteLength !== TAG_BYTE_LENGTH) {
      throw new BadTag();
    }

    return this.entries.filter(([t]) => t.equals(bufTag)).map(([, v]) => v);
  }

  get(tag: string | Buffer, i: number = -1) {
    const bufTag = typeof tag === "string" ? Buffer.from(tag) : tag;
    if (bufTag.byteLength !== TAG_BYTE_LENGTH) {
      throw new BadTag();
    }

    const foundEntries = this.entries.filter(([t]) => t.equals(bufTag));
    if (foundEntries.length === 0) return;

    const realIndex = i < 0 ? foundEntries.length + i : i;

    return foundEntries[
      Math.max(0, Math.min(foundEntries.length, realIndex))
    ][1];
  }

  serialize() {
    const finalBuffers: Buffer[] = [];
    for (const [bufTag, bufValue] of this.entries) {
      finalBuffers.push(
        bufTag,
        intToBufferBE(bufValue.byteLength, true, SIZE_BYTE_LENGTH),
        bufValue
      );
    }
    return Buffer.concat(finalBuffers);
  }

  tags() {
    const tagSet = new Set<string>();
    const tags: Buffer[] = [];
    for (const [tag] of this.entries) {
      const hexTag = tag.toString("hex");
      if (!tagSet.has(hexTag)) {
        tags.push(tag);
        tagSet.add(hexTag);
      }
    }
    return tags;
  }

  static deserialize(buffer: Buffer) {
    const taggedFields = new TaggedFields();
    let n = 0;
    while (n < buffer.length) {
      const bufTag = buffer.subarray(n, n + TAG_BYTE_LENGTH);
      const valueLength = Number(
        bufferToIntBE(
          buffer.subarray(
            n + TAG_BYTE_LENGTH,
            n + TAG_BYTE_LENGTH + SIZE_BYTE_LENGTH
          ),
          true
        )
      );

      const bufValue = buffer.subarray(
        n + TAG_BYTE_LENGTH + SIZE_BYTE_LENGTH,
        n + TAG_BYTE_LENGTH + SIZE_BYTE_LENGTH + valueLength
      );

      taggedFields.add(bufTag, bufValue);

      n += TAG_BYTE_LENGTH + SIZE_BYTE_LENGTH + valueLength;
    }

    return taggedFields;
  }

  static from(
    value:
      | Map<string | Buffer, string | Buffer | (string | Buffer)[]>
      | Record<string, string | Buffer | (string | Buffer)[]>
      | [string | Buffer, string | Buffer | (string | Buffer)[]][]
  ) {
    const taggedFields = new TaggedFields();
    const iteratable =
      value instanceof Map
        ? value.entries()
        : Array.isArray(value)
        ? value
        : Object.entries(value);

    for (const [t, v] of iteratable) {
      if (Array.isArray(v)) {
        for (const sv of v) {
          taggedFields.add(t, sv);
        }
      } else {
        taggedFields.add(t, v);
      }
    }

    return taggedFields;
  }
}
