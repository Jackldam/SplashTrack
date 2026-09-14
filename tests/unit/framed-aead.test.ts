import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHUNK_SIZE,
  decryptFramed,
  encryptFramed,
  FramedAeadError,
} from "@/lib/crypto/framed-aead";

const key = randomBytes(32);
const aad = Buffer.from("archive-manifest-digest");

describe("framed AEAD (D-102)", () => {
  it("round-trips an empty body", () => {
    const framed = encryptFramed(Buffer.alloc(0), key, aad);
    expect(decryptFramed(framed, key, aad)).toEqual(Buffer.alloc(0));
  });

  it("round-trips a body smaller than one chunk", () => {
    const plaintext = Buffer.from("hello, recovery kit");
    const framed = encryptFramed(plaintext, key, aad);
    expect(decryptFramed(framed, key, aad)).toEqual(plaintext);
  });

  it("round-trips a body spanning several chunks", () => {
    const plaintext = randomBytes(CHUNK_SIZE * 3 + 17);
    const framed = encryptFramed(plaintext, key, aad);
    expect(decryptFramed(framed, key, aad)).toEqual(plaintext);
  });

  it("refuses the wrong key", () => {
    const framed = encryptFramed(Buffer.from("secret"), key, aad);
    expect(() => decryptFramed(framed, randomBytes(32), aad)).toThrow(
      FramedAeadError,
    );
  });

  it("refuses the wrong AAD", () => {
    const framed = encryptFramed(Buffer.from("secret"), key, aad);
    expect(() =>
      decryptFramed(framed, key, Buffer.from("different-digest")),
    ).toThrow(FramedAeadError);
  });

  it("refuses a truncated archive (last chunk removed)", () => {
    const plaintext = randomBytes(CHUNK_SIZE * 2 + 100);
    const framed = encryptFramed(plaintext, key, aad);
    // Drop the final chunk's length+body entirely — simulate a cut-off file.
    const truncated = framed.subarray(0, framed.length - CHUNK_SIZE - 50);
    expect(() => decryptFramed(truncated, key, aad)).toThrow(FramedAeadError);
  });

  it("refuses a spliced-in chunk from a different archive", () => {
    const a = encryptFramed(randomBytes(CHUNK_SIZE + 10), key, aad);
    const b = encryptFramed(randomBytes(CHUNK_SIZE + 10), key, aad);
    // Splice archive B's base nonce + first chunk onto archive A's tail.
    const spliced = Buffer.concat([a.subarray(0, 12), b.subarray(12)]);
    expect(() => decryptFramed(spliced, key, aad)).toThrow(FramedAeadError);
  });

  it("refuses reordered chunks", () => {
    const plaintext = randomBytes(CHUNK_SIZE + 10);
    const framed = encryptFramed(plaintext, key, aad);
    // Parse the two chunk records and swap them.
    const base = framed.subarray(0, 12);
    let offset = 12;
    const records: Buffer[] = [];
    while (offset < framed.length) {
      const len = framed.readUInt32BE(offset);
      records.push(framed.subarray(offset, offset + 4 + len));
      offset += 4 + len;
    }
    expect(records.length).toBe(2);
    const reordered = Buffer.concat([base, records[1], records[0]]);
    expect(() => decryptFramed(reordered, key, aad)).toThrow(FramedAeadError);
  });

  it("refuses bit-flipped ciphertext", () => {
    const framed = encryptFramed(Buffer.from("tamper me"), key, aad);
    const tampered = Buffer.from(framed);
    tampered[tampered.length - 5] ^= 0xff;
    expect(() => decryptFramed(tampered, key, aad)).toThrow(FramedAeadError);
  });
});
