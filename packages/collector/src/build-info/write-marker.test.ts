import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseBuildMarker } from "./build-marker.js";
import { writeBuildMarker, type WriteBuildMarkerDeps } from "./write-marker.js";

function fakeDeps(
  overrides: Partial<WriteBuildMarkerDeps> = {},
): WriteBuildMarkerDeps & {
  writtenFiles: Map<string, string>;
  ensuredDirs: string[];
  gitCalls: string[][];
} {
  const writtenFiles = new Map<string, string>();
  const ensuredDirs: string[] = [];
  const gitCalls: string[][] = [];

  const deps: WriteBuildMarkerDeps = {
    collectorDir: "/repo/packages/collector",
    runGit: vi.fn((args: string[]) => {
      gitCalls.push(args);
      if (args[0] === "rev-parse") return "abc123\n";
      if (args[0] === "status") return "";
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    }),
    ensureDir: vi.fn((dir: string) => {
      ensuredDirs.push(dir);
    }),
    writeFile: vi.fn((filePath: string, content: string) => {
      writtenFiles.set(filePath, content);
    }),
    ...overrides,
  };

  return Object.assign(deps, { writtenFiles, ensuredDirs, gitCalls });
}

describe("writeBuildMarker", () => {
  it("dist/.build-commit へ commit hash と clean 状態を書き込む", () => {
    const deps = fakeDeps();

    const markerPath = writeBuildMarker(deps);

    expect(markerPath).toBe(
      path.join("/repo/packages/collector", "dist", ".build-commit"),
    );
    expect(deps.ensuredDirs).toEqual([
      path.join("/repo/packages/collector", "dist"),
    ]);
    const content = deps.writtenFiles.get(markerPath);
    expect(content).toBeDefined();
    expect(parseBuildMarker(content!)).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("git status --porcelain が何か出力していれば dirty: true として書き込む", () => {
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        if (args[0] === "rev-parse") return "def456\n";
        if (args[0] === "status") return " M src/index.ts\n";
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      }),
    });

    const markerPath = writeBuildMarker(deps);

    const content = deps.writtenFiles.get(markerPath);
    expect(parseBuildMarker(content!)).toEqual({
      commitHash: "def456",
      dirty: true,
    });
  });

  it("commit hash の前後の空白・改行を取り除く", () => {
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        if (args[0] === "rev-parse") return "  abc123  \n";
        if (args[0] === "status") return "";
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      }),
    });

    const markerPath = writeBuildMarker(deps);

    expect(parseBuildMarker(deps.writtenFiles.get(markerPath)!)).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("git コマンドが失敗したら例外を伝播する(握りつぶさない)", () => {
    const deps = fakeDeps({
      runGit: vi.fn(() => {
        throw new Error("fatal: not a git repository");
      }),
    });

    expect(() => writeBuildMarker(deps)).toThrow(
      /not a git repository/,
    );
    expect(deps.writtenFiles.size).toBe(0);
  });

  it("git status が空白のみ(改行・スペース)を返しても clean 扱いにする", () => {
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        if (args[0] === "rev-parse") return "abc123\n";
        if (args[0] === "status") return "   \n  \n";
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      }),
    });

    const markerPath = writeBuildMarker(deps);

    expect(parseBuildMarker(deps.writtenFiles.get(markerPath)!)).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("rev-parse → status の順に git を呼び、ensureDir は writeFile より前に呼ぶ", () => {
    const order: string[] = [];
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        order.push(`git:${args[0]}`);
        if (args[0] === "rev-parse") return "abc123\n";
        if (args[0] === "status") return "";
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      }),
      ensureDir: vi.fn(() => {
        order.push("ensureDir");
      }),
      writeFile: vi.fn(() => {
        order.push("writeFile");
      }),
    });

    writeBuildMarker(deps);

    expect(order).toEqual([
      "git:rev-parse",
      "git:status",
      "ensureDir",
      "writeFile",
    ]);
  });

  it("rev-parse は成功するが status が失敗した場合も例外を伝播し書き込まない", () => {
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        if (args[0] === "rev-parse") return "abc123\n";
        throw new Error("git status exploded");
      }),
    });

    expect(() => writeBuildMarker(deps)).toThrow(/git status exploded/);
    expect(deps.writtenFiles.size).toBe(0);
    // dist ディレクトリ作成(ensureDir)は書き込み直前なので、status 失敗時点
    // では呼ばれていないことも確認する(副作用を残さない)。
    expect(deps.ensuredDirs).toEqual([]);
  });

  it("rev-parse が空文字列を返すと壊れたマーカー(parse で null)が書かれる境界", () => {
    // 実際の git rev-parse HEAD が空を返すことは通常ないが、万一空になっても
    // writeBuildMarker は検証せずそのまま書き込む。その内容は
    // parseBuildMarker で null になり、dev-up.sh 側が「中身が壊れている」と
    // 警告できるため診断能力は保たれる(この挙動を固定する回帰テスト)。
    const deps = fakeDeps({
      runGit: vi.fn((args: string[]) => {
        if (args[0] === "rev-parse") return "\n";
        if (args[0] === "status") return "";
        throw new Error(`unexpected git args: ${args.join(" ")}`);
      }),
    });

    const markerPath = writeBuildMarker(deps);

    const content = deps.writtenFiles.get(markerPath)!;
    expect(content).toBe("\nclean\n");
    expect(parseBuildMarker(content)).toBeNull();
  });

  it("collectorDir が異なれば書き込み先パスもそれに追従する", () => {
    const deps = fakeDeps({ collectorDir: "/other/pkg/collector" });

    const markerPath = writeBuildMarker(deps);

    expect(markerPath).toBe(
      path.join("/other/pkg/collector", "dist", ".build-commit"),
    );
    expect(deps.ensuredDirs).toEqual([
      path.join("/other/pkg/collector", "dist"),
    ]);
  });
});
