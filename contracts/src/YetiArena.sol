// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title YetiArena — onchain money layer for Yeti World
/// @notice The game itself (real-time memecoin dodging) runs offchain on the
///         game server — 60Hz physics can never be transactions. This contract
///         handles the money: USDG entries in, pot held, winner paid out.
///         The authorized referee (game server address) declares the winner
///         after each round; the contract enforces the 95/5 split.
///         An optional bonus token (wired later) pays a fixed bonus per win.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract YetiArena {
    uint256 public constant FEE_BPS = 500; // 5% to treasury, 95% to winner

    IERC20 public immutable usdg;
    address public treasury;
    address public referee;
    address public owner;

    // Optional bonus token (e.g. VIPER or a future YETI): fixed amount per win.
    IERC20 public bonusToken;
    uint256 public bonusPerWin;

    struct Lobby {
        uint256 entryFee;
        uint256 pot;
        address[] players;
        mapping(address => bool) entered;
        bool resolved;
    }

    mapping(uint256 => Lobby) private lobbies;
    uint256 public nextLobbyId;

    event LobbyCreated(uint256 indexed lobbyId, uint256 entryFee, address indexed creator);
    event Joined(uint256 indexed lobbyId, address indexed player, uint256 pot);
    event WinnerDeclared(uint256 indexed lobbyId, address indexed winner, uint256 prize, uint256 fee);
    event LobbyCancelled(uint256 indexed lobbyId, uint256 playersRefunded);
    event RefereeUpdated(address indexed oldReferee, address indexed newReferee);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event BonusUpdated(address indexed token, uint256 perWin);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyReferee() {
        require(msg.sender == referee, "not referee");
        _;
    }

    constructor(address _usdg, address _treasury, address _referee) {
        require(_usdg != address(0) && _treasury != address(0) && _referee != address(0), "zero addr");
        usdg = IERC20(_usdg);
        treasury = _treasury;
        referee = _referee;
        owner = msg.sender;
    }

    /// @notice Create a lobby with a fixed USDG entry fee. Returns the lobby id.
    function createLobby(uint256 entryFee) external returns (uint256) {
        require(entryFee > 0, "fee zero");
        uint256 id = nextLobbyId++;
        Lobby storage l = lobbies[id];
        l.entryFee = entryFee;
        emit LobbyCreated(id, entryFee, msg.sender);
        return id;
    }

    /// @notice Join a lobby, paying the entry fee into the pot. One entry per player.
    function join(uint256 lobbyId) external {
        Lobby storage l = lobbies[lobbyId];
        require(l.entryFee > 0, "no lobby");
        require(!l.resolved, "resolved");
        require(!l.entered[msg.sender], "already in");
        require(usdg.transferFrom(msg.sender, address(this), l.entryFee), "pay failed");
        l.entered[msg.sender] = true;
        l.players.push(msg.sender);
        l.pot += l.entryFee;
        emit Joined(lobbyId, msg.sender, l.pot);
    }

    /// @notice Referee declares the round winner. 95% of pot to winner, 5% to treasury.
    function declareWinner(uint256 lobbyId, address winner) external onlyReferee {
        Lobby storage l = lobbies[lobbyId];
        require(l.entryFee > 0, "no lobby");
        require(!l.resolved, "resolved");
        require(l.players.length >= 2, "need 2+ players");
        require(l.entered[winner], "winner not in lobby");
        l.resolved = true;
        uint256 fee = (l.pot * FEE_BPS) / 10_000;
        uint256 prize = l.pot - fee;
        require(usdg.transfer(treasury, fee), "fee xfer failed");
        require(usdg.transfer(winner, prize), "prize xfer failed");
        if (address(bonusToken) != address(0) && bonusPerWin > 0) {
            require(bonusToken.transfer(winner, bonusPerWin), "bonus xfer failed");
        }
        emit WinnerDeclared(lobbyId, winner, prize, fee);
    }

    /// @notice Owner cancels an unresolved lobby, refunding every entrant.
    function cancelLobby(uint256 lobbyId) external onlyOwner {
        Lobby storage l = lobbies[lobbyId];
        require(l.entryFee > 0, "no lobby");
        require(!l.resolved, "resolved");
        l.resolved = true;
        for (uint256 i = 0; i < l.players.length; i++) {
            require(usdg.transfer(l.players[i], l.entryFee), "refund failed");
        }
        emit LobbyCancelled(lobbyId, l.players.length);
    }

    // ---- Admin ----

    function setReferee(address r) external onlyOwner {
        require(r != address(0), "zero addr");
        emit RefereeUpdated(referee, r);
        referee = r;
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "zero addr");
        emit TreasuryUpdated(treasury, t);
        treasury = t;
    }

    function setBonus(address token, uint256 perWin) external onlyOwner {
        bonusToken = IERC20(token);
        bonusPerWin = perWin;
        emit BonusUpdated(token, perWin);
    }

    /// @notice Top up the bonus reserve. Anyone can fund.
    function fundBonus(uint256 amount) external {
        require(address(bonusToken) != address(0), "no bonus token");
        require(bonusToken.transferFrom(msg.sender, address(this), amount), "fund failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero addr");
        owner = newOwner;
    }

    // ---- Views ----

    function lobbyInfo(uint256 lobbyId)
        external
        view
        returns (uint256 entryFee, uint256 pot, uint256 playerCount, bool resolved)
    {
        Lobby storage l = lobbies[lobbyId];
        return (l.entryFee, l.pot, l.players.length, l.resolved);
    }

    function lobbyPlayers(uint256 lobbyId) external view returns (address[] memory) {
        return lobbies[lobbyId].players;
    }

    function hasEntered(uint256 lobbyId, address player) external view returns (bool) {
        return lobbies[lobbyId].entered[player];
    }
}
