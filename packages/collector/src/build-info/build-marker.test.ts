import { describe, expect, it } from "vitest";
import {
  BUILD_MARKER_FILENAME,
  formatBuildMarker,
  parseBuildMarker,
} from "./build-marker.js";

describe("formatBuildMarker", () => {
  it("clean な状態を2行のテキストに変換する", () => {
    const content = formatBuildMarker({
      commitHash: "abc123",
      dirty: false,
    });
    expect(content).toBe("abc123\nclean\n");
  });

  it("dirty な状態を2行のテキストに変換する", () => {
    const content = formatBuildMarker({
      commitHash: "abc123",
      dirty: true,
    });
    expect(content).toBe("abc123\ndirty\n");
  });
});

describe("parseBuildMarker", () => {
  it("formatBuildMarker の出力を往復して復元できる（clean）", () => {
    const info = { commitHash: "deadbeef", dirty: false };
    expect(parseBuildMarker(formatBuildMarker(info))).toEqual(info);
  });

  it("formatBuildMarker の出力を往復して復元できる（dirty）", () => {
    const info = { commitHash: "deadbeef", dirty: true };
    expect(parseBuildMarker(formatBuildMarker(info))).toEqual(info);
  });

  it("末尾に改行が無くてもパースできる", () => {
    expect(parseBuildMarker("abc123\ndirty")).toEqual({
      commitHash: "abc123",
      dirty: true,
    });
  });

  it("2行目が dirty 以外(例: clean)なら dirty: false として扱う", () => {
    expect(parseBuildMarker("abc123\nclean")).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("2行目が欠けていても dirty: false として扱う", () => {
    expect(parseBuildMarker("abc123")).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("空文字列は null を返す(ビルド情報が見つからない扱い)", () => {
    expect(parseBuildMarker("")).toBeNull();
  });

  it("空白のみの内容は null を返す", () => {
    expect(parseBuildMarker("   \n  \n")).toBeNull();
  });

  it("1行目が空で2行目だけある壊れた内容は null を返す", () => {
    expect(parseBuildMarker("\ndirty")).toBeNull();
  });

  it("1行目の前後に空白があっても trim して hash を復元する", () => {
    expect(parseBuildMarker("  abc123  \nclean")).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("2行目の前後に空白があっても trim して dirty 判定する", () => {
    expect(parseBuildMarker("abc123\n  dirty  ")).toEqual({
      commitHash: "abc123",
      dirty: true,
    });
  });

  it("CRLF 改行でも \\r を trim して復元する", () => {
    expect(parseBuildMarker("abc123\r\ndirty\r\n")).toEqual({
      commitHash: "abc123",
      dirty: true,
    });
  });

  it("3行目以降の余分な内容は無視する", () => {
    expect(parseBuildMarker("abc123\ndirty\nextra\ngarbage")).toEqual({
      commitHash: "abc123",
      dirty: true,
    });
  });

  it("dirty トークンは大文字小文字を区別する(DIRTY は dirty 扱いにしない)", () => {
    // bash 側(scripts/dev-up.sh)も [ "$marker_dirty" = "dirty" ] で厳密一致
    // 比較しているため、TS 側もそれに合わせて厳密一致とする。
    expect(parseBuildMarker("abc123\nDIRTY")).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });

  it("2行目が dirty の部分一致(dirtyx 等)でも dirty 扱いにしない", () => {
    expect(parseBuildMarker("abc123\ndirtyx")).toEqual({
      commitHash: "abc123",
      dirty: false,
    });
  });
});

describe("formatBuildMarker / parseBuildMarker の往復不変性", () => {
  const hashes = [
    "0000000000000000000000000000000000000000",
    "0dc9683",
    "aBcDeF0123456789",
    "z-not-a-real-hash-but-nonempty",
  ];

  for (const commitHash of hashes) {
    for (const dirty of [false, true]) {
      it(`format→parse で元の値に戻る(hash=${commitHash}, dirty=${dirty})`, () => {
        const info = { commitHash, dirty };
        expect(parseBuildMarker(formatBuildMarker(info))).toEqual(info);
      });
    }
  }

  it("空の commitHash は format できても parse すると null になる(往復が崩れる境界)", () => {
    // formatBuildMarker は入力を検証しないため、空 hash でも文字列は生成する。
    // ただしその出力は parseBuildMarker で null になり、往復は成立しない。
    // write-marker 側で万一 hash が空になった場合、dev-up.sh は
    // 「ビルド情報の中身が壊れている」と警告できる(=診断能力は保たれる)。
    const content = formatBuildMarker({ commitHash: "", dirty: false });
    expect(content).toBe("\nclean\n");
    expect(parseBuildMarker(content)).toBeNull();
  });
});

describe("BUILD_MARKER_FILENAME", () => {
  it("先頭がドットで始まるファイル名である", () => {
    expect(BUILD_MARKER_FILENAME.startsWith(".")).toBe(true);
  });
});
