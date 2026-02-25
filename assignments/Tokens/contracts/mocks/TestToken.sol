// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract TestToken {
  string public name;
  string public symbol;
  uint8 public constant decimals = 18;
  uint256 public totalSupply;

  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  constructor(string memory tokenName, string memory tokenSymbol) {
    name = tokenName;
    symbol = tokenSymbol;
  }

  function mint(address to, uint256 amount) external returns (bool) {
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
    return true;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: insufficient allowance");
    allowance[from][msg.sender] = currentAllowance - amount;

    _transfer(from, to, amount);
    return true;
  }

  function _transfer(address from, address to, uint256 amount) internal {
    uint256 fromBalance = balanceOf[from];
    require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");

    balanceOf[from] = fromBalance - amount;
    balanceOf[to] += amount;

    emit Transfer(from, to, amount);
  }
}
