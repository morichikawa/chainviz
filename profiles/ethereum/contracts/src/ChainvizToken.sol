// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainvizToken
/// @notice 学習用の最小 ERC20 実装。外部ライブラリ（OpenZeppelin 等）には
///         依存せず、ERC20 の中核（残高・allowance・transfer/approve/
///         transferFrom・Transfer/Approval イベント）だけを自己完結で
///         実装している。chainviz のサンプルコントラクトとして、トークン
///         transfer の呼び出し・イベントログ可視化デモに使う
///         （docs/ARCHITECTURE.md §4「コントラクトカタログ」）。
contract ChainvizToken {
    string public constant name = "Chainviz Token";
    string public constant symbol = "CVZDEMO";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @param initialSupply デプロイ時にデプロイヤー（msg.sender）へ供給する
    ///        初期発行量（wei 単位、decimals=18）。0 を指定してデプロイ後に
    ///        mint() で発行する運用も可能。genesis でプリマインされた
    ///        アカウント（values.env の EL_AND_CL_MNEMONIC 由来）に配りたい
    ///        場合は、そのアカウントからデプロイするか、デプロイ後に
    ///        mint() で送る。
    constructor(uint256 initialSupply) {
        owner = msg.sender;
        if (initialSupply > 0) {
            _mint(msg.sender, initialSupply);
        }
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ChainvizToken: caller is not the owner");
        _;
    }

    /// @notice 追加発行。任意の宛先へ初期供給・追加供給するためのデモ用途の
    ///         関数（デプロイヤーのみ呼び出し可）。
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ChainvizToken: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "ChainvizToken: transfer to the zero address");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "ChainvizToken: transfer amount exceeds balance");
        unchecked {
            balanceOf[from] = fromBalance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "ChainvizToken: mint to the zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
