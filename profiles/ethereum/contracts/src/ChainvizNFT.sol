// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainvizNFT
/// @notice 学習用の ERC-721 サブセット実装。「誰がどの tokenId を持っているか」
///         という NFT 固有の所有関係を学ぶための中核（tokenId ごとの所有・
///         承認・transferFrom・Transfer/Approval イベント）だけを自己完結で
///         実装している。ChainvizToken（ERC20）と対比させ、「数量」ではなく
///         「個体」を管理する台帳であることを示すサンプルコントラクト
///         （docs/ARCHITECTURE.md §13「NFT（ERC-721）の所有関係の可視化」）。
///
///         実物の EIP-721 との差分（意図的に省いた機能）:
///         - safeTransferFrom（受信側コントラクトの ERC721Receiver フック）
///         - setApprovalForAll / isApprovedForAll（オペレータ承認。全件委任）
///         - ERC-165（supportsInterface によるインターフェース検出）
///         - tokenURI（オフチェーンメタデータ）
///         - burn（発行済み tokenId を消す操作）
///         いずれも「tokenId の所有」という主題から外れるため持ち込まない。
///
///         【重要・前提条件】burn が無く、tokenId は mint() のたびに
///         1 始まりで連番採番するため、「発行済み tokenId の集合は常に
///         1 〜 totalSupply の連続区間になる」ことが不変条件として成立する。
///         collector 側の所有台帳ポーリング（NFT 所有トラッカー。
///         docs/ARCHITECTURE.md §13.2）は ERC721Enumerable 相当の列挙関数
///         を持たないこの前提に依存して totalSupply() → ownerOf(1..totalSupply)
///         を照会する。将来 burn 等の機能を足す場合は、この不変条件が崩れる
///         ため collector 側の列挙方法も合わせて見直すこと。
contract ChainvizNFT {
    string public constant name = "Chainviz NFT";
    string public constant symbol = "CVNDEMO";

    uint256 public totalSupply;
    address public immutable owner;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) private _tokenApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ChainvizNFT: caller is not the owner");
        _;
    }

    /// @notice 新しい tokenId を to へ発行する（デプロイヤーのみ呼び出し可）。
    ///         tokenId は totalSupply をインクリメントした値（1 始まりの
    ///         連番）を自動採番する。burn が無いため、この採番方式により
    ///         「発行済み tokenId = 1〜totalSupply」の不変条件が常に成立する
    ///         （コントラクト先頭のコメント参照）。
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "ChainvizNFT: mint to the zero address");
        totalSupply += 1;
        tokenId = totalSupply;
        _owners[tokenId] = to;
        balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    /// @notice tokenId の現在の所有者を返す。未発行の tokenId は revert する
    ///         （実物の ERC-721 と同じ挙動）。
    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "ChainvizNFT: owner query for nonexistent token");
        return tokenOwner;
    }

    /// @notice tokenId に対して現在承認されているアドレスを返す
    ///         （未承認なら address(0)）。
    function getApproved(uint256 tokenId) public view returns (address) {
        // ownerOf での存在確認を再利用し、未発行 tokenId への照会も revert させる。
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    /// @notice 1 つの tokenId について、transferFrom を代行できるアドレスを
    ///         指定する。所有者本人のみ呼び出せる（setApprovalForAll に相当
    ///         する「全件まとめて委任」は持たない。単一 tokenId 単位の
    ///         承認のみのサブセット）。
    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(msg.sender == tokenOwner, "ChainvizNFT: approve caller is not owner");
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    /// @notice tokenId を from から to へ移転する。呼び出せるのは所有者本人
    ///         または getApproved で承認されたアドレスのみ。受信側コントラクト
    ///         へのフック呼び出し（safeTransferFrom 相当）は行わない。
    function transferFrom(address from, address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        require(tokenOwner == from, "ChainvizNFT: transfer from incorrect owner");
        require(to != address(0), "ChainvizNFT: transfer to the zero address");
        require(
            msg.sender == tokenOwner || msg.sender == _tokenApprovals[tokenId],
            "ChainvizNFT: caller is not owner nor approved"
        );

        delete _tokenApprovals[tokenId];

        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }
}
