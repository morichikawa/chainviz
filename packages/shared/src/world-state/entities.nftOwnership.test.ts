// ContractEntity の NFT 所有関係フィールド（nft / nftTokens。Issue #315）に
// 関するテスト。関心事ごとにテストファイルを分ける流儀
// （entities.contractSource.test.ts と同じ）に従い、entities.test.ts からは
// 独立させる。
import { describe, expect, it } from "vitest";
import type { ContractEntity, NftToken, WalletEntity } from "./entities.js";

/** テスト用の最小 NFT コントラクト。 */
function nftContract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0x00000000000000000000000000000000000c0de",
    chainType: "ethereum",
    name: "ChainvizNFT",
    catalogKey: "ChainvizNFT",
    nft: { symbol: "CVNDEMO" },
    ...overrides,
  };
}

describe("ContractEntity NFT ownership (Issue #315)", () => {
  it("carries nft metadata and the ownership ledger across JSON", () => {
    // collector → frontend は WebSocket 上で JSON にシリアライズされて渡る。
    // symbol・tokenId・所有者アドレスが往復で崩れないことを確認する。
    const contract = nftContract({
      nftTokens: [
        { tokenId: "1", ownerAddress: "0x0000000000000000000000000000000000a11ce" },
        { tokenId: "2", ownerAddress: "0x0000000000000000000000000000000000000b0b" },
      ],
    });
    const roundTripped = JSON.parse(JSON.stringify(contract)) as ContractEntity;
    expect(roundTripped.nft).toEqual({ symbol: "CVNDEMO" });
    expect(roundTripped.nftTokens).toHaveLength(2);
    expect(roundTripped.nftTokens?.[0]).toEqual({
      tokenId: "1",
      ownerAddress: "0x0000000000000000000000000000000000a11ce",
    });
  });

  it("keeps tokenId as a decimal string, avoiding numeric precision loss", () => {
    // tokenId は uint256 全域を表せるよう 10 進文字列で持つ（balance /
    // TokenBalance.amount と同じ精度落ち防止の設計）。
    const huge: NftToken = {
      tokenId:
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      ownerAddress: "0x0000000000000000000000000000000000a11ce",
    };
    const roundTripped = JSON.parse(JSON.stringify(huge)) as NftToken;
    expect(typeof roundTripped.tokenId).toBe("string");
    expect(roundTripped.tokenId).toBe(huge.tokenId);
  });

  it("distinguishes an observed-but-empty ledger (空配列) from omission (未観測)", () => {
    // 空配列 = 「観測できたが 1 個も発行されていない」、省略 = 「情報なし」。
    // tokenBalances と同じ区別が JSON 往復でも保たれることを確認する。
    const emptyLedger = nftContract({ nftTokens: [] });
    const roundTripped = JSON.parse(
      JSON.stringify(emptyLedger),
    ) as ContractEntity;
    expect(roundTripped.nftTokens).toEqual([]);
    expect(roundTripped.nftTokens).not.toBeUndefined();

    const unobserved = nftContract({ nftTokens: undefined });
    const serialized = JSON.stringify(unobserved);
    expect(serialized).not.toContain("nftTokens");
    expect((JSON.parse(serialized) as ContractEntity).nftTokens).toBeUndefined();
  });

  it("treats a legacy contract without nft fields as a non-NFT contract", () => {
    // フィールド未付与の旧スナップショット・NFT 以外のコントラクト
    // （ChainvizToken / Counter 等）。省略はキー自体が JSON に現れず、
    // フロントは NFT 関連の表示を出さない側に安全に倒れる。
    const erc20Like: ContractEntity = {
      kind: "contract",
      address: "0x000000000000000000000000000000000000f00d",
      chainType: "ethereum",
      name: "ChainvizToken",
      token: { symbol: "CVZDEMO", decimals: 18 },
    };
    const serialized = JSON.stringify(erc20Like);
    expect(serialized).not.toContain("nftTokens");
    expect(serialized).not.toContain('"nft"');
    const parsed = JSON.parse(serialized) as ContractEntity;
    expect(parsed.nft).toBeUndefined();
    expect(parsed.nftTokens).toBeUndefined();
  });

  it("keeps token (数量の残高台帳) and nft (個体の所有台帳) as independent axes", () => {
    // token と nft は別軸のメタ情報で統合しない。NFT コントラクトは通常
    // token を持たず、フロントは nft の有無で台帳表示を切り替える。
    const contract = nftContract();
    expect(contract.token).toBeUndefined();
    expect(contract.nft?.symbol).toBe("CVNDEMO");
  });

  it("does not guarantee referential integrity between ownerAddress and wallets", () => {
    // ownerAddress は「ウォレットとして追跡中とは限らないアドレス」も指せる
    // （追跡外アドレスへの mint / transfer）。型は参照先の存在を保証せず、
    // フロントは対応する WalletEntity が無ければ短縮アドレス表示に倒す
    // （drivesNodeId 等と同じダングリング許容の流儀）。また表記の食い違い
    // （チェーン側の生の小文字表記 vs EIP-55 チェックサム表記）は大文字小文字を
    // 無視した照合で吸収する前提を、値の面から確認する。
    const wallet: WalletEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000A11CE",
      chainType: "ethereum",
      balance: "0",
      nonce: 0,
      isSmartAccount: false,
      ownerWorkbenchId: "workbench-alice",
      recentTxHashes: [],
    };
    const token: NftToken = {
      tokenId: "1",
      ownerAddress: "0x0000000000000000000000000000000000a11ce",
    };
    // 単純な文字列一致では照合できない（アダプタは小文字、ウォレットは
    // チェックサム表記になりうる）。
    expect(token.ownerAddress === wallet.address).toBe(false);
    expect(token.ownerAddress.toLowerCase() === wallet.address.toLowerCase()).toBe(
      true,
    );
  });
});
