import { expect } from 'chai';
import { network } from 'hardhat';

const { ethers } = await network.connect();

describe('StakingRewards', function () {
  const rewardRate = 10n;

  const moveTime = async (seconds: number) => {
    await ethers.provider.send('evm_increaseTime', [seconds]);
    await ethers.provider.send('evm_mine', []);
  };

  const getTimestamp = async (txHash: string) => {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error('receipt not found');
    }

    const block = await ethers.provider.getBlock(receipt.blockNumber);
    if (!block) {
      throw new Error('block not found');
    }

    return BigInt(block.timestamp);
  };

  const deployStaking = async () => {
    const [owner, user, secondUser] = await ethers.getSigners();

    const token = await ethers.deployContract('TestToken', [
      'Stake Token',
      'STK',
    ]);
    const staking = await ethers.deployContract('StakingRewards', [
      await token.getAddress(),
      rewardRate,
    ]);
    const stakingAddress = await staking.getAddress();

    await token.mint(owner.address, 100_000n);
    await token.mint(user.address, 1_000n);
    await token.mint(secondUser.address, 1_000n);

    await token.approve(stakingAddress, 50_000n);
    await staking.fundRewards(50_000n);

    return { owner, user, secondUser, token, staking, stakingAddress };
  }

  it('lets a user stake tokens', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await token.connect(user).approve(stakingAddress, 250n);

    await expect(staking.connect(user).stake(250n))
      .to.emit(staking, 'Staked')
      .withArgs(user.address, 250n);

    expect(await token.balanceOf(user.address)).to.equal(750n);
    expect(await token.balanceOf(stakingAddress)).to.equal(50_250n);
    expect(await staking.balanceOf(user.address)).to.equal(250n);
    expect(await staking.stakedBalance(user.address)).to.equal(250n);
    expect(await staking.totalStaked()).to.equal(250n);
    expect(await staking.totalSupply()).to.equal(250n);
  });

  it('reverts if the user has not approved enough tokens', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await expect(staking.connect(user).stake(100n)).to.be.revertedWith(
      'insufficient allowance'
    );

    await token.connect(user).approve(stakingAddress, 40n);

    await expect(staking.connect(user).stake(100n)).to.be.revertedWith(
      'insufficient allowance'
    );
  });

  it('reverts if the stake amount is zero', async function () {
    const { user, staking } = await deployStaking();

    await expect(staking.connect(user).stake(0)).to.be.revertedWith(
      'stake amount must be > 0'
    );
  });

  it('splits rewards based on time and stake size', async function () {
    const { user, secondUser, token, staking, stakingAddress } =
      await deployStaking();

    await token.connect(user).approve(stakingAddress, 100n);
    const firstStakeTx = await staking.connect(user).stake(100n);
    const firstStakeTime = await getTimestamp(firstStakeTx.hash);

    await moveTime(10);

    await token.connect(secondUser).approve(stakingAddress, 100n);
    const secondStakeTx = await staking.connect(secondUser).stake(100n);
    const secondStakeTime = await getTimestamp(secondStakeTx.hash);

    await moveTime(10);

    const latestBlock = await ethers.provider.getBlock('latest');
    if (!latestBlock) {
      throw new Error('latest block not found');
    }

    const endTime = BigInt(latestBlock.timestamp);
    const firstPeriod = secondStakeTime - firstStakeTime;
    const secondPeriod = endTime - secondStakeTime;

    const firstUserExpected =
      rewardRate * firstPeriod + (rewardRate * secondPeriod) / 2n;
    const secondUserExpected = (rewardRate * secondPeriod) / 2n;

    expect(await staking.earned(user.address)).to.equal(firstUserExpected);
    expect(await staking.earned(secondUser.address)).to.equal(
      secondUserExpected
    );
  });

  it('lets a user claim rewards without withdrawing', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await token.connect(user).approve(stakingAddress, 200n);
    await staking.connect(user).stake(200n);

    await moveTime(12);

    const balanceBefore = await token.balanceOf(user.address);
    const stakedBefore = await staking.stakedBalance(user.address);
    const rewardBefore = await staking.earned(user.address);

    await expect(staking.connect(user).claimRewards()).to.emit(
      staking,
      'RewardClaimed'
    );

    const balanceAfter = await token.balanceOf(user.address);

    expect(await staking.stakedBalance(user.address)).to.equal(stakedBefore);
    expect(await staking.rewards(user.address)).to.equal(0n);
    expect(balanceAfter - balanceBefore).to.be.greaterThanOrEqual(rewardBefore);
  });

  it('burns receipt tokens when a user withdraws', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await token.connect(user).approve(stakingAddress, 150n);
    await staking.connect(user).stake(150n);

    await expect(staking.connect(user).withdraw(60n))
      .to.emit(staking, 'Withdrawn')
      .withArgs(user.address, 60n);

    expect(await staking.balanceOf(user.address)).to.equal(90n);
    expect(await staking.stakedBalance(user.address)).to.equal(90n);
    expect(await staking.totalSupply()).to.equal(90n);
    expect(await token.balanceOf(user.address)).to.equal(910n);
  });

  it('stops adding rewards after a full withdrawal', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await token.connect(user).approve(stakingAddress, 100n);
    await staking.connect(user).stake(100n);

    await moveTime(10);

    await staking.connect(user).withdraw(100n);

    const rewardAfterWithdraw = await staking.rewards(user.address);
    await moveTime(10);

    expect(await staking.stakedBalance(user.address)).to.equal(0n);
    expect(await staking.balanceOf(user.address)).to.equal(0n);
    expect(await staking.earned(user.address)).to.equal(rewardAfterWithdraw);
  });

  it('moves receipt tokens and lets the new holder withdraw', async function () {
    const { user, secondUser, token, staking, stakingAddress } =
      await deployStaking();

    await token.connect(user).approve(stakingAddress, 100n);
    await staking.connect(user).stake(100n);

    await expect(staking.connect(user).transfer(secondUser.address, 40n))
      .to.emit(staking, 'Transfer')
      .withArgs(user.address, secondUser.address, 40n);

    expect(await staking.balanceOf(user.address)).to.equal(60n);
    expect(await staking.balanceOf(secondUser.address)).to.equal(40n);

    await expect(staking.connect(user).withdraw(61n)).to.be.revertedWith(
      'withdraw exceeds stake'
    );

    const secondUserBalanceBefore = await token.balanceOf(secondUser.address);
    await staking.connect(secondUser).withdraw(40n);

    expect(await token.balanceOf(secondUser.address)).to.equal(
      secondUserBalanceBefore + 40n
    );
    expect(await staking.balanceOf(secondUser.address)).to.equal(0n);
    expect(await staking.stakedBalance(user.address)).to.equal(60n);
  });

  it('does not allow withdrawing more than the stake', async function () {
    const { user, token, staking, stakingAddress } = await deployStaking();

    await token.connect(user).approve(stakingAddress, 100n);
    await staking.connect(user).stake(100n);

    await expect(staking.connect(user).withdraw(101n)).to.be.revertedWith(
      'withdraw exceeds stake'
    );
  });
});
