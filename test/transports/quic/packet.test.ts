import { describe, expect, it } from "vitest";

import { initialProtection, retryIntegrityTag } from "../../../src/transports/quic/crypto.js";
import { QuicTransportError } from "../../../src/transports/quic/errors.js";
import {
  decodePacketNumber,
  openPacket,
  protectLongPacket,
  splitDatagram,
} from "../../../src/transports/quic/packet.js";
import { encodeVarint, WireReader } from "../../../src/transports/quic/wire.js";

function hex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value.replaceAll(/\s+/gu, ""), "hex"));
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

/** RFC 9001 appendix A: the client's chosen Destination Connection ID. */
const CLIENT_DCID = hex("8394c8f03e515708");

/** RFC 9001 appendix A.2: the client Initial's CRYPTO frame before padding to 1,162 bytes. */
const CLIENT_CRYPTO_FRAME = hex(`
  060040f1010000ed0303ebf8fa56f12939b9584a3896472ec40bb863cfd3e868
  04fe3a47f06a2b69484c000004130113 02010000c000000010000e00000b6578
  616d706c652e636f6dff01000100000a00080006001d00170018001000070005
  04616c706e000500050100000000003300260024001d00209370b2c9caa47fba
  baf4559fedba753de171fa71f50f1ce15d43e994ec74d748002b000302030400
  0d0010000e0403050306030203080408050806002d00020101001c0002400100
  3900320408ffffffffffffffff05048000ffff07048000ffff08011001048000
  75300901100f088394c8f03e51570806048000ffff`);

/** First 64 bytes of RFC 9001 appendix A.2's protected client Initial (1,200 bytes in total). */
const CLIENT_INITIAL_PREFIX =
  "c000000001088394c8f03e5157080000449e7b9aec34d1b1c98dd7689fb8ec11" +
  "d242b123dc9bd8bab936b47d92ec356c0bab7df5976d27cd449f63300099f399";
const CLIENT_INITIAL_SUFFIX = "e221af44860018ab0856972e194cd934";

/** RFC 9001 appendix A.3: the server's protected Initial and its decrypted payload. */
const SERVER_INITIAL = hex(`
  cf000000010008f067a5502a4262b5004075c0d95a482cd0991cd25b0aac406a
  5816b6394100f37a1c69797554780bb38cc5a99f5ede4cf73c3ec2493a1839b3
  dbcba3f6ea46c5b7684df3548e7ddeb9c3bf9c73cc3f3bded74b562bfb19fb84
  022f8ef4cdd93795d77d06edbb7aaf2f58891850abbdca3d20398c276456cbc4
  2158407dd074ee`);
const SERVER_INITIAL_PAYLOAD = hex(`
  02000000000600405a020000560303eefce7f7b37ba1d1632e96677825ddf739
  88cfc79825df566dc5430b9a045a1200130100002e00330024001d00209d3c94
  0d89690b84d08a60993c144eca684d1081287c834d5311bcf32bb9da1a002b00
  020304`);

/** RFC 9001 appendix A.4: a Retry answering the client Initial above. */
const RETRY = hex("ff000000010008f067a5502a4262b5746f6b656e04a265ba2eff4d829058fb3f0f2496ba");

describe("QUIC packet protection", (): void => {
  it("derives the RFC 9001 Initial keys", (): void => {
    const keys = initialProtection(CLIENT_DCID);
    expect(toHex(keys.client.key)).toBe("1f369613dd76d5467730efcbe3b1a22d");
    expect(toHex(keys.client.iv)).toBe("fa044b2f42a3fd3b46fb255c");
    expect(toHex(keys.client.hp)).toBe("9f50449e04a0e810283a1e9933adedd2");
    expect(toHex(keys.server.key)).toBe("cf3a5331653c364c88f0f379b6067e37");
    expect(toHex(keys.server.iv)).toBe("0ac1493ca1905853b0bba03e");
    expect(toHex(keys.server.hp)).toBe("c206b8d9b9f0f37644430b490eeaa314");
  });

  it("protects the RFC 9001 client Initial byte for byte", (): void => {
    const payload = new Uint8Array(1_162);
    payload.set(CLIENT_CRYPTO_FRAME);
    const packet = protectLongPacket({
      type: "initial",
      destination: CLIENT_DCID,
      source: new Uint8Array(0),
      packetNumber: 2,
      payload,
      keys: initialProtection(CLIENT_DCID).client,
    });

    expect(packet.byteLength).toBe(1_200);
    expect(toHex(packet.subarray(0, 64))).toBe(CLIENT_INITIAL_PREFIX);
    expect(toHex(packet.subarray(packet.byteLength - 16))).toBe(CLIENT_INITIAL_SUFFIX);
  });

  it("opens the RFC 9001 server Initial", (): void => {
    const [packet] = splitDatagram(SERVER_INITIAL, 0);
    if (packet?.kind !== "protected") {
      throw new Error("Expected a protected packet.");
    }
    expect(packet.space).toBe("initial");
    expect(toHex(packet.source ?? new Uint8Array(0))).toBe("f067a5502a4262b5");

    const opened = openPacket(packet, initialProtection(CLIENT_DCID).server, -1);
    expect(opened?.packetNumber).toBe(1);
    expect(toHex(opened?.payload ?? new Uint8Array(0))).toBe(toHex(SERVER_INITIAL_PAYLOAD));
  });

  it("drops a packet that fails authentication instead of failing the connection", (): void => {
    const tampered = Uint8Array.from(SERVER_INITIAL);
    tampered[tampered.byteLength - 1] = (tampered[tampered.byteLength - 1] ?? 0) ^ 0x01;
    const [packet] = splitDatagram(tampered, 0);
    if (packet?.kind !== "protected") {
      throw new Error("Expected a protected packet.");
    }
    expect(openPacket(packet, initialProtection(CLIENT_DCID).server, -1)).toBeUndefined();
    expect(
      openPacket(packet, initialProtection(hex("0011223344556677")).server, -1),
    ).toBeUndefined();
  });

  it("verifies the RFC 9001 Retry integrity tag", (): void => {
    const [packet] = splitDatagram(RETRY, 8);
    if (packet?.kind !== "retry") {
      throw new Error("Expected a Retry packet.");
    }
    expect(new TextDecoder().decode(packet.token)).toBe("token");
    expect(toHex(packet.source)).toBe("f067a5502a4262b5");
    expect(toHex(retryIntegrityTag(CLIENT_DCID, packet.withoutTag))).toBe(toHex(packet.tag));
  });

  it("splits coalesced long-header packets and stops at an unreadable one", (): void => {
    const coalesced = new Uint8Array([...SERVER_INITIAL, ...SERVER_INITIAL, 0xc0, 0x00]);
    const packets = splitDatagram(coalesced, 0);
    expect(packets).toHaveLength(2);
    expect(packets.every((packet) => packet.kind === "protected")).toBe(true);
  });

  it("reads Version Negotiation and ignores unknown versions", (): void => {
    const negotiation = hex("8000000000080102030405060708 08f067a5502a4262b5 ff00001d 0a0a0a0a");
    expect(splitDatagram(negotiation, 8)).toEqual([
      {
        kind: "version-negotiation",
        destination: hex("0102030405060708"),
        source: hex("f067a5502a4262b5"),
        versions: [0xff00_001d, 0x0a0a_0a0a],
      },
    ]);
    expect(splitDatagram(hex("c0ff00001d08010203040506070800"), 8)).toEqual([]);
  });

  it("decodes truncated packet numbers (RFC 9000 appendix A.3)", (): void => {
    expect(decodePacketNumber(0xa82f30ea, 0x9b32, 2)).toBe(0xa82f9b32);
    expect(decodePacketNumber(-1, 0, 1)).toBe(0);
    expect(decodePacketNumber(255, 0, 1)).toBe(256);
  });
});

describe("QUIC varints", (): void => {
  it.each([0, 63, 64, 16_383, 16_384, 1_073_741_823, 1_073_741_824, Number.MAX_SAFE_INTEGER])(
    "round-trips %d with a minimal encoding",
    (value): void => {
      const encoded = encodeVarint(value);
      expect(new WireReader(encoded).varint()).toBe(value);
      expect(encoded.byteLength).toBe(
        value < 64 ? 1 : value < 16_384 ? 2 : value < 2 ** 30 ? 4 : 8,
      );
    },
  );

  it("reports values beyond 2^53 as unknown and rejects truncation", (): void => {
    const grease = hex("ffffffffffffffff");
    expect(new WireReader(grease).varintOrUnknown()).toBeUndefined();
    expect(() => new WireReader(grease).varint()).toThrow(QuicTransportError);
    expect(() => new WireReader(hex("40")).varint()).toThrow(QuicTransportError);
  });
});
