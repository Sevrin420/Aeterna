const { expect } = require('chai');
const { ethers } = require('hardhat');

const PRICE = ethers.parseEther('0.01');
// 30,000 THROBBIN a Cultist, at the mock token's 18 decimals.
const TOKEN_PRICE = 30000n * 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';
const ERC5192_ID = '0xb45a3c0e';   // bytes4(keccak256('locked(uint256)'))

describe('ThrobbinAbbeyBloodline', () => {
  let c, tok, owner, alice, bob, team, treasury;

  beforeEach(async () => {
    [owner, alice, bob, team, treasury] = await ethers.getSigners();
    const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
    tok = await (await ethers.getContractFactory('MockERC20')).deploy('Throbbin', 'THROBBIN', 18);
    await tok.waitForDeployment();
    c = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/',
                       await tok.getAddress(), TOKEN_PRICE);
    await c.waitForDeployment();
    await c.setMintOpen(true);
  });

  it('is named for the abbey', async () => {
    expect(await c.name()).to.equal('Throbbin Abbey Bloodline');
    expect(await c.symbol()).to.equal('THROB');
  });

  it('costs 0.01 AVAX per cultist', async () => {
    await c.connect(alice).mint(7, { value: PRICE * 7n });
    expect(await c.cultistsOf(1)).to.equal(7);
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(PRICE * 7n);
  });

  it('refuses the wrong payment in either direction', async () => {
    await expect(c.connect(alice).mint(3, { value: PRICE * 2n })).to.be.revertedWith('wrong value');
    await expect(c.connect(alice).mint(3, { value: PRICE * 4n })).to.be.revertedWith('wrong value');
  });

  it('holds between 1 and 20 cultists and no more', async () => {
    await expect(c.connect(alice).mint(0, { value: 0 })).to.be.revertedWith('1-20 cultists');
    await expect(c.connect(alice).mint(21, { value: PRICE * 21n })).to.be.revertedWith('1-20 cultists');
    await c.connect(alice).mint(20, { value: PRICE * 20n });
    expect(await c.cultistsOf(1)).to.equal(20);
  });

  it('has no way at all to add cultists to a minted bloodline', () => {
    const names = c.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
    const suspicious = names.filter((n) => /add|increase|upgrade|setCultist|grow/i.test(n));
    expect(suspicious, `mutators found: ${suspicious}`).to.have.lengthOf(0);
  });

  it('lets one wallet hold several bloodlines, each with its own count', async () => {
    await c.connect(alice).mint(3, { value: PRICE * 3n });
    await c.connect(alice).mint(11, { value: PRICE * 11n });
    expect(await c.balanceOf(alice.address)).to.equal(2);
    expect(await c.bloodlinesOf(alice.address)).to.deep.equal([1n, 2n]);
    expect(await c.cultistsHeldBy(alice.address)).to.equal(14);
  });

  it('cannot be minted until the mint is opened', async () => {
    const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
    const shut = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/', ZERO, 0);
    await expect(shut.connect(alice).mint(1, { value: PRICE })).to.be.revertedWith('mint closed');
  });

  it('stops at max supply', async () => {
    const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
    const tiny = await F.deploy(PRICE, 2, team.address, treasury.address, 'https://x/nft/', ZERO, 0);
    await tiny.setMintOpen(true);
    await tiny.connect(alice).mint(1, { value: PRICE });
    await tiny.connect(bob).mint(1, { value: PRICE });
    await expect(tiny.connect(alice).mint(1, { value: PRICE })).to.be.revertedWith('sold out');
  });

  it('splits withdrawals 20/80 and can be called by anyone', async () => {
    await c.connect(alice).mint(10, { value: PRICE * 10n });   // 0.1 AVAX
    const t0 = await ethers.provider.getBalance(team.address);
    const r0 = await ethers.provider.getBalance(treasury.address);
    await c.connect(bob).withdraw();                            // not the owner
    expect(await ethers.provider.getBalance(team.address) - t0).to.equal(ethers.parseEther('0.02'));
    expect(await ethers.provider.getBalance(treasury.address) - r0).to.equal(ethers.parseEther('0.08'));
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(0);
  });

  it('mints past any plausible cap when supply is set uncapped', async () => {
    const MAX = 2n ** 256n - 1n;
    const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
    const open = await F.deploy(PRICE, MAX, team.address, treasury.address, 'https://x/nft/', ZERO, 0);
    await open.setMintOpen(true);
    expect(await open.maxSupply()).to.equal(MAX);
    for (let i = 0; i < 5; i++) await open.connect(alice).mint(1, { value: PRICE });
    expect(await open.minted()).to.equal(5);
  });

  it('never lets the owner touch the money', () => {
    const names = c.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
    expect(names).to.not.include('setTeam');
    expect(names).to.not.include('setTreasury');
    expect(names).to.not.include('emergencyWithdraw');
  });

  it('serves metadata from the server so devotion can show', async () => {
    await c.connect(alice).mint(1, { value: PRICE });
    expect(await c.tokenURI(1)).to.equal('https://x/nft/1');
    await c.setBaseURI('https://membersonly.cc/nft/');
    expect(await c.tokenURI(1)).to.equal('https://membersonly.cc/nft/1');
  });

  it('keeps price, supply and payout addresses immutable', () => {
    const names = c.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
    expect(names).to.not.include('setPrice');
    expect(names).to.not.include('setMaxSupply');
  });

  // ---- THE FOUNDER'S FREE LINE ----
  //
  // One Bloodline, once, for the wallet that deployed the collection. It pays
  // nothing and it wins nothing — the payout exclusion lives off-chain, but the
  // token id it keys on is recorded here so anyone can check it.

  describe('founder mint', () => {
    it('gives the owner one line for nothing', async () => {
      const before = await ethers.provider.getBalance(await c.getAddress());
      await c.founderMint(6);
      expect(await c.cultistsOf(1)).to.equal(6);
      expect(await c.ownerOf(1)).to.equal(owner.address);
      // The contract took no money for it.
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(before);
    });

    it('records which token it was, so the payout can exclude it', async () => {
      expect(await c.founderTokenId()).to.equal(0);      // before
      expect(await c.founderMinted()).to.equal(false);
      await c.founderMint(1);
      expect(await c.founderTokenId()).to.equal(1);      // after
      expect(await c.founderMinted()).to.equal(true);
    });

    it('cannot be spent twice', async () => {
      await c.founderMint(1);
      await expect(c.founderMint(1)).to.be.revertedWith('founder mint spent');
    });

    it('is the owner only', async () => {
      await expect(c.connect(alice).founderMint(1))
        .to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    });

    it('holds 1 to 20 Cultists like any other line', async () => {
      await expect(c.founderMint(0)).to.be.revertedWith('1-20 cultists');
      await expect(c.founderMint(21)).to.be.revertedWith('1-20 cultists');
    });

    it('says on chain that it was free', async () => {
      await expect(c.founderMint(4)).to.emit(c, 'Minted').withArgs(owner.address, 1, 4, 0);
    });

    it('is soulbound too — the founder cannot sell theirs either', async () => {
      await c.founderMint(2);
      await expect(c.transferFrom(owner.address, alice.address, 1))
        .to.be.revertedWithCustomError(c, 'Soulbound');
      expect(await c.locked(1)).to.equal(true);
    });

    it('does not need the mint to be open', async () => {
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const shut = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/', ZERO, 0);
      expect(await shut.mintOpen()).to.equal(false);
      await shut.founderMint(3);                    // the public mint is closed
      expect(await shut.ownerOf(1)).to.equal(owner.address);
    });

    it('takes its place in the numbering, it does not skip it', async () => {
      await c.founderMint(1);
      await c.connect(alice).mint(2, { value: PRICE * 2n });
      expect(await c.ownerOf(1)).to.equal(owner.address);
      expect(await c.ownerOf(2)).to.equal(alice.address);
      expect(await c.minted()).to.equal(2);
    });
  });

  // ---- SOULBOUND ----
  //
  // These are the point of the redeploy. The old collection was a plain
  // transferable ERC-721: every one of the four cases below SUCCEEDED on it.

  describe('soulbound', () => {
    beforeEach(async () => {
      await c.connect(alice).mint(4, { value: PRICE * 4n });
    });

    it('refuses a plain transfer', async () => {
      await expect(c.connect(alice).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(c, 'Soulbound');
    });

    it('refuses both safeTransferFrom overloads', async () => {
      await expect(
        c.connect(alice)['safeTransferFrom(address,address,uint256)'](alice.address, bob.address, 1)
      ).to.be.revertedWithCustomError(c, 'Soulbound');
      await expect(
        c.connect(alice)['safeTransferFrom(address,address,uint256,bytes)'](alice.address, bob.address, 1, '0x')
      ).to.be.revertedWithCustomError(c, 'Soulbound');
    });

    it('refuses approvals, so nothing can be listed anywhere', async () => {
      await expect(c.connect(alice).approve(bob.address, 1))
        .to.be.revertedWithCustomError(c, 'Soulbound');
      await expect(c.connect(alice).setApprovalForAll(bob.address, true))
        .to.be.revertedWithCustomError(c, 'Soulbound');
      expect(await c.getApproved(1)).to.equal(ethers.ZeroAddress);
      expect(await c.isApprovedForAll(alice.address, bob.address)).to.equal(false);
    });

    it('the contract owner cannot move one either', async () => {
      await expect(c.connect(owner).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(c, 'Soulbound');
      const names = c.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
      expect(names).to.not.include('burn');
      expect(names).to.not.include('adminTransfer');
    });

    it('says so on chain, per ERC-5192', async () => {
      expect(await c.locked(1)).to.equal(true);
      expect(await c.supportsInterface(ERC5192_ID)).to.equal(true);
      await expect(c.locked(999)).to.be.revertedWithCustomError(c, 'ERC721NonexistentToken');
    });

    it('emits Locked at mint so a marketplace hears about it', async () => {
      await expect(c.connect(bob).mint(1, { value: PRICE }))
        .to.emit(c, 'Locked').withArgs(2);
    });

    it('still lets the wallet that raised it keep playing it', async () => {
      expect(await c.ownerOf(1)).to.equal(alice.address);
      expect(await c.bloodlinesOf(alice.address)).to.deep.equal([1n]);
      expect(await c.cultistsHeldBy(alice.address)).to.equal(4);
    });
  });

  // ---- PAYING IN $THROBBIN ----
  //
  // The second door. 30,000 a Cultist, flat — no oracle, no conversion, and no
  // way to change either price once the contract is out.

  describe('minting with the token', () => {
    const fund = async (who, cultists) => {
      const cost = TOKEN_PRICE * BigInt(cultists);
      await tok.mint(who.address, cost);
      await tok.connect(who).approve(await c.getAddress(), cost);
      return cost;
    };

    it('costs 30,000 THROBBIN per cultist', async () => {
      expect(await c.tokenPricePerCultist()).to.equal(TOKEN_PRICE);
      const cost = await fund(alice, 7);
      await c.connect(alice).mintWithToken(7);
      expect(await c.cultistsOf(1)).to.equal(7);
      expect(await c.ownerOf(1)).to.equal(alice.address);
      expect(await tok.balanceOf(await c.getAddress())).to.equal(cost);
      expect(await tok.balanceOf(alice.address)).to.equal(0);
    });

    it('produces a line indistinguishable from one bought with coin', async () => {
      await fund(alice, 4);
      await c.connect(alice).mintWithToken(4);
      await c.connect(bob).mint(4, { value: PRICE * 4n });
      expect(await c.cultistsOf(1)).to.equal(await c.cultistsOf(2));
      expect(await c.locked(1)).to.equal(true);
      expect(await c.tokenURI(1)).to.equal('https://x/nft/1');
    });

    it('is soulbound too', async () => {
      await fund(alice, 1);
      await c.connect(alice).mintWithToken(1);
      await expect(c.connect(alice).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(c, 'Soulbound');
    });

    it('says on chain what was paid, and in which currency', async () => {
      const cost = await fund(alice, 3);
      const tx = c.connect(alice).mintWithToken(3);
      await expect(tx).to.emit(c, 'MintedWithToken').withArgs(alice.address, 1, 3, cost);
      // Minted carries paid = 0: no coin changed hands, and a reader summing
      // Minted.paid must not count a token mint as coin revenue.
      await expect(tx).to.emit(c, 'Minted').withArgs(alice.address, 1, 3, 0);
      await expect(tx).to.emit(c, 'Locked').withArgs(1);
    });

    it('needs an approval first, and refuses without one', async () => {
      await tok.mint(alice.address, TOKEN_PRICE);
      await expect(c.connect(alice).mintWithToken(1))
        .to.be.revertedWithCustomError(tok, 'ERC20InsufficientAllowance');
    });

    it('refuses a wallet that approved but does not hold enough', async () => {
      await tok.mint(alice.address, TOKEN_PRICE - 1n);
      await tok.connect(alice).approve(await c.getAddress(), TOKEN_PRICE);
      await expect(c.connect(alice).mintWithToken(1))
        .to.be.revertedWithCustomError(tok, 'ERC20InsufficientBalance');
    });

    it('honours the same 1-20 range and the same closed mint', async () => {
      await fund(alice, 20);
      await expect(c.connect(alice).mintWithToken(0)).to.be.revertedWith('1-20 cultists');
      await expect(c.connect(alice).mintWithToken(21)).to.be.revertedWith('1-20 cultists');
      await c.setMintOpen(false);
      await expect(c.connect(alice).mintWithToken(1)).to.be.revertedWith('mint closed');
    });

    it('shares one numbering with the coin mint', async () => {
      await c.connect(bob).mint(1, { value: PRICE });
      await fund(alice, 1);
      await c.connect(alice).mintWithToken(1);
      expect(await c.ownerOf(1)).to.equal(bob.address);
      expect(await c.ownerOf(2)).to.equal(alice.address);
      expect(await c.minted()).to.equal(2);
    });

    it('counts against max supply like any other', async () => {
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const tiny = await F.deploy(PRICE, 1, team.address, treasury.address, 'https://x/nft/',
                                  await tok.getAddress(), TOKEN_PRICE);
      await tiny.setMintOpen(true);
      await tok.mint(alice.address, TOKEN_PRICE * 2n);
      await tok.connect(alice).approve(await tiny.getAddress(), TOKEN_PRICE * 2n);
      await tiny.connect(alice).mintWithToken(1);
      await expect(tiny.connect(alice).mintWithToken(1)).to.be.revertedWith('sold out');
    });

    it('is shut entirely when no token was set at deploy', async () => {
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const noTok = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/', ZERO, 0);
      await noTok.setMintOpen(true);
      await expect(noTok.connect(alice).mintWithToken(1)).to.be.revertedWith('token minting is off');
      await expect(noTok.withdrawToken()).to.be.revertedWith('no token');
      // And the coin door is untouched.
      await noTok.connect(alice).mint(1, { value: PRICE });
      expect(await noTok.ownerOf(1)).to.equal(alice.address);
    });

    it('refuses a deploy that sets one half of the pair', async () => {
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const t = await tok.getAddress();
      await expect(F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/', t, 0))
        .to.be.revertedWith('token needs both address and price');
      await expect(F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/', ZERO, TOKEN_PRICE))
        .to.be.revertedWith('token needs both address and price');
    });

    it('does not assume 18 decimals', async () => {
      // A 6-decimal token: 30,000 of it is 30000e6, and nothing in the contract
      // should care which it is.
      const six = await (await ethers.getContractFactory('MockERC20')).deploy('Six', 'SIX', 6);
      const price6 = 30000n * 10n ** 6n;
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const c6 = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/',
                                await six.getAddress(), price6);
      await c6.setMintOpen(true);
      await six.mint(alice.address, price6 * 2n);
      await six.connect(alice).approve(await c6.getAddress(), price6 * 2n);
      await c6.connect(alice).mintWithToken(2);
      expect(await six.balanceOf(await c6.getAddress())).to.equal(price6 * 2n);
    });

    it('refuses a token that takes a cut, rather than selling cheap', async () => {
      const fee = await (await ethers.getContractFactory('FeeERC20')).deploy(100);   // 1%
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const cf = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/',
                                await fee.getAddress(), TOKEN_PRICE);
      await cf.setMintOpen(true);
      await fee.mint(alice.address, TOKEN_PRICE);
      await fee.connect(alice).approve(await cf.getAddress(), TOKEN_PRICE);
      await expect(cf.connect(alice).mintWithToken(1)).to.be.revertedWith('token short - fee on transfer?');
    });

    it('refuses a token that calls back into the mint', async () => {
      const re = await (await ethers.getContractFactory('ReentrantERC20')).deploy();
      const F = await ethers.getContractFactory('ThrobbinAbbeyBloodline');
      const cr = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/',
                                await re.getAddress(), TOKEN_PRICE);
      await cr.setMintOpen(true);
      await re.mint(alice.address, TOKEN_PRICE * 4n);
      await re.connect(alice).approve(await cr.getAddress(), TOKEN_PRICE * 4n);
      await re.arm(await cr.getAddress());
      await expect(cr.connect(alice).mintWithToken(1))
        .to.be.revertedWithCustomError(cr, 'ReentrancyGuardReentrantCall');
    });

    it('sweeps the token 20/80 as well, and anyone may call it', async () => {
      const cost = await fund(alice, 10);
      await c.connect(alice).mintWithToken(10);
      await c.connect(bob).withdrawToken();                       // not the owner
      expect(await tok.balanceOf(team.address)).to.equal(cost / 5n);
      expect(await tok.balanceOf(treasury.address)).to.equal(cost - cost / 5n);
      expect(await tok.balanceOf(await c.getAddress())).to.equal(0);
    });

    it('sweeps each currency without needing the other', async () => {
      // Coin only: the token sweep has nothing to do and says so, and the coin
      // sweep still works. One function requiring both would strand whichever
      // arrived first.
      await c.connect(bob).mint(1, { value: PRICE });
      await expect(c.withdrawToken()).to.be.revertedWith('nothing to withdraw');
      await c.withdraw();
      // Token only.
      await fund(alice, 1);
      await c.connect(alice).mintWithToken(1);
      await expect(c.withdraw()).to.be.revertedWith('nothing to withdraw');
      await c.withdrawToken();
      expect(await tok.balanceOf(treasury.address)).to.equal(TOKEN_PRICE - TOKEN_PRICE / 5n);
    });

    it('keeps the token price immutable too', () => {
      const names = c.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
      expect(names).to.not.include('setTokenPrice');
      expect(names).to.not.include('setPayToken');
    });
  });
});
