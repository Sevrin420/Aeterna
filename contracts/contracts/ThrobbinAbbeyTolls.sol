// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Throbbin Abbey Tolls
 * @notice Everything in the abbey that costs money and is NOT the mint. Mini
 *         games, entries, wagers, whatever gets built — each one is a named
 *         toll with a price in the chain's coin, a price in the token, or both.
 *
 *         ADDING ONE IS A TRANSACTION, NOT A DEPLOY. `setToll` names a new
 *         purpose and prices it; the server watches for one event and learns
 *         nothing new about the shape of the thing being paid for. Nothing here
 *         needs to be redeployed, and nothing here touches the collection.
 *
 *         WHY IT IS NOT IN THE COLLECTION. ThrobbinAbbeyBloodline is immutable
 *         on purpose — its price, its supply and both payout addresses cannot
 *         be changed by anyone, and that is a promise worth more than the
 *         convenience of one contract. A price map the owner can edit does not
 *         belong beside it. Kept apart, a toll can be repriced, switched off, or
 *         got wrong, and a Bloodline is still a Bloodline.
 *
 *         WHAT THE OWNER CAN AND CANNOT DO. They can name tolls, price them and
 *         close them. They cannot move the money anywhere: `withdraw` splits to
 *         the same two immutable addresses as the collection and is callable by
 *         anyone, so a lost owner key cannot strand the treasury and a live one
 *         cannot redirect it.
 *
 *         WHAT A REPRICE CANNOT DO. Payment is EXACT, checked against the
 *         price in the same transaction. An owner who raises a toll while
 *         somebody is signing does not overcharge them — the payment reverts and
 *         the player keeps their money.
 */
contract ThrobbinAbbeyTolls is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// The same ERC-20 the collection takes. address(0) leaves every toll
    /// coin-only, which is what a chain without the token wants.
    IERC20 public immutable payToken;

    /// Where the money goes. The same two addresses as the collection, and
    /// immutable here for the same reason.
    address public immutable team;
    address public immutable treasury;
    uint256 public constant TEAM_BPS = 2000; // 20.00%

    /**
     * A priced thing. Either price may be zero, which shuts THAT door for THIS
     * toll — so a game can be coin-only, token-only, or both, and none of that
     * needs a new function.
     *
     * `open` is separate from the prices so a toll can be closed for the
     * evening and reopened at the price it already had.
     */
    struct Toll {
        uint256 coin;
        uint256 token;
        bool open;
    }

    /// A toll is named by a bytes32 the caller chooses — keccak256("dice"), or
    /// just the ASCII padded out. Names rather than numbers: an id that reads
    /// as itself in a log is worth more than one that has to be looked up.
    mapping(bytes32 => Toll) public tolls;

    /// Every id ever set, so the whole board can be read without being told
    /// what to ask for.
    bytes32[] private _ids;
    mapping(bytes32 => bool) private _known;

    event TollSet(bytes32 indexed id, uint256 coin, uint256 token, bool open);

    /**
     * @notice One payment for one toll.
     * @param id       which toll
     * @param payer    who paid
     * @param tokenId  the Bloodline it is for — a wallet may hold several, and
     *                 the server must credit the line, not the wallet
     * @param inToken  false = the chain's coin, true = payToken
     * @param amount   what actually moved, in that currency's smallest unit
     * @param ref      the caller's own reference: a round id, a seed, a nonce.
     *                 Opaque here on purpose, so a future game can put whatever
     *                 it needs to tie this payment to an attempt without this
     *                 contract being changed to understand it.
     */
    event Paid(
        bytes32 indexed id,
        address indexed payer,
        uint256 indexed tokenId,
        bool inToken,
        uint256 amount,
        bytes32 ref
    );

    event Withdrawn(uint256 toTeam, uint256 toTreasury);
    event WithdrawnToken(uint256 toTeam, uint256 toTreasury);

    constructor(address _team, address _treasury, address _payToken) Ownable(msg.sender) {
        require(_team != address(0) && _treasury != address(0), "zero payout address");
        team = _team;
        treasury = _treasury;
        payToken = IERC20(_payToken);
    }

    // ---- naming and pricing --------------------------------------------------

    /**
     * @notice Name a toll, price it, and open or close it.
     * @dev The one call that adding a new priced thing needs. Both prices zero
     *      is refused while open: a toll that is open and free is a mistake
     *      every time, and it would emit Paid events for nothing.
     */
    function setToll(bytes32 id, uint256 coinPrice, uint256 tokenPrice, bool open) external onlyOwner {
        require(id != bytes32(0), "no id");
        require(!open || coinPrice > 0 || tokenPrice > 0, "an open toll needs a price");
        require(tokenPrice == 0 || address(payToken) != address(0), "no token on this deployment");

        if (!_known[id]) {
            _known[id] = true;
            _ids.push(id);
        }
        tolls[id] = Toll(coinPrice, tokenPrice, open);
        emit TollSet(id, coinPrice, tokenPrice, open);
    }

    /// Close one without touching its price.
    function setTollOpen(bytes32 id, bool open) external onlyOwner {
        require(_known[id], "no such toll");
        Toll storage t = tolls[id];
        require(!open || t.coin > 0 || t.token > 0, "an open toll needs a price");
        t.open = open;
        emit TollSet(id, t.coin, t.token, open);
    }

    // ---- paying --------------------------------------------------------------

    /**
     * @notice Pay a toll in the chain's own coin.
     * @dev Exact payment, checked against the price in this same transaction —
     *      so a toll repriced while somebody is signing reverts rather than
     *      overcharging them, and an overpayment is refused rather than kept.
     */
    function pay(bytes32 id, uint256 tokenId, bytes32 ref) external payable nonReentrant {
        Toll memory t = tolls[id];
        require(t.open, "toll closed");
        require(t.coin > 0, "not payable in coin");
        require(msg.value == t.coin, "wrong value");

        emit Paid(id, msg.sender, tokenId, false, msg.value, ref);
    }

    /**
     * @notice Pay a toll in payToken. Approve this contract for the price first.
     * @dev What ARRIVED is what counts, measured either side of the pull, so a
     *      token that takes a fee on transfer reverts instead of buying an entry
     *      for less than the price.
     */
    function payWithToken(bytes32 id, uint256 tokenId, bytes32 ref) external nonReentrant {
        require(address(payToken) != address(0), "no token on this deployment");
        Toll memory t = tolls[id];
        require(t.open, "toll closed");
        require(t.token > 0, "not payable in token");

        uint256 before = payToken.balanceOf(address(this));
        payToken.safeTransferFrom(msg.sender, address(this), t.token);
        uint256 received = payToken.balanceOf(address(this)) - before;
        require(received >= t.token, "token short - fee on transfer?");

        emit Paid(id, msg.sender, tokenId, true, received, ref);
    }

    // ---- the money out -------------------------------------------------------

    /// Callable by anyone, to the two immutable addresses. See the collection's
    /// withdraw() for why this is not onlyOwner.
    function withdraw() external nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "nothing to withdraw");
        uint256 toTeam = (bal * TEAM_BPS) / 10000;
        uint256 toTreasury = bal - toTeam;

        (bool a, ) = payable(team).call{value: toTeam}("");
        require(a, "team transfer failed");
        (bool b, ) = payable(treasury).call{value: toTreasury}("");
        require(b, "treasury transfer failed");
        emit Withdrawn(toTeam, toTreasury);
    }

    function withdrawToken() external nonReentrant {
        require(address(payToken) != address(0), "no token");
        uint256 bal = payToken.balanceOf(address(this));
        require(bal > 0, "nothing to withdraw");
        uint256 toTeam = (bal * TEAM_BPS) / 10000;
        uint256 toTreasury = bal - toTeam;

        payToken.safeTransfer(team, toTeam);
        payToken.safeTransfer(treasury, toTreasury);
        emit WithdrawnToken(toTeam, toTreasury);
    }

    // ---- views ---------------------------------------------------------------

    /// Everything priced, in one call, so the game can draw a board of tolls
    /// without being told in advance what is on it.
    function allTolls()
        external
        view
        returns (bytes32[] memory ids, uint256[] memory coin, uint256[] memory token, bool[] memory open)
    {
        uint256 n = _ids.length;
        ids = new bytes32[](n);
        coin = new uint256[](n);
        token = new uint256[](n);
        open = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = _ids[i];
            Toll memory t = tolls[id];
            ids[i] = id;
            coin[i] = t.coin;
            token[i] = t.token;
            open[i] = t.open;
        }
    }

    function tollCount() external view returns (uint256) { return _ids.length; }
}
