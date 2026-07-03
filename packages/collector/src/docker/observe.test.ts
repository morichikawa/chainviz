import { describe, expect, it } from "vitest";
import {
  computeCpuPercent,
  computeMemMB,
  computeStableId,
  extractIp,
  extractName,
  extractPorts,
  normalizeName,
  parseTopProcesses,
  processName,
} from "./observe.js";
import type {
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "./types.js";

function summary(
  overrides: Partial<DockerContainerSummary> = {},
): DockerContainerSummary {
  return {
    Id: "abc123",
    Names: ["/chainviz-ethereum-reth1-1"],
    Image: "ghcr.io/paradigmxyz/reth:latest",
    State: "running",
    ...overrides,
  };
}

describe("normalizeName", () => {
  it("strips a leading slash", () => {
    expect(normalizeName("/reth1")).toBe("reth1");
  });
  it("returns empty string for undefined", () => {
    expect(normalizeName(undefined)).toBe("");
  });
  it("leaves names without a slash untouched", () => {
    expect(normalizeName("reth1")).toBe("reth1");
  });
});

describe("computeStableId", () => {
  it("prefers docker compose project/service labels", () => {
    const id = computeStableId(
      summary({
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "reth1",
        },
      }),
    );
    expect(id).toBe("chainviz-ethereum/reth1");
  });

  it("falls back to the container name when labels are absent", () => {
    const id = computeStableId(summary({ Labels: {} }));
    expect(id).toBe("chainviz-ethereum-reth1-1");
  });

  it("falls back to the container id when name and labels are absent", () => {
    const id = computeStableId(summary({ Names: [], Labels: undefined }));
    expect(id).toBe("abc123");
  });

  it("does not use project/service when only one is present", () => {
    const id = computeStableId(
      summary({
        Names: ["/only-project"],
        Labels: { "com.docker.compose.project": "chainviz-ethereum" },
      }),
    );
    expect(id).toBe("only-project");
  });

  it("ignores empty-string labels and falls back to the name", () => {
    const id = computeStableId(
      summary({
        Labels: {
          "com.docker.compose.project": "",
          "com.docker.compose.service": "",
        },
      }),
    );
    expect(id).toBe("chainviz-ethereum-reth1-1");
  });

  it("falls back to the container id when name is an empty string", () => {
    const id = computeStableId(summary({ Names: [""], Labels: {} }));
    expect(id).toBe("abc123");
  });
});

describe("extractName", () => {
  it("uses the first name with the slash removed", () => {
    expect(extractName(summary())).toBe("chainviz-ethereum-reth1-1");
  });
});

describe("extractIp", () => {
  it("returns the first non-empty network IP", () => {
    const ip = extractIp(
      summary({
        NetworkSettings: {
          Networks: {
            bridge: { IPAddress: "" },
            chain: { IPAddress: "172.28.1.1" },
          },
        },
      }),
    );
    expect(ip).toBe("172.28.1.1");
  });

  it("returns empty string when no network info exists", () => {
    expect(extractIp(summary({ NetworkSettings: undefined }))).toBe("");
  });

  it("skips networks whose IP address is empty and picks the next", () => {
    const ip = extractIp(
      summary({
        NetworkSettings: {
          Networks: {
            a: { IPAddress: "" },
            b: { IPAddress: undefined },
            c: { IPAddress: "10.0.0.5" },
          },
        },
      }),
    );
    expect(ip).toBe("10.0.0.5");
  });

  it("returns empty string when every network IP is empty", () => {
    const ip = extractIp(
      summary({
        NetworkSettings: { Networks: { a: { IPAddress: "" } } },
      }),
    );
    expect(ip).toBe("");
  });

  it("returns empty string when the Networks map is empty", () => {
    expect(extractIp(summary({ NetworkSettings: { Networks: {} } }))).toBe("");
  });
});

describe("extractPorts", () => {
  it("prefers public ports and returns them sorted and de-duplicated", () => {
    const ports = extractPorts(
      summary({
        Ports: [
          { PrivatePort: 8545, PublicPort: 8545, Type: "tcp" },
          { PrivatePort: 30303, Type: "tcp" },
          { PrivatePort: 8545, PublicPort: 8545, Type: "udp" },
        ],
      }),
    );
    expect(ports).toEqual([8545, 30303]);
  });

  it("returns an empty array when there are no ports", () => {
    expect(extractPorts(summary({ Ports: [] }))).toEqual([]);
  });

  it("returns an empty array when the Ports field is absent", () => {
    expect(extractPorts(summary({ Ports: undefined }))).toEqual([]);
  });

  it("uses the private port when no public port is exposed", () => {
    const ports = extractPorts(
      summary({ Ports: [{ PrivatePort: 30303, Type: "tcp" }] }),
    );
    expect(ports).toEqual([30303]);
  });

  it("de-duplicates the same private port shared across bound entries", () => {
    const ports = extractPorts(
      summary({
        Ports: [
          { PrivatePort: 8545, PublicPort: 9000, Type: "tcp" },
          { PrivatePort: 8545, PublicPort: 9000, Type: "udp" },
        ],
      }),
    );
    expect(ports).toEqual([9000]);
  });
});

describe("processName", () => {
  it("extracts the binary basename from a command", () => {
    expect(processName("/usr/local/bin/reth node --chain dev")).toBe("reth");
  });
  it("handles a bare command name", () => {
    expect(processName("lighthouse bn")).toBe("lighthouse");
  });
  it("returns empty string for an empty command", () => {
    expect(processName("")).toBe("");
  });
  it("trims surrounding whitespace before extracting the basename", () => {
    expect(processName("   /usr/bin/reth node  ")).toBe("reth");
  });
  it("returns empty string for a whitespace-only command", () => {
    expect(processName("   ")).toBe("");
  });
});

describe("parseTopProcesses", () => {
  it("uses the CMD column when present", () => {
    const top: DockerTopResult = {
      Titles: ["UID", "PID", "CMD"],
      Processes: [
        ["root", "1", "/usr/local/bin/reth node"],
        ["root", "42", "sh -c sleep infinity"],
      ],
    };
    expect(parseTopProcesses(top)).toEqual([
      { command: "/usr/local/bin/reth node", name: "reth" },
      { command: "sh -c sleep infinity", name: "sh" },
    ]);
  });

  it("falls back to the COMMAND column", () => {
    const top: DockerTopResult = {
      Titles: ["PID", "COMMAND"],
      Processes: [["1", "lighthouse bn"]],
    };
    expect(parseTopProcesses(top)).toEqual([
      { command: "lighthouse bn", name: "lighthouse" },
    ]);
  });

  it("uses the last column when neither CMD nor COMMAND exists", () => {
    const top: DockerTopResult = {
      Titles: ["PID", "TTY", "TIME", "ARGS"],
      Processes: [["1", "?", "00:00:01", "anvil"]],
    };
    expect(parseTopProcesses(top)).toEqual([
      { command: "anvil", name: "anvil" },
    ]);
  });

  it("returns an empty array when there are no processes", () => {
    expect(parseTopProcesses({ Titles: ["CMD"], Processes: [] })).toEqual([]);
  });

  it("uses the first column when Titles are missing entirely", () => {
    const top = {
      Processes: [["reth node", "extra"]],
    } as unknown as DockerTopResult;
    expect(parseTopProcesses(top)).toEqual([
      { command: "reth node", name: "reth" },
    ]);
  });

  it("returns an empty array when Processes are missing entirely", () => {
    const top = { Titles: ["CMD"] } as unknown as DockerTopResult;
    expect(parseTopProcesses(top)).toEqual([]);
  });

  it("yields empty command/name for rows shorter than the CMD column", () => {
    const top: DockerTopResult = {
      Titles: ["UID", "PID", "CMD"],
      Processes: [["root"]],
    };
    expect(parseTopProcesses(top)).toEqual([{ command: "", name: "" }]);
  });

  it("prefers CMD over COMMAND when both columns exist", () => {
    const top: DockerTopResult = {
      Titles: ["COMMAND", "CMD"],
      Processes: [["wrapper.sh", "/usr/bin/reth node"]],
    };
    expect(parseTopProcesses(top)).toEqual([
      { command: "/usr/bin/reth node", name: "reth" },
    ]);
  });
});

function stats(overrides: {
  total: number;
  preTotal: number;
  system: number;
  preSystem: number;
  onlineCpus?: number;
  memUsage?: number;
  memCache?: number;
}): DockerStatsResult {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: overrides.total },
      system_cpu_usage: overrides.system,
      online_cpus: overrides.onlineCpus,
    },
    precpu_stats: {
      cpu_usage: { total_usage: overrides.preTotal },
      system_cpu_usage: overrides.preSystem,
    },
    memory_stats: {
      usage: overrides.memUsage,
      stats: { cache: overrides.memCache },
    },
  };
}

describe("computeCpuPercent", () => {
  it("applies the standard docker formula", () => {
    // cpuDelta=100, systemDelta=1000, 4 cpus -> 0.1 * 4 * 100 = 40
    const percent = computeCpuPercent(
      stats({
        total: 200,
        preTotal: 100,
        system: 2000,
        preSystem: 1000,
        onlineCpus: 4,
      }),
    );
    expect(percent).toBe(40);
  });

  it("returns 0 when the system delta is not positive", () => {
    const percent = computeCpuPercent(
      stats({ total: 200, preTotal: 100, system: 1000, preSystem: 1000 }),
    );
    expect(percent).toBe(0);
  });

  it("returns 0 when the cpu delta is not positive", () => {
    const percent = computeCpuPercent(
      stats({ total: 100, preTotal: 100, system: 2000, preSystem: 1000 }),
    );
    expect(percent).toBe(0);
  });

  it("defaults to a single cpu when online_cpus is missing", () => {
    // cpuDelta=500, systemDelta=1000 -> 0.5 * 1 * 100 = 50
    const percent = computeCpuPercent(
      stats({ total: 600, preTotal: 100, system: 2000, preSystem: 1000 }),
    );
    expect(percent).toBe(50);
  });

  it("returns 0 when online_cpus is explicitly 0", () => {
    const percent = computeCpuPercent(
      stats({
        total: 600,
        preTotal: 100,
        system: 2000,
        preSystem: 1000,
        onlineCpus: 0,
      }),
    );
    expect(percent).toBe(0);
  });

  it("treats a missing precpu block as a zero baseline", () => {
    const raw: DockerStatsResult = {
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 1,
      },
      // precpu_stats without cpu_usage/system_cpu_usage
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: {},
    };
    // systemDelta = 1000 - 0 = 1000, cpuDelta = 100 - 0 = 100 -> 10%
    expect(computeCpuPercent(raw)).toBe(10);
  });

  it("rounds the result to two decimal places", () => {
    // cpuDelta=1, systemDelta=3, 1 cpu -> 33.333...% -> 33.33
    const percent = computeCpuPercent(
      stats({ total: 1, preTotal: 0, system: 3, preSystem: 0, onlineCpus: 1 }),
    );
    expect(percent).toBe(33.33);
  });
});

describe("computeMemMB", () => {
  it("subtracts cache from usage and converts to MB", () => {
    const mem = computeMemMB(
      stats({
        total: 0,
        preTotal: 0,
        system: 0,
        preSystem: 0,
        memUsage: 200 * 1024 * 1024,
        memCache: 50 * 1024 * 1024,
      }),
    );
    expect(mem).toBe(150);
  });

  it("returns 0 when usage data is missing", () => {
    const mem = computeMemMB(
      stats({ total: 0, preTotal: 0, system: 0, preSystem: 0 }),
    );
    expect(mem).toBe(0);
  });

  it("never returns a negative value", () => {
    const mem = computeMemMB(
      stats({
        total: 0,
        preTotal: 0,
        system: 0,
        preSystem: 0,
        memUsage: 10,
        memCache: 1024 * 1024 * 1024,
      }),
    );
    expect(mem).toBe(0);
  });

  it("treats a missing cache figure as zero", () => {
    const raw: DockerStatsResult = {
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: { usage: 64 * 1024 * 1024 },
    };
    expect(computeMemMB(raw)).toBe(64);
  });

  it("returns 0 when the memory_stats block is empty", () => {
    const raw: DockerStatsResult = {
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: {},
    };
    expect(computeMemMB(raw)).toBe(0);
  });
});
