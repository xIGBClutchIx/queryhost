import { describe, expect, it, vi } from "vitest";

import { isPublicAddress, normalizeIpAddress } from "../src/ip.js";
import {
  type DnsAddressRecord,
  type DnsFunctions,
  type DnsResolver,
  type DnsSrvRecord,
  type ResolvedSrvTarget,
  TargetResolutionError,
  createDnsResolver,
  normalizeHostname,
  orderSrvTargets,
  resolveSrvTargets,
  resolveTarget,
  validatePort,
} from "../src/target.js";

function createResolver(
  addresses: readonly DnsAddressRecord[],
  srv: readonly DnsSrvRecord[] = [],
): DnsResolver {
  return {
    resolveAddresses: vi.fn(() => Promise.resolve(addresses)),
    resolveSrv: vi.fn(() => Promise.resolve(srv)),
  };
}

function expectResolutionError(action: () => Promise<object>, code: string): Promise<void> {
  return expect(action()).rejects.toMatchObject({
    name: "TargetResolutionError",
    code,
  });
}

describe("IP address policy", () => {
  it.each([
    ["0.0.0.0", "unspecified"],
    ["0.12.34.56", "current network"],
    ["10.0.0.1", "private"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "link-local and platform metadata"],
    ["172.16.0.1", "private"],
    ["192.0.0.1", "IETF protocol assignment"],
    ["192.0.2.1", "documentation"],
    ["192.31.196.1", "special-purpose AS112 service"],
    ["192.52.193.1", "special-purpose AMT relay"],
    ["192.88.99.1", "deprecated 6to4 relay"],
    ["192.168.0.1", "private"],
    ["192.175.48.1", "special-purpose AS112 delegation"],
    ["198.18.0.1", "benchmarking"],
    ["198.51.100.1", "documentation"],
    ["203.0.113.1", "documentation"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
  ])("rejects IPv4 %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["::8.8.8.8", "IPv4-compatible"],
    ["::ffff:8.8.8.8", "IPv4-mapped"],
    ["64:ff9b::808:808", "well-known NAT64"],
    ["100::1", "discard-only"],
    ["2001::1", "special-purpose"],
    ["2001:2::1", "benchmarking"],
    ["2001:db8::1", "documentation"],
    ["2002:0808:0808::1", "6to4"],
    ["3fff::1", "documentation"],
    ["3ffe::1", "reserved former 6bone"],
    ["2500::1", "unallocated global-unicast gap"],
    ["2620:4f:8000::1", "special-purpose AS112 service"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["fe80::1", "link-local"],
    ["fec0::1", "deprecated site-local"],
    ["ff02::1", "multicast"],
    ["4000::1", "reserved outside global unicast"],
  ])("rejects IPv6 %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2001:4860:4860::8888",
    "2003::1",
    "2606:4700:4700::1111",
    "2620:fe::fe",
  ])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("canonicalizes valid IP literals", () => {
    expect(normalizeIpAddress("192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeIpAddress("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIpAddress("not-an-address")).toBeUndefined();
  });
});

describe("target input normalization", () => {
  it("normalizes case, a terminal root dot, IDNs, and bracketed IPv6", () => {
    expect(normalizeHostname("PLAY.Example.COM.")).toBe("play.example.com");
    expect(normalizeHostname("münich.example")).toBe("xn--mnich-kva.example");
    expect(normalizeHostname("[2606:4700:4700::1111]")).toBe("2606:4700:4700::1111");
  });

  it.each([
    "",
    " play.example.com",
    "play.example.com ",
    ".",
    "play..example.com",
    "-play.example.com",
    "play-.example.com",
    "play_example.com",
    "1234",
    "[2001:db8::1",
    "2001:db8::1]",
    "fe80::1%eth0",
  ])("rejects malformed hostname %j", (hostname) => {
    expect(() => normalizeHostname(hostname)).toThrow(TargetResolutionError);
  });

  it.each([1, 53, 25_565, 65_535])("accepts port %d", (port) => {
    expect(validatePort(port)).toBe(port);
  });

  it.each([0, -1, 1.5, 65_536, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid port %s",
    (port) => {
      expect(() => validatePort(port)).toThrow(TargetResolutionError);
    },
  );
});

describe("safe target resolution", () => {
  it("queries A and AAAA exactly once and combines available answers", async () => {
    const dns: DnsFunctions = {
      resolve4: vi.fn(() => Promise.resolve(["93.184.216.34"])),
      resolve6: vi.fn(() => Promise.reject(new Error("no IPv6 records"))),
      resolveSrv: vi.fn(() => Promise.resolve([])),
    };
    const resolver = createDnsResolver(dns);

    await expect(resolver.resolveAddresses("play.example.com")).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(dns.resolve4).toHaveBeenCalledOnce();
    expect(dns.resolve6).toHaveBeenCalledOnce();
    expect(dns.resolve4).toHaveBeenCalledWith("play.example.com");
    expect(dns.resolve6).toHaveBeenCalledWith("play.example.com");
  });

  it("normalizes, validates, deduplicates, and pins every DNS answer", async () => {
    const records: DnsAddressRecord[] = [
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700:0:0:0:0:1111", family: 6 },
    ];
    const resolver = createResolver(records);

    const target = await resolveTarget({ host: "PLAY.Example.COM.", port: 27_015 }, resolver);
    records[0] = { address: "127.0.0.1", family: 4 };

    expect(target).toEqual({
      hostname: "play.example.com",
      port: 27_015,
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    });
    expect(resolver.resolveAddresses).toHaveBeenCalledOnce();
    expect(resolver.resolveAddresses).toHaveBeenCalledWith("play.example.com");
    expect(Object.isFrozen(target)).toBe(true);
    expect(Object.isFrozen(target.addresses)).toBe(true);
  });

  it("pins public IP literals without invoking DNS", async () => {
    const resolver = createResolver([]);

    await expect(resolveTarget({ host: "1.1.1.1", port: 19132 }, resolver)).resolves.toEqual({
      hostname: "1.1.1.1",
      port: 19_132,
      addresses: [{ address: "1.1.1.1", family: 4 }],
    });
    expect(resolver.resolveAddresses).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "[::1]", "::ffff:8.8.8.8"])(
    "rejects blocked literal target %s without DNS",
    async (host) => {
      const resolver = createResolver([]);

      await expectResolutionError(
        () => resolveTarget({ host, port: 25_565 }, resolver),
        "TARGET_BLOCKED",
      );
      expect(resolver.resolveAddresses).not.toHaveBeenCalled();
    },
  );

  it.each([
    { record: { address: "10.0.0.1", family: 4 } as const, label: "private IPv4" },
    { record: { address: "::1", family: 6 } as const, label: "loopback IPv6" },
    {
      record: { address: "::ffff:8.8.8.8", family: 6 } as const,
      label: "mapped IPv6",
    },
  ])("rejects a resolved $label answer", async ({ record }) => {
    await expectResolutionError(
      () => resolveTarget({ host: "play.example.com", port: 25565 }, createResolver([record])),
      "TARGET_BLOCKED",
    );
  });

  it.each([
    {
      label: "IPv4",
      records: [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ] as const,
    },
    {
      label: "IPv6",
      records: [
        { address: "2606:4700:4700::1111", family: 6 },
        { address: "fd00::1", family: 6 },
      ] as const,
    },
  ])("rejects the whole target when $label answers mix public and private", async ({ records }) => {
    await expectResolutionError(
      () => resolveTarget({ host: "play.example.com", port: 25565 }, createResolver(records)),
      "TARGET_BLOCKED",
    );
  });

  it("rejects empty, malformed, mismatched, failed, and oversized DNS answers", async () => {
    const thrownResolver: DnsResolver = {
      resolveAddresses: vi.fn(() => Promise.reject(new Error("resolver detail"))),
      resolveSrv: vi.fn(() => Promise.resolve([])),
    };
    const tooMany = Array.from<DnsAddressRecord>({ length: 17 }).fill({
      address: "1.1.1.1",
      family: 4,
    });

    await expectResolutionError(
      () => resolveTarget({ host: "play.example.com", port: 25565 }, createResolver([])),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () =>
        resolveTarget(
          { host: "play.example.com", port: 25565 },
          createResolver([{ address: "not-an-ip", family: 4 }]),
        ),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () =>
        resolveTarget(
          { host: "play.example.com", port: 25565 },
          createResolver([{ address: "1.1.1.1", family: 6 }]),
        ),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () => resolveTarget({ host: "play.example.com", port: 25565 }, thrownResolver),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () => resolveTarget({ host: "play.example.com", port: 25565 }, createResolver(tooMany)),
      "TARGET_BLOCKED",
    );
  });

  it("uses stable resolution errors without resolver details", async () => {
    const resolver: DnsResolver = {
      resolveAddresses: () => Promise.reject(new Error("secret resolver implementation")),
      resolveSrv: () => Promise.resolve([]),
    };

    await expect(
      resolveTarget({ host: "play.example.com", port: 25565 }, resolver),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "TargetResolutionError",
        code: "DNS_FAILED",
        message: "The target could not be resolved.",
      }),
    );
  });
});

describe("SRV resolution primitives", () => {
  it("builds the SRV name, validates targets, and resolves each hostname once", async () => {
    const resolver = createResolver(
      [{ address: "93.184.216.34", family: 4 }],
      [
        { name: "NODE.Example.COM.", port: 25_565, priority: 10, weight: 20 },
        { name: "node.example.com", port: 25_566, priority: 10, weight: 10 },
      ],
    );

    const targets = await resolveSrvTargets(
      { service: "minecraft", protocol: "tcp", host: "PLAY.Example.COM." },
      resolver,
    );

    expect(resolver.resolveSrv).toHaveBeenCalledWith("_minecraft._tcp.play.example.com");
    expect(resolver.resolveAddresses).toHaveBeenCalledOnce();
    expect(resolver.resolveAddresses).toHaveBeenCalledWith("node.example.com");
    expect(targets).toEqual([
      {
        priority: 10,
        weight: 20,
        target: {
          hostname: "node.example.com",
          port: 25_565,
          addresses: [{ address: "93.184.216.34", family: 4 }],
        },
      },
      {
        priority: 10,
        weight: 10,
        target: {
          hostname: "node.example.com",
          port: 25_566,
          addresses: [{ address: "93.184.216.34", family: 4 }],
        },
      },
    ]);
    expect(Object.isFrozen(targets)).toBe(true);
  });

  it("represents an explicit unavailable service as no targets", async () => {
    const resolver = createResolver([], [{ name: ".", port: 0, priority: 0, weight: 0 }]);

    await expect(
      resolveSrvTargets(
        { service: "minecraft", protocol: "tcp", host: "play.example.com" },
        resolver,
      ),
    ).resolves.toEqual([]);
    expect(resolver.resolveAddresses).not.toHaveBeenCalled();
  });

  it("reapplies address policy to SRV-derived targets", async () => {
    const resolver = createResolver(
      [{ address: "192.168.1.10", family: 4 }],
      [{ name: "internal.example.com", port: 25_565, priority: 0, weight: 0 }],
    );

    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          resolver,
        ),
      "TARGET_BLOCKED",
    );
  });

  it("treats no records as optional discovery absence", async () => {
    const resolver = createResolver([{ address: "1.1.1.1", family: 4 }], []);
    await expect(
      resolveSrvTargets(
        { service: "minecraft", protocol: "tcp", host: "play.example.com" },
        resolver,
      ),
    ).resolves.toEqual([]);
    expect(resolver.resolveAddresses).not.toHaveBeenCalled();
  });

  it("rejects mixed-dot, oversized, and invalid SRV responses", async () => {
    const address = { address: "1.1.1.1", family: 4 } as const;
    const valid = { name: "node.example.com", port: 25_565, priority: 0, weight: 0 };
    const oversized = Array.from<DnsSrvRecord>({ length: 17 }).fill(valid);

    for (const records of [[valid, { name: ".", port: 0, priority: 0, weight: 0 }]]) {
      await expectResolutionError(
        () =>
          resolveSrvTargets(
            { service: "minecraft", protocol: "tcp", host: "play.example.com" },
            createResolver([address], records),
          ),
        "DNS_FAILED",
      );
    }
    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          createResolver([address], oversized),
        ),
      "TARGET_BLOCKED",
    );
    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          createResolver([address], [{ ...valid, priority: -1 }]),
        ),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          createResolver([address], [{ ...valid, name: "bad_target.example.com" }]),
        ),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          createResolver([address], [{ ...valid, weight: 65_536 }]),
        ),
      "DNS_FAILED",
    );
    await expectResolutionError(
      () =>
        resolveSrvTargets(
          { service: "minecraft", protocol: "tcp", host: "play.example.com" },
          createResolver([address], [{ ...valid, port: 0 }]),
        ),
      "DNS_FAILED",
    );
  });

  it("orders priority groups and weights under a deterministic random source", () => {
    const target = (host: string, priority: number, weight: number): ResolvedSrvTarget => ({
      priority,
      weight,
      target: {
        hostname: host,
        port: 25_565,
        addresses: [{ address: "1.1.1.1", family: 4 }],
      },
    });
    const records = [
      target("backup.example.com", 20, 100),
      target("zero.example.com", 10, 0),
      target("light.example.com", 10, 1),
      target("heavy.example.com", 10, 3),
    ];
    const values = [0.9, 0, 0, 0];
    let index = 0;
    const ordered = orderSrvTargets(records, (): number => {
      const value = values[index];
      index += 1;
      return value ?? 0;
    });

    expect(ordered.map((record) => record.target.hostname)).toEqual([
      "heavy.example.com",
      "zero.example.com",
      "light.example.com",
      "backup.example.com",
    ]);
  });

  it("rejects an invalid deterministic random value", () => {
    const records: readonly ResolvedSrvTarget[] = [
      {
        priority: 0,
        weight: 1,
        target: {
          hostname: "node.example.com",
          port: 25_565,
          addresses: [{ address: "1.1.1.1", family: 4 }],
        },
      },
    ];
    expect(() => orderSrvTargets(records, (): number => 1)).toThrow(
      expect.objectContaining({ code: "DNS_FAILED" }),
    );
  });
});
