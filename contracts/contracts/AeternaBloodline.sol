// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Aeterna Bloodline
 * @notice One NFT is a Bloodline. It is minted once, holding between 1 and 20
 *         Cultists, and that count is fixed for the life of the token — there
 *         is deliberately no function anywhere here that raises it. A wallet
 *         may hold several Bloodlines; the game makes you play one at a time.
 *
 *         Cultists do not change how much Devotion an act is worth. They are a
 *         MULTIPLIER on the end-of-season payout, which is settled off-chain,
 *         so nothing in this contract needs to know what Devotion is.
 *
 *         Devotion itself lives on the server and is surfaced through
 *         tokenURI: the metadata a marketplace shows is served live, so a
 *         Bloodline visibly "upgrades" as its holder plays without a single
 *         transaction. That is the only sense in which it is upgradable, and it
 *         is the safe one — no owner anywhere can rewrite what a token holds.
 */
contract AeternaBloodline is ERC721Enumerable, Ownable {
    /// Price of one Cultist. Immutable: the cost of a Bloodline can never be
    /// changed out from under someone who is mid-mint.
    uint256 public immutable pricePerCultist;

    /// Most Cultists one Bloodline may hold.
    uint256 public constant MAX_CULTISTS = 20;

    /// Hard cap on Bloodlines. Immutable, set at deploy.
    uint256 public immutable maxSupply;

    /// Where mint proceeds go. Both immutable, both set at deploy, and the
    /// split matches what the doctrine tells players: a tenth to the team, the
    /// rest to the treasury the season pays out of.
    address public immutable team;
    address public immutable treasury;
    uint256 public constant TEAM_BPS = 1000; // 10.00%

    /// tokenId => Cultists held. Written once, in mint, and never again.
    mapping(uint256 => uint256) public cultistsOf;

    /// Minting can be paused before it opens and closed for good afterwards.
    bool public mintOpen;

    string private _base;
    uint256 private _nextId = 1;

    event Minted(address indexed to, uint256 indexed tokenId, uint256 cultists, uint256 paid);
    event Withdrawn(uint256 toTeam, uint256 toTreasury);

    constructor(
        uint256 _pricePerCultist,
        uint256 _maxSupply,
        address _team,
        address _treasury,
        string memory baseURI_
    ) ERC721("Aeterna Bloodline", "BLOOD") Ownable(msg.sender) {
        require(_team != address(0) && _treasury != address(0), "zero payout address");
        require(_maxSupply > 0, "zero supply");
        pricePerCultist = _pricePerCultist;
        maxSupply = _maxSupply;
        team = _team;
        treasury = _treasury;
        _base = baseURI_;
    }

    /**
     * @notice Mint one Bloodline holding `cultists` Cultists.
     * @dev Exact payment only. Accepting an overpayment and keeping it is a
     *      quiet way to take money nobody meant to send, and refunding it means
     *      an external call inside mint — so the transaction simply reverts and
     *      the caller keeps their funds.
     */
    function mint(uint256 cultists) external payable returns (uint256 tokenId) {
        require(mintOpen, "mint closed");
        require(cultists >= 1 && cultists <= MAX_CULTISTS, "1-20 cultists");
        require(msg.value == cultists * pricePerCultist, "wrong value");
        require(_nextId <= maxSupply, "sold out");

        tokenId = _nextId++;
        cultistsOf[tokenId] = cultists;
        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, cultists, msg.value);
    }

    /**
     * @notice Send the balance to the team and the treasury.
     * @dev Deliberately callable by anyone: if only an owner could move funds,
     *      a lost owner key would strand the treasury. The destinations are
     *      immutable, so an open caller can only ever push money to the two
     *      addresses set at deploy. Balance is zeroed before the calls.
     */
    function withdraw() external {
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

    // ---- owner controls: opening the mint, and where metadata is served ----

    function setMintOpen(bool open) external onlyOwner { mintOpen = open; }

    /// The server serves metadata, so a Bloodline's card reflects live Devotion.
    function setBaseURI(string calldata baseURI_) external onlyOwner { _base = baseURI_; }

    function _baseURI() internal view override returns (string memory) { return _base; }

    // ---- views the game and the server read ----

    /// Every Bloodline in a wallet, so the client can make you pick one.
    function bloodlinesOf(address owner_) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(owner_);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = tokenOfOwnerByIndex(owner_, i);
    }

    /// Total Cultists across every Bloodline a wallet holds.
    function cultistsHeldBy(address owner_) external view returns (uint256 total) {
        uint256 n = balanceOf(owner_);
        for (uint256 i = 0; i < n; i++) total += cultistsOf[tokenOfOwnerByIndex(owner_, i)];
    }

    function minted() external view returns (uint256) { return _nextId - 1; }
}
