import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("StakingRewards", function () {
  const REWARD_RATE = 10n;

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function blockTimestamp(txHash: string) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (!receipt) throw new Error("missing transaction receipt");
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    if (!block) throw new Error("missing block");
    return BigInt(block.timestamp);
  }

  async function deployFixture() {
    const [owner, user, secondUser] = await ethers.getSigners();
    const token = await ethers.deployContract("TestToken", ["Stake Token", "STK"]);
    const staking = await ethers.deployContract("StakingRewards", [
      await token.getAddress(),
      REWARD_RATE,
    ]);

    await token.mint(owner.address, 100_000n);
    await token.mint(user.address, 1_000n);
    await token.mint(secondUser.address, 1_000n);

    await token.approve(await staking.getAddress(), 50_000n);
    await staking.fundRewards(50_000n);

    return { owner, user, secondUser, token, staking };
  }

  it("stakes tokens and updates accounting", async function () {
    const { user, token, staking } = await deployFixture();
    const stakeAmount = 250n;
    const contractBalanceBefore = await token.balanceOf(await staking.getAddress());

    await token.connect(user).approve(await staking.getAddress(), stakeAmount);

    await expect(staking.connect(user).stake(stakeAmount))
      .to.emit(staking, "Staked")
      .withArgs(user.address, stakeAmount);

    expect(await token.balanceOf(user.address)).to.equal(750n);
    expect(await token.balanceOf(await staking.getAddress())).to.equal(
      contractBalanceBefore + stakeAmount,
    );
    expect(await staking.stakedBalance(user.address)).to.equal(stakeAmount);
    expect(await staking.totalStaked()).to.equal(stakeAmount);
  });

  it("reverts when there is no prior approval", async function () {
    const { user, staking } = await deployFixture();
    const stakeAmount = 100n;

    await expect(staking.connect(user).stake(stakeAmount)).to.be.revertedWith(
      "insufficient allowance",
    );
  });

  it("reverts when approval is smaller than the stake amount", async function () {
    const { user, token, staking } = await deployFixture();

    await token.connect(user).approve(await staking.getAddress(), 40n);

    await expect(staking.connect(user).stake(100n)).to.be.revertedWith(
      "insufficient allowance",
    );
  });

  it("reverts when amount is zero", async function () {
    const { user, staking } = await deployFixture();

    await expect(staking.connect(user).stake(0)).to.be.revertedWith(
      "stake amount must be > 0",
    );
  });

  it("accrues rewards over time and distributes proportionally to stake", async function () {
    const { user, secondUser, token, staking } = await deployFixture();
    const userStake = 100n;

    await token.connect(user).approve(await staking.getAddress(), userStake);
    const firstStakeTx = await staking.connect(user).stake(userStake);
    const firstStakeTime = await blockTimestamp(firstStakeTx.hash);

    await increaseTime(10);

    await token.connect(secondUser).approve(await staking.getAddress(), userStake);
    const secondStakeTx = await staking.connect(secondUser).stake(userStake);
    const secondStakeTime = await blockTimestamp(secondStakeTx.hash);

    await increaseTime(10);
    const latestBlock = await ethers.provider.getBlock("latest");
    if (!latestBlock) throw new Error("missing latest block");
    const finalTime = BigInt(latestBlock.timestamp);

    const firstInterval = secondStakeTime - firstStakeTime;
    const secondInterval = finalTime - secondStakeTime;

    const expectedUserReward = (REWARD_RATE * firstInterval) + ((REWARD_RATE * secondInterval) / 2n);
    const expectedSecondUserReward = (REWARD_RATE * secondInterval) / 2n;

    expect(await staking.earned(user.address)).to.equal(expectedUserReward);
    expect(await staking.earned(secondUser.address)).to.equal(expectedSecondUserReward);
    expect(await staking.earned(user.address)).to.be.greaterThan(
      await staking.earned(secondUser.address),
    );
  });

  it("allows claiming rewards without withdrawing stake", async function () {
    const { user, token, staking } = await deployFixture();
    const stakeAmount = 200n;

    await token.connect(user).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(user).stake(stakeAmount);

    await increaseTime(12);

    const userBalanceBefore = await token.balanceOf(user.address);
    const stakedBeforeClaim = await staking.stakedBalance(user.address);
    const pendingBeforeClaim = await staking.earned(user.address);

    await expect(staking.connect(user).claimRewards()).to.emit(staking, "RewardClaimed");

    const userBalanceAfter = await token.balanceOf(user.address);
    const claimedAmount = userBalanceAfter - userBalanceBefore;

    expect(await staking.stakedBalance(user.address)).to.equal(stakedBeforeClaim);
    expect(await staking.rewards(user.address)).to.equal(0n);
    expect(claimedAmount).to.be.greaterThanOrEqual(pendingBeforeClaim);
  });

  it("stops reward accumulation after full withdrawal", async function () {
    const { user, token, staking } = await deployFixture();
    const stakeAmount = 100n;

    await token.connect(user).approve(await staking.getAddress(), stakeAmount);
    await staking.connect(user).stake(stakeAmount);

    await increaseTime(10);

    await staking.connect(user).withdraw(stakeAmount);
    expect(await staking.stakedBalance(user.address)).to.equal(0n);
    const rewardAtWithdraw = await staking.rewards(user.address);

    await increaseTime(10);
    const rewardAfterDelay = await staking.earned(user.address);

    expect(rewardAfterDelay).to.equal(rewardAtWithdraw);
  });

  it("prevents over-withdrawal", async function () {
    const { user, token, staking } = await deployFixture();

    await token.connect(user).approve(await staking.getAddress(), 100n);
    await staking.connect(user).stake(100n);

    await expect(staking.connect(user).withdraw(101n)).to.be.revertedWith(
      "withdraw exceeds stake",
    );
  });
});
