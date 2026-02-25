// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IERC20 {
  function allowance(address owner, address spender) external view returns (uint256);

  function transfer(address to, uint256 amount) external returns (bool);

  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract StakingRewards {
  IERC20 public immutable stakingToken;
  address public owner;
  uint256 public rewardRate;
  uint256 public lastUpdateTime;
  uint256 public rewardPerTokenStored;

  mapping(address => uint256) public stakedBalance;
  uint256 public totalStaked;
  mapping(address => uint256) public userRewardPerTokenPaid;
  mapping(address => uint256) public rewards;

  event Staked(address indexed user, uint256 amount);
  event Withdrawn(address indexed user, uint256 amount);
  event RewardClaimed(address indexed user, uint256 reward);
  event RewardsFunded(address indexed funder, uint256 amount);
  event RewardRateUpdated(uint256 newRate);

  constructor(address tokenAddress, uint256 initialRewardRate) {
    require(tokenAddress != address(0), "invalid token address");
    require(initialRewardRate > 0, "reward rate must be > 0");
    stakingToken = IERC20(tokenAddress);
    owner = msg.sender;
    rewardRate = initialRewardRate;
    lastUpdateTime = block.timestamp;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "only owner");
    _;
  }

  function _updateReward(address account) internal {
    rewardPerTokenStored = rewardPerToken();
    lastUpdateTime = block.timestamp;

    if (account != address(0)) {
      rewards[account] = earned(account);
      userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
  }

  function rewardPerToken() public view returns (uint256) {
    if (totalStaked == 0) {
      return rewardPerTokenStored;
    }

    uint256 timeElapsed = block.timestamp - lastUpdateTime;
    return rewardPerTokenStored + ((timeElapsed * rewardRate * 1e18) / totalStaked);
  }

  function earned(address account) public view returns (uint256) {
    uint256 paid = userRewardPerTokenPaid[account];
    uint256 currentRewardPerToken = rewardPerToken();
    uint256 pending = (stakedBalance[account] * (currentRewardPerToken - paid)) / 1e18;
    return rewards[account] + pending;
  }

  function setRewardRate(uint256 newRewardRate) external onlyOwner {
    _updateReward(address(0));
    require(newRewardRate > 0, "reward rate must be > 0");
    rewardRate = newRewardRate;
    emit RewardRateUpdated(newRewardRate);
  }

  function fundRewards(uint256 amount) external {
    require(amount > 0, "fund amount must be > 0");
    bool transferred = stakingToken.transferFrom(msg.sender, address(this), amount);
    require(transferred, "fund transfer failed");
    emit RewardsFunded(msg.sender, amount);
  }

  function stake(uint256 amount) external {
    _updateReward(msg.sender);
    require(amount > 0, "stake amount must be > 0");

    uint256 approvedAmount = stakingToken.allowance(msg.sender, address(this));
    require(approvedAmount >= amount, "insufficient allowance");

    bool transferred = stakingToken.transferFrom(msg.sender, address(this), amount);
    require(transferred, "transfer failed");

    stakedBalance[msg.sender] += amount;
    totalStaked += amount;

    emit Staked(msg.sender, amount);
  }

  function withdraw(uint256 amount) external {
    require(amount > 0, "withdraw amount must be > 0");
    uint256 userStake = stakedBalance[msg.sender];
    require(userStake >= amount, "withdraw exceeds stake");

    // Snapshot rewards at the pre-withdraw stake level.
    _updateReward(msg.sender);

    stakedBalance[msg.sender] = userStake - amount;
    totalStaked -= amount;

    bool transferred = stakingToken.transfer(msg.sender, amount);
    require(transferred, "withdraw transfer failed");

    emit Withdrawn(msg.sender, amount);
  }

  function claimRewards() external {
    _updateReward(msg.sender);
    uint256 earnedRewards = rewards[msg.sender];
    require(earnedRewards > 0, "no rewards to claim");

    rewards[msg.sender] = 0;
    bool transferred = stakingToken.transfer(msg.sender, earnedRewards);
    require(transferred, "reward transfer failed");

    emit RewardClaimed(msg.sender, earnedRewards);
  }
}
