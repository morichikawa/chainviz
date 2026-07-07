// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Counter
/// @notice 状態変更とイベント発行だけを行う、もっとも単純な学習用
///         コントラクト。chainviz のコントラクト呼び出し・イベントログ
///         可視化デモに使う（docs/ARCHITECTURE.md §4「コントラクトカタログ」）。
contract Counter {
    uint256 public count;

    event Incremented(address indexed caller, uint256 newCount);
    event Reset(address indexed caller);

    /// @notice カウンタを1増やす。もっとも基本的な呼び出しデモ用。
    function increment() external {
        count += 1;
        emit Incremented(msg.sender, count);
    }

    /// @notice カウンタを任意の量だけ増やす（引数付き呼び出しの可視化デモ用）。
    function incrementBy(uint256 amount) external {
        count += amount;
        emit Incremented(msg.sender, count);
    }

    /// @notice カウンタを0に戻す。
    function reset() external {
        count = 0;
        emit Reset(msg.sender);
    }
}
