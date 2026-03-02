// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IERC20 {
  function allowance(address owner, address spender) external view returns (uint256);

  function transfer(address to, uint256 amount) external returns (bool);

  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract StakingRewards {
  string public constant name = "Staked Receipt Token";
  string public constant symbol = "sSTK";
  uint8 public constant decimals = 18;

  IERC20 public immutable stakingToken;
  address public owner;
  uint256 public rewardRate;
  uint256 public lastUpdateTime;
  uint256 public rewardPerTokenStored;

  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  mapping(address => uint256) public userRewardPerTokenPaid;
  mapping(address => uint256) public rewards;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);
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

  function rewardPerToken() public view returns (uint256) {
    if (totalSupply == 0) {
      return rewardPerTokenStored;
    }

    uint256 secondsPassed = block.timestamp - lastUpdateTime;
    uint256 extraRewardPerToken = (secondsPassed * rewardRate * 1e18) / totalSupply;

    return rewardPerTokenStored + extraRewardPerToken;
  }

  function earned(address account) public view returns (uint256) {
    uint256 rewardDifference = rewardPerToken() - userRewardPerTokenPaid[account];
    uint256 newRewards = (balanceOf[account] * rewardDifference) / 1e18;

    return rewards[account] + newRewards;
  }

  function updateReward(address account) internal {
    rewardPerTokenStored = rewardPerToken();
    lastUpdateTime = block.timestamp;

    if (account != address(0)) {
      rewards[account] = earned(account);
      userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
  }

  function stakedBalance(address account) public view returns (uint256) {
    return balanceOf[account];
  }

  function totalStaked() public view returns (uint256) {
    return totalSupply;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    updateReward(msg.sender);
    updateReward(to);
    _transferReceipt(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: insufficient allowance");
    allowance[from][msg.sender] = currentAllowance - amount;

    updateReward(from);
    updateReward(to);
    _transferReceipt(from, to, amount);
    return true;
  }

  function setRewardRate(uint256 newRewardRate) external onlyOwner {
    require(newRewardRate > 0, "reward rate must be > 0");
    updateReward(address(0));
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
    require(amount > 0, "stake amount must be > 0");
    updateReward(msg.sender);

    uint256 approvedAmount = stakingToken.allowance(msg.sender, address(this));
    require(approvedAmount >= amount, "insufficient allowance");

    bool transferred = stakingToken.transferFrom(msg.sender, address(this), amount);
    require(transferred, "transfer failed");

    _mintReceipt(msg.sender, amount);
    emit Staked(msg.sender, amount);
  }

  function withdraw(uint256 amount) external {
    require(amount > 0, "withdraw amount must be > 0");
    uint256 userStake = balanceOf[msg.sender];
    require(userStake >= amount, "withdraw exceeds stake");

    updateReward(msg.sender);

    _burnReceipt(msg.sender, amount);

    bool transferred = stakingToken.transfer(msg.sender, amount);
    require(transferred, "withdraw transfer failed");

    emit Withdrawn(msg.sender, amount);
  }

  function claimRewards() external {
    updateReward(msg.sender);
    uint256 earnedRewards = rewards[msg.sender];
    require(earnedRewards > 0, "no rewards to claim");

    rewards[msg.sender] = 0;
    bool transferred = stakingToken.transfer(msg.sender, earnedRewards);
    require(transferred, "reward transfer failed");

    emit RewardClaimed(msg.sender, earnedRewards);
  }

  function _transferReceipt(address from, address to, uint256 amount) internal {
    require(to != address(0), "invalid recipient");

    uint256 fromBalance = balanceOf[from];
    require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");

    balanceOf[from] = fromBalance - amount;
    balanceOf[to] += amount;

    emit Transfer(from, to, amount);
  }

  function _mintReceipt(address to, uint256 amount) internal {
    require(to != address(0), "invalid recipient");

    balanceOf[to] += amount;
    totalSupply += amount;

    emit Transfer(address(0), to, amount);
  }

  function _burnReceipt(address from, uint256 amount) internal {
    uint256 fromBalance = balanceOf[from];
    require(fromBalance >= amount, "burn exceeds balance");

    balanceOf[from] = fromBalance - amount;
    totalSupply -= amount;

    emit Transfer(from, address(0), amount);
  }
}
