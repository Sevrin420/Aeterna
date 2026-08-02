const { expect } = require('chai');
const { ethers } = require('hardhat');

const PRICE = ethers.parseEther('0.01');

describe('AeternaBloodline', () => {
  let c, owner, alice, bob, team, treasury;

  beforeEach(async () => {
    [owner, alice, bob, team, treasury] = await ethers.getSigners();
    const F = await ethers.getContractFactory('AeternaBloodline');
    c = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/');
    await c.waitForDeployment();
    await c.setMintOpen(true);
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
    const F = await ethers.getContractFactory('AeternaBloodline');
    const shut = await F.deploy(PRICE, 100, team.address, treasury.address, 'https://x/nft/');
    await expect(shut.connect(alice).mint(1, { value: PRICE })).to.be.revertedWith('mint closed');
  });

  it('stops at max supply', async () => {
    const F = await ethers.getContractFactory('AeternaBloodline');
    const tiny = await F.deploy(PRICE, 2, team.address, treasury.address, 'https://x/nft/');
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
    const F = await ethers.getContractFactory('AeternaBloodline');
    const open = await F.deploy(PRICE, MAX, team.address, treasury.address, 'https://x/nft/');
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
});
