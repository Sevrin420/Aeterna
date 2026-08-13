// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Throbbin Abbey Bloodline
 * @notice One NFT is a Bloodline. It is minted once, holding between 1 and 20
 *         Cultists, and that count is fixed for the life of the token — there
 *         is deliberately no function anywhere here that raises it. A wallet
 *         may hold several Bloodlines; the game makes you play one at a time.
 *
 *         SOULBOUND. A Bloodline cannot be transferred, sold, given away or
 *         burned. It belongs to the wallet that raised it, permanently. This is
 *         not a policy the game enforces off-chain and hopes holds — the token
 *         has no path out of the wallet that minted it, so a leaderboard place
 *         cannot be bought and a played line cannot be flipped mid-run.
 *
 *         The consequence is worth stating plainly: there is no secondary
 *         market, and a lost wallet is a lost Bloodline with no recovery of any
 *         kind. Nobody — not the owner of this contract, not the deployer — can
 *         move one.
 *
 *         Cultists do not change how much Devotion an act is worth. They are a
 *         MULTIPLIER on the end-of-run payout, which is settled off-chain, so
 *         nothing in this contract needs to know what Devotion is.
 *
 *         Devotion itself lives on the server and is surfaced through
 *         tokenURI: the metadata a marketplace shows is served live, so a
 *         Bloodline visibly "upgrades" as its holder plays without a single
 *         transaction. That is the only sense in which it is upgradable, and it
 *         is the safe one — no owner anywhere can rewrite what a token holds.
 */

/// ERC-5192, the minimal soulbound interface. Implemented so a marketplace can
/// ASK whether a token is locked and show it as such, rather than offering a
/// Sell button that reverts.
interface IERC5192 {
    /// @notice Emitted when a token is locked. Emitted at mint; never unlocked.
    event Locked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

contract ThrobbinAbbeyBloodline is ERC721Enumerable, Ownable, ReentrancyGuard, IERC5192 {
    using SafeERC20 for IERC20;

    /// Price of one Cultist in the chain's own coin. Immutable: the cost of a
    /// Bloodline can never be changed out from under someone who is mid-mint.
    uint256 public immutable pricePerCultist;

    /// The other way to pay: an ERC-20, at a price of its own.
    ///
    /// TWO PRICES, NOT A CONVERSION. There is no oracle here and there is
    /// deliberately not going to be one — the token price is a flat number set
    /// at deploy, so a mint costs what the sign says whatever the market does
    /// that week. The consequence is honest and worth stating: if the token's
    /// value moves, one of the two doors becomes the cheap one, and neither
    /// price can be adjusted afterwards.
    ///
    /// address(0) shuts the token door entirely — which is what a testnet
    /// deploy wants, where the token does not exist.
    IERC20 public immutable payToken;

    /// Price of one Cultist in payToken's SMALLEST UNIT. 30,000 tokens at 18
    /// decimals is 30000e18, and the deploy script computes it from the token's
    /// own decimals() rather than trusting anyone to count the zeros.
    uint256 public immutable tokenPricePerCultist;

    /// Most Cultists one Bloodline may hold.
    uint256 public constant MAX_CULTISTS = 20;

    /// Hard cap on Bloodlines. Immutable, set at deploy. Set to
    /// type(uint256).max for an uncapped collection — the cap still exists in
    /// the code, it is simply set beyond any reachable token id.
    uint256 public immutable maxSupply;

    /// Where mint proceeds go. Both immutable, both set at deploy: a fifth to
    /// the team, the rest to the treasury the run pays out of.
    address public immutable team;
    address public immutable treasury;
    uint256 public constant TEAM_BPS = 2000; // 20.00%

    /// tokenId => Cultists held. Written once, in mint, and never again.
    mapping(uint256 => uint256) public cultistsOf;

    /// Minting can be paused before it opens and closed for good afterwards.
    bool public mintOpen;

    /// The founder's single free Bloodline: spent or not. A flag rather than a
    /// count, so it cannot be topped up.
    bool public founderMinted;

    /// WHICH token the founder took, or 0 until they take it.
    ///
    /// This is here for the PAYOUT, not for the mint. The founder's line is
    /// barred from taking a share of the pot, and a rule like that is worth
    /// nothing living in a document — whoever settles the run needs to be able
    /// to ask which line is excluded, and any player needs to be able to check
    /// the answer without taking anyone's word for it.
    uint256 public founderTokenId;

    string private _base;
    uint256 private _nextId = 1;

    /// Thrown by every path that would move a token out of the wallet that
    /// raised it, and by the approval calls that exist only to enable one.
    error Soulbound();

    event Minted(address indexed to, uint256 indexed tokenId, uint256 cultists, uint256 paid);
    /// A mint paid for in payToken. Separate from Minted's `paid`, which is the
    /// chain's own coin — one event carrying "an amount" of either would make
    /// every reader guess which.
    event MintedWithToken(address indexed to, uint256 indexed tokenId, uint256 cultists, uint256 paidToken);
    event Withdrawn(uint256 toTeam, uint256 toTreasury);
    event WithdrawnToken(uint256 toTeam, uint256 toTreasury);

    constructor(
        uint256 _pricePerCultist,
        uint256 _maxSupply,
        address _team,
        address _treasury,
        string memory baseURI_,
        address _payToken,
        uint256 _tokenPricePerCultist
    ) ERC721("Throbbin Abbey Bloodline", "THROB") Ownable(msg.sender) {
        require(_team != address(0) && _treasury != address(0), "zero payout address");
        require(_maxSupply > 0, "zero supply");
        // Either both or neither. A token address with no price would mint for
        // free; a price with no token is a setting nothing can ever read.
        require(
            (_payToken == address(0)) == (_tokenPricePerCultist == 0),
            "token needs both address and price"
        );
        pricePerCultist = _pricePerCultist;
        maxSupply = _maxSupply;
        team = _team;
        treasury = _treasury;
        _base = baseURI_;
        payToken = IERC20(_payToken);
        tokenPricePerCultist = _tokenPricePerCultist;
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
        emit Locked(tokenId);
    }

    /**
     * @notice Mint one Bloodline, paying in payToken instead of the chain's coin.
     * @dev The caller must approve() this contract for `cultists *
     *      tokenPricePerCultist` first. That is two transactions rather than
     *      one, and there is no way around it for a plain ERC-20 — the token
     *      has to be told before it will let anyone move it.
     *
     *      WHAT ARRIVED IS WHAT COUNTS. The balance is measured either side of
     *      the pull rather than trusting the amount asked for, so a token that
     *      takes a fee on transfer reverts here instead of quietly buying a
     *      Bloodline for less than the price. Written for a token this contract
     *      cannot inspect at deploy time.
     */
    function mintWithToken(uint256 cultists) external nonReentrant returns (uint256 tokenId) {
        require(mintOpen, "mint closed");
        require(address(payToken) != address(0), "token minting is off");
        require(cultists >= 1 && cultists <= MAX_CULTISTS, "1-20 cultists");
        require(_nextId <= maxSupply, "sold out");

        uint256 cost = cultists * tokenPricePerCultist;

        // Effects before the two external calls: a token that calls back finds
        // the id already spent, so a reentrant mint is another ordinary mint
        // that the caller pays for again, not a free one.
        tokenId = _nextId++;
        cultistsOf[tokenId] = cultists;

        uint256 before = payToken.balanceOf(address(this));
        payToken.safeTransferFrom(msg.sender, address(this), cost);
        uint256 received = payToken.balanceOf(address(this)) - before;
        require(received >= cost, "token short - fee on transfer?");

        _safeMint(msg.sender, tokenId);
        emit MintedWithToken(msg.sender, tokenId, cultists, received);
        emit Minted(msg.sender, tokenId, cultists, 0);   // paid no coin, and says so
        emit Locked(tokenId);
    }

    // ---- soulbound ----

    /**
     * @dev The single chokepoint. Every mint, transfer and burn in ERC721 goes
     *      through _update, so refusing here refuses all of them at once —
     *      transferFrom, both safeTransferFrom overloads, and anything a future
     *      extension might add. A token with an existing owner cannot be moved
     *      to anyone, including address(0).
     *
     *      Only the mint (no previous owner) is allowed through.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    /// Approvals exist only to let somebody else move a token, and nobody can.
    /// Refused rather than left working, so a holder cannot be talked into
    /// signing one and cannot list a Bloodline anywhere that reverts on sale.
    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert Soulbound();
    }

    /// ERC-5192. Every token is locked, from the block it is minted, forever.
    /// Reverts for a token that does not exist, per the spec.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool)
    {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @notice The deployer's single free Bloodline.
     * @dev Deliberately NOT a branch inside mint(). A payable function that
     *      waives payment for one caller is one edit away from waiving it for
     *      everyone; this takes no money at all, cannot be called twice, and is
     *      plain in the ABI to anyone reading the contract.
     *
     *      It does not require mintOpen, so the founder's line can be raised
     *      and the whole flow checked end to end before the public mint opens.
     *
     *      The token is soulbound like every other — the founder cannot sell
     *      theirs either — and `paid = 0` in the event says on chain that it
     *      was free rather than leaving it looking like an unpaid mint.
     */
    function founderMint(uint256 cultists) external onlyOwner returns (uint256 tokenId) {
        require(!founderMinted, "founder mint spent");
        require(cultists >= 1 && cultists <= MAX_CULTISTS, "1-20 cultists");
        require(_nextId <= maxSupply, "sold out");

        founderMinted = true;
        tokenId = _nextId++;
        founderTokenId = tokenId;
        cultistsOf[tokenId] = cultists;
        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, cultists, 0);
        emit Locked(tokenId);
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

    /**
     * @notice The same sweep, for whatever payToken the mint has taken in.
     * @dev A second function rather than a branch in withdraw(), because
     *      withdraw() must keep working when the token balance is zero and vice
     *      versa — one function that required both to be non-zero would strand
     *      whichever arrived first.
     *
     *      Callable by anyone, to the same two immutable addresses, for the same
     *      reason: a lost owner key must not be able to strand the treasury.
     */
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
