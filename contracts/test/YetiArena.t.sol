// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/YetiArena.sol";

contract MockUSDG {
    string public name = "Mock USDG";
    string public symbol = "mUSDG";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract MockBonus {
    string public name = "Mock Bonus";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

contract YetiArenaTest is Test {
    YetiArena arena;
    MockUSDG usdg;
    MockBonus bonus;

    address owner = address(0xA11CE);
    address treasury = address(0xBEEF);
    address referee = address(0x9EF);
    address alice = address(0xA11);
    address bob = address(0xB0B);
    address carol = address(0xCA0);

    uint256 constant ENTRY = 20_000_000; // $20

    function setUp() public {
        usdg = new MockUSDG();
        bonus = new MockBonus();
        vm.prank(owner);
        arena = new YetiArena(address(usdg), treasury, referee);
        // fund players
        usdg.mint(alice, 1_000_000_000);
        usdg.mint(bob, 1_000_000_000);
        usdg.mint(carol, 1_000_000_000);
    }

    function _joinTwo(uint256 id) internal {
        vm.prank(alice);
        usdg.approve(address(arena), ENTRY);
        vm.prank(alice);
        arena.join(id);
        vm.prank(bob);
        usdg.approve(address(arena), ENTRY);
        vm.prank(bob);
        arena.join(id);
    }

    function testCreateLobby() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        assertEq(id, 0);
        (uint256 fee, uint256 pot, uint256 n, bool resolved) = arena.lobbyInfo(id);
        assertEq(fee, ENTRY);
        assertEq(pot, 0);
        assertEq(n, 0);
        assertFalse(resolved);
    }

    function testCreateLobbyZeroFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert("fee zero");
        arena.createLobby(0);
    }

    function testJoinPaysEntryAndGrowsPot() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        vm.prank(alice);
        usdg.approve(address(arena), ENTRY);
        vm.prank(alice);
        arena.join(id);
        (, uint256 pot, uint256 n,) = arena.lobbyInfo(id);
        assertEq(pot, ENTRY);
        assertEq(n, 1);
        assertTrue(arena.hasEntered(id, alice));
        assertEq(usdg.balanceOf(address(arena)), ENTRY);
    }

    function testJoinTwiceReverts() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        vm.prank(alice);
        usdg.approve(address(arena), ENTRY * 2);
        vm.prank(alice);
        arena.join(id);
        vm.prank(alice);
        vm.expectRevert("already in");
        arena.join(id);
    }

    function testJoinMissingLobbyReverts() public {
        vm.prank(alice);
        vm.expectRevert("no lobby");
        arena.join(999);
    }

    function testDeclareWinnerPays95_5() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        uint256 pot = ENTRY * 2;
        uint256 t0 = usdg.balanceOf(treasury);
        uint256 w0 = usdg.balanceOf(bob);
        vm.prank(referee);
        arena.declareWinner(id, bob);
        uint256 fee = (pot * 500) / 10_000;
        assertEq(usdg.balanceOf(treasury) - t0, fee, "treasury 5%");
        assertEq(usdg.balanceOf(bob) - w0, pot - fee, "winner 95%");
        (,,, bool resolved) = arena.lobbyInfo(id);
        assertTrue(resolved);
    }

    function testDeclareWinnerNonRefereeReverts() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        vm.prank(alice);
        vm.expectRevert("not referee");
        arena.declareWinner(id, bob);
    }

    function testDeclareWinnerNeedsTwoPlayers() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        vm.prank(alice);
        usdg.approve(address(arena), ENTRY);
        vm.prank(alice);
        arena.join(id);
        vm.prank(referee);
        vm.expectRevert("need 2+ players");
        arena.declareWinner(id, alice);
    }

    function testDeclareWinnerMustBeEntrant() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        vm.prank(referee);
        vm.expectRevert("winner not in lobby");
        arena.declareWinner(id, carol);
    }

    function testDeclareWinnerTwiceReverts() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        vm.prank(referee);
        arena.declareWinner(id, bob);
        vm.prank(referee);
        vm.expectRevert("resolved");
        arena.declareWinner(id, alice);
    }

    function testBonusPaidOnWin() public {
        uint256 perWin = 4_000 ether;
        bonus.mint(owner, perWin);
        vm.prank(owner);
        arena.setBonus(address(bonus), perWin);
        vm.prank(owner);
        bonus.approve(address(arena), perWin);
        vm.prank(owner);
        arena.fundBonus(perWin);

        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        vm.prank(referee);
        arena.declareWinner(id, alice);
        assertEq(bonus.balanceOf(alice), perWin, "bonus paid");
    }

    function testNoBonusWhenUnset() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        vm.prank(referee);
        arena.declareWinner(id, alice); // must not revert
        assertEq(bonus.balanceOf(alice), 0);
    }

    function testCancelRefundsAll() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        uint256 a0 = usdg.balanceOf(alice);
        uint256 b0 = usdg.balanceOf(bob);
        vm.prank(owner);
        arena.cancelLobby(id);
        assertEq(usdg.balanceOf(alice), a0 + ENTRY, "alice refunded");
        assertEq(usdg.balanceOf(bob), b0 + ENTRY, "bob refunded");
        (,,, bool resolved) = arena.lobbyInfo(id);
        assertTrue(resolved);
    }

    function testCancelNonOwnerReverts() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        vm.prank(alice);
        vm.expectRevert("not owner");
        arena.cancelLobby(id);
    }

    function testSetReferee() public {
        address nr = address(0x9E4);
        vm.prank(owner);
        arena.setReferee(nr);
        assertEq(arena.referee(), nr);
    }

    function testSetRefereeNonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        arena.setReferee(address(0x9E4));
    }

    function testLobbyPlayersView() public {
        vm.prank(alice);
        uint256 id = arena.createLobby(ENTRY);
        _joinTwo(id);
        address[] memory ps = arena.lobbyPlayers(id);
        assertEq(ps.length, 2);
        assertEq(ps[0], alice);
        assertEq(ps[1], bob);
    }
}
