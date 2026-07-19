// Issue #406 テスト強化: 処理帯の「x = ...」行に表示する文言（messages.ts）が、
// 実際にハッシュ／署名を計算するドメインロジック（deriveBlockHash /
// messageHash）の入力そのものと一致していることを固定する。
//
// 既存の .i18n.test.tsx は「その文字列が画面に出るか」だけを見ており、表示と
// ロジックが将来別々に書き換わっても検出できない（＝表示だけの嘘になり得る）。
// ここでは (a) ロジック側の連結順・区切り文字を keccak256 の入力文字列を
// 手組みして固定し、(b) 表示側の項目の並び順が同じであることを固定する。
// 両者が揃って初めて「表示している式が本物」であることが保証される。
import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages.js";
import { deriveBlockHash } from "./hashChainDemo.js";
import { keccak256Hex } from "./keccak256.js";
import { sign } from "./secp256k1.js";
import {
  ALICE_ADDRESS,
  ALICE_SANDBOX_PRIVATE_KEY,
  createInitialSignatureDemoState,
  deriveSignature,
} from "./signatureDemo.js";

describe("hash demo: x-line display matches deriveBlockHash's preimage", () => {
  it("deriveBlockHash concatenates number|parentHash|data with '|' in that order", () => {
    // ロジック側の入力形式を手組みの keccak256 入力と照合して固定する。
    // 順序・区切り文字が変わればここで落ちる。
    const block = { number: 7, storedParentHash: "0xdeadbeef", data: "hello world" };
    expect(deriveBlockHash(block)).toBe(keccak256Hex("7|0xdeadbeef|hello world"));
  });

  it("the ja x-line lists the field labels in the same order as the preimage (number, parentHash, data)", () => {
    const number = messages["hashDemo.field.number"].ja;
    const parentHash = messages["hashDemo.field.parentHash"].ja;
    const data = messages["hashDemo.field.data"].ja;
    // 「x = 」トークンは JSX 側のハードコードのため文言には含まれない。
    // 本文はこの3項目を「 | 」でこの順に並べた文字列で始まる。
    expect(messages["hashDemo.computeInput"].ja.startsWith(`${number} | ${parentHash} | ${data}`)).toBe(
      true,
    );
  });

  it("the en x-line lists the field labels in the same order as the preimage (number, parentHash, data)", () => {
    const number = messages["hashDemo.field.number"].en;
    const parentHash = messages["hashDemo.field.parentHash"].en;
    const data = messages["hashDemo.field.data"].en;
    expect(
      messages["hashDemo.computeInput"].en.toLowerCase().startsWith(
        `${number} | ${parentHash} | ${data}`.toLowerCase(),
      ),
    ).toBe(true);
  });
});

describe("signature demo: sign x-line display matches the signed preimage", () => {
  it("the signed message hash is keccak256(from|to|amount) in that order, then signed", () => {
    // deriveSignature = sign(secret, messageHash(sent.content)) を、from|to|amount
    // を手組みして keccak256 → sign し直したものと照合する。messageHash は
    // 非公開関数のため、公開されている sign / keccak256Hex 経由で入力形式を固定する。
    const state = createInitialSignatureDemoState();
    const { to, amountEth } = state.sent.content;
    const expected = sign(
      ALICE_SANDBOX_PRIVATE_KEY,
      keccak256Hex(`${ALICE_ADDRESS}|${to}|${amountEth}`),
    );
    expect(deriveSignature(state)).toBe(expected);
  });

  it("the ja sign x-line lists sender, to, amount in the same order as the preimage", () => {
    const msg = messages["sigDemo.computeInput.sign"].ja;
    const iFrom = msg.indexOf("送信者");
    const iTo = msg.indexOf("宛先");
    const iAmount = msg.indexOf("金額");
    expect(iFrom).toBeGreaterThanOrEqual(0);
    expect(iTo).toBeGreaterThan(iFrom);
    expect(iAmount).toBeGreaterThan(iTo);
  });

  it("the en sign x-line lists sender, to, amount in the same order as the preimage", () => {
    const msg = messages["sigDemo.computeInput.sign"].en;
    const iFrom = msg.indexOf("sender");
    const iTo = msg.indexOf("to");
    const iAmount = msg.indexOf("amount");
    expect(iFrom).toBeGreaterThanOrEqual(0);
    expect(iTo).toBeGreaterThan(iFrom);
    expect(iAmount).toBeGreaterThan(iTo);
  });

  it("both languages of the sign x-line show that the content is keccak256'd before signing", () => {
    // 「まず keccak256 でハッシュ化し、そのハッシュに署名する」= 指摘2への回答。
    // messageHash が先に keccak256 する事実（上のテストで固定）と表示が揃う。
    expect(messages["sigDemo.computeInput.sign"].ja).toContain("keccak256(");
    expect(messages["sigDemo.computeInput.sign"].en).toContain("keccak256(");
  });
});

describe("signature demo: verify x-line names both verification inputs", () => {
  it("the ja verify x-line mentions the received signature and the recomputed hash order", () => {
    const msg = messages["sigDemo.computeInput.verify"].ja;
    // 「届いた署名」と「keccak256(...)」の2入力が、この順で登場する。
    const iSig = msg.indexOf("届いた署名");
    const iHash = msg.indexOf("keccak256(");
    expect(iSig).toBeGreaterThanOrEqual(0);
    expect(iHash).toBeGreaterThan(iSig);
  });

  it("both languages of the verify x-line state the hash is recomputed from the arrived content", () => {
    // 検証がハッシュを『届いた内容から』計算し直す（deriveRecoveredAddress が
    // received を使う）ことが改ざん検知の成立理由。ここが表示から消えないよう固定する。
    expect(messages["sigDemo.computeInput.verify"].ja).toContain("届いた内容");
    expect(messages["sigDemo.computeInput.verify"].en.toLowerCase()).toContain("arrived");
  });
});
