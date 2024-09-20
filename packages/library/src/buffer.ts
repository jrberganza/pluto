export function intToBufferBE(
  num: number | bigint,
  unsigned: boolean,
  bytes: number
) {
  if (bytes < 0 || bytes > 8) throw new Error("Invalid byte size");
  if (bytes === 7) throw new Error("Invalid byte size");

  const buf = Buffer.alloc(bytes);
  if (bytes === 8) {
    if (unsigned) buf.writeBigUInt64BE(BigInt(num));
    else buf.writeBigInt64BE(BigInt(num));
  } else {
    if (unsigned) buf.writeUIntBE(Number(num), 0, bytes);
    else buf.writeIntBE(Number(num), 0, bytes);
  }
  return buf;
}

export function bufferToIntBE(buf: Buffer, unsigned: boolean) {
  if (buf.byteLength < 0 || buf.byteLength > 8)
    throw new Error("Invalid byte size");
  if (buf.byteLength === 7) throw new Error("Invalid byte size");

  return buf.byteLength === 8
    ? unsigned
      ? buf.readBigUint64BE()
      : buf.readBigInt64BE()
    : unsigned
    ? buf.readUIntBE(0, buf.byteLength)
    : buf.readIntBE(0, buf.byteLength);
}
