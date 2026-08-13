const { expect } = require('chai');
const { ethers } = require('hardhat');

const ZERO = '0x0000000000000000000000000000000000000000';
const NOREF = '0x' + '00'.repeat(32);
const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const TOK = 5000n * 10n ** 18n;
const COIN = ethers.parseEther('0.001');

describe('ThrobbinAbbeyTolls', () => {
  let t, tok, owner, alice, bob, team, treasury;

  beforeEach(async () => {
    [owner, alice, bob, team, treasury] = await ethers.getSigners();
    tok = await (await ethers.getContractFactory('MockERC20')).deploy('Throbbin', 'THROBBIN', 18);
    t = await (await ethers.getContractFactory('ThrobbinAbbeyTolls'))
      .deploy(team.address, treasury.address, await tok.getAddress());
    await t.setToll(id('dice'), COIN, TOK, true);
    await tok.mint(alice.address, TOK * 100n);
    await tok.connect(alice).approve(await t.getAddress(), TOK * 100n);
  });

  // ---- ADDING ONE IS A TRANSACTION, NOT A DEPLOY ----

  it('names and prices a new toll in one call', async () => {
    await expect(t.setToll(id('cards'), COIN * 2n, TOK * 2n, true))
      .to.emit(t, 'TollSet').withArgs(id('cards'), COIN * 2n, TOK * 2n, true);
    const got = await t.tolls(id('cards'));
    expect(got.coin).to.equal(COIN * 2n);
    expect(got.token).to.equal(TOK * 2n);
    expect(got.open).to.equal(true);
  });

  it('lets a toll take one currency only', async () => {
    await t.setToll(id('coinonly'), COIN, 0, true);
    await t.setToll(id('tokenonly'), 0, TOK, true);
    await expect(t.connect(alice).payWithToken(id('coinonly'), 1, NOREF))
      .to.be.revertedWith('not payable in token');
    await expect(t.connect(alice).pay(id('tokenonly'), 1, NOREF, { value: COIN }))
      .to.be.revertedWith('not payable in coin');
    // …and each still works its own way.
    await t.connect(alice).pay(id('coinonly'), 1, NOREF, { value: COIN });
    await t.connect(alice).payWithToken(id('tokenonly'), 1, NOREF);
  });

  it('reprices without a redeploy, and without losing the name', async () => {
    await t.setToll(id('dice'), COIN * 3n, TOK * 3n, true);
    expect((await t.tolls(id('dice'))).coin).to.equal(COIN * 3n);
    expect(await t.tollCount()).to.equal(1);          // still one toll, not two
  });

  it('closes and reopens at the price it already had', async () => {
    await t.setTollOpen(id('dice'), false);
    await expect(t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN }))
      .to.be.revertedWith('toll closed');
    await t.setTollOpen(id('dice'), true);
    await t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN });
    expect((await t.tolls(id('dice'))).coin).to.equal(COIN);
  });

  it('reads the whole board in one call', async () => {
    await t.setToll(id('cards'), COIN, 0, false);
    const [ids, coin, token, open] = await t.allTolls();
    expect(ids).to.deep.equal([id('dice'), id('cards')]);
    expect(coin).to.deep.equal([COIN, COIN]);
    expect(token).to.deep.equal([TOK, 0n]);
    expect(open).to.deep.equal([true, false]);
  });

  it('is the owner only who may name or price one', async () => {
    await expect(t.connect(alice).setToll(id('x'), COIN, 0, true))
      .to.be.revertedWithCustomError(t, 'OwnableUnauthorizedAccount');
    await expect(t.connect(alice).setTollOpen(id('dice'), false))
      .to.be.revertedWithCustomError(t, 'OwnableUnauthorizedAccount');
  });

  it('refuses an open toll with no price at all', async () => {
    await expect(t.setToll(id('free'), 0, 0, true)).to.be.revertedWith('an open toll needs a price');
    // Closed and unpriced is fine — that is how one is parked.
    await t.setToll(id('free'), 0, 0, false);
  });

  it('refuses an unknown toll rather than treating it as free', async () => {
    await expect(t.connect(alice).pay(id('never'), 1, NOREF, { value: COIN }))
      .to.be.revertedWith('toll closed');
    await expect(t.setTollOpen(id('never'), true)).to.be.revertedWith('no such toll');
  });

  // ---- WHAT THE SERVER READS ----

  it('says who paid, for which line, in which currency, and what for', async () => {
    const ref = ethers.keccak256(ethers.toUtf8Bytes('round-7'));
    await expect(t.connect(alice).pay(id('dice'), 42, ref, { value: COIN }))
      .to.emit(t, 'Paid').withArgs(id('dice'), alice.address, 42, false, COIN, ref);
    await expect(t.connect(alice).payWithToken(id('dice'), 42, ref))
      .to.emit(t, 'Paid').withArgs(id('dice'), alice.address, 42, true, TOK, ref);
  });

  it('indexes the toll, the payer and the line, so all three can be filtered', async () => {
    await t.connect(alice).pay(id('dice'), 7, NOREF, { value: COIN });
    const ev = t.filters.Paid(id('dice'), alice.address, 7);
    expect((await t.queryFilter(ev)).length).to.equal(1);
    expect((await t.queryFilter(t.filters.Paid(id('dice'), bob.address))).length).to.equal(0);
  });

  // ---- WHAT A REPRICE CANNOT DO ----

  it('refuses the wrong payment in either direction', async () => {
    await expect(t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN - 1n }))
      .to.be.revertedWith('wrong value');
    await expect(t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN + 1n }))
      .to.be.revertedWith('wrong value');
  });

  it('cannot overcharge somebody mid-signature — it reverts instead', async () => {
    // The owner triples the price while a player is signing the old one. The
    // payment does not go through at the new price; it does not go through at
    // all, and the player keeps their money.
    const before = await ethers.provider.getBalance(alice.address);
    await t.setToll(id('dice'), COIN * 3n, TOK, true);
    await expect(t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN }))
      .to.be.revertedWith('wrong value');
    const after = await ethers.provider.getBalance(alice.address);
    expect(before - after).to.be.lessThan(COIN);      // gas only, not the toll
  });

  it('charges the token price exactly, whatever the caller approved', async () => {
    await tok.connect(alice).approve(await t.getAddress(), TOK * 50n);
    const held = await tok.balanceOf(alice.address);
    await t.connect(alice).payWithToken(id('dice'), 1, NOREF);
    expect(held - await tok.balanceOf(alice.address)).to.equal(TOK);
  });

  it('needs an approval, and refuses without one', async () => {
    await tok.mint(bob.address, TOK);
    await expect(t.connect(bob).payWithToken(id('dice'), 1, NOREF))
      .to.be.revertedWithCustomError(tok, 'ERC20InsufficientAllowance');
  });

  it('refuses a token that takes a cut', async () => {
    const fee = await (await ethers.getContractFactory('FeeERC20')).deploy(100);
    const tf = await (await ethers.getContractFactory('ThrobbinAbbeyTolls'))
      .deploy(team.address, treasury.address, await fee.getAddress());
    await tf.setToll(id('dice'), 0, TOK, true);
    await fee.mint(alice.address, TOK * 2n);
    await fee.connect(alice).approve(await tf.getAddress(), TOK * 2n);
    await expect(tf.connect(alice).payWithToken(id('dice'), 1, NOREF))
      .to.be.revertedWith('token short - fee on transfer?');
  });

  // ---- THE MONEY ----

  it('sweeps both currencies 20/80, and anyone may call it', async () => {
    await t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN });
    await t.connect(alice).payWithToken(id('dice'), 1, NOREF);

    const t0 = await ethers.provider.getBalance(team.address);
    const r0 = await ethers.provider.getBalance(treasury.address);
    await t.connect(bob).withdraw();                        // not the owner
    expect(await ethers.provider.getBalance(team.address) - t0).to.equal(COIN / 5n);
    expect(await ethers.provider.getBalance(treasury.address) - r0).to.equal(COIN - COIN / 5n);

    await t.connect(bob).withdrawToken();
    expect(await tok.balanceOf(team.address)).to.equal(TOK / 5n);
    expect(await tok.balanceOf(treasury.address)).to.equal(TOK - TOK / 5n);
  });

  it('never lets the owner send the money anywhere else', () => {
    const names = t.interface.fragments.filter((f) => f.type === 'function').map((f) => f.name);
    expect(names).to.not.include('setTeam');
    expect(names).to.not.include('setTreasury');
    expect(names).to.not.include('emergencyWithdraw');
    expect(names).to.not.include('sweepTo');
  });

  it('sweeps each currency without needing the other', async () => {
    await t.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN });
    await expect(t.withdrawToken()).to.be.revertedWith('nothing to withdraw');
    await t.withdraw();
    await t.connect(alice).payWithToken(id('dice'), 1, NOREF);
    await expect(t.withdraw()).to.be.revertedWith('nothing to withdraw');
    await t.withdrawToken();
  });

  // ---- A DEPLOYMENT WITH NO TOKEN ----

  it('works coin-only when no token was set', async () => {
    const noTok = await (await ethers.getContractFactory('ThrobbinAbbeyTolls'))
      .deploy(team.address, treasury.address, ZERO);
    await expect(noTok.setToll(id('dice'), COIN, TOK, true))
      .to.be.revertedWith('no token on this deployment');
    await noTok.setToll(id('dice'), COIN, 0, true);
    await noTok.connect(alice).pay(id('dice'), 1, NOREF, { value: COIN });
    await expect(noTok.connect(alice).payWithToken(id('dice'), 1, NOREF))
      .to.be.revertedWith('no token on this deployment');
    await expect(noTok.withdrawToken()).to.be.revertedWith('no token');
  });

  it('refuses a zero payout address', async () => {
    const F = await ethers.getContractFactory('ThrobbinAbbeyTolls');
    await expect(F.deploy(ZERO, treasury.address, ZERO)).to.be.revertedWith('zero payout address');
    await expect(F.deploy(team.address, ZERO, ZERO)).to.be.revertedWith('zero payout address');
  });
});
