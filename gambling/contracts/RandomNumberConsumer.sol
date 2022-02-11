// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/// @notice contract encapsulates logic for gambling
contract RandomNumberConsumer is VRFConsumerBase,Ownable {
    bytes32 internal keyHash;
    uint256 internal fee;
    uint256 public threshold; // threshold for house win

    struct Bet {
        uint128 amount; // bet amount (hard cap for the amount to bet)
        uint128 betOn; // 1 or 2 (which class the user bet on)
        address user; // user who made this bet
    }

    /// @dev stores the bets made by each user (using requestId as key)
    mapping(bytes32 => Bet) public bets;
    
    /// @dev this is for simplicity, not required
    mapping(address => uint256) public amountDue;

    /// @dev a new user can only bet up to 1/2 of the available funds that this contract holds
    /// @dev available funds defined to be the balance of this contract minus funds tied up in bets
    uint256 public availableFundsToGamble;

    /// @dev events are used to announce the winner
    /// @param betOn represents turtles 1,2
    /// @param winner (bool) represents whether user won
    event ChainlinkFulfilled(bytes32 requestId, bool winner, uint128 indexed betOn, address indexed sender);
    event ChainlinkRequested(bytes32 requestId, address indexed sender);

    constructor(
        address _vrfCoordinator,
        address _linkToken,
        bytes32 _keyHash,
        uint256 _fee
    ) VRFConsumerBase(_vrfCoordinator,_linkToken) {
        keyHash = _keyHash;
        fee = _fee;
        threshold = 40;
    }

    /// @notice sets the winning threshold for the house
    /// @dev only contract owner is able to change threshold
    function setThreshold(uint256 _threshold) external onlyOwner {
        threshold = _threshold;
    }

    /// @notice removes set amount of funds from this contract
    /// @dev only allow withdrawal of funds not tied up in bets
    function removeFunds(uint256 _amount) external onlyOwner {
        require(availableFundsToGamble >= _amount, "Invalid amount.");
        availableFundsToGamble -= _amount;
        (bool success,) = msg.sender.call{value:_amount}("");
        require(success,"Transfer failed.");
    }

    /// @dev used to supply contract with funds
    receive() external payable {
        availableFundsToGamble += msg.value;
    }

    /// @notice begins the gambling process
    /// @dev checks that user does not have another concurrent bet & bet is valid amount
    /// @param _betOn specifies which class the user has predicted to win (included for displaying history)
    function gamble(uint128 _betOn) external payable {
        require(msg.value > 0 && msg.value <= availableFundsToGamble/2, "User bet is invalid.");
        require(_betOn == 1 || _betOn == 2, "Invalid input for winner type."); // user can spoof this

        bytes32 requestId = getChainlinkRandomNumber();
        emit ChainlinkRequested(requestId, msg.sender);

        bets[requestId] = Bet(uint128(msg.value), _betOn, msg.sender);
        availableFundsToGamble -= msg.value;
    }

    /// @notice requests random number from chainlink
    function getChainlinkRandomNumber() internal returns (bytes32) {
        require(LINK.balanceOf(address(this)) >= fee, "Contract lacks LINK funds.");
        return requestRandomness(keyHash, fee); // function defined by VRF contract
    }

    /// @notice callback function to fulfill chainlink randomness (for a given bet)
    function fulfillRandomness(bytes32 _requestId, uint256 _randomness) internal override {
        address user = bets[_requestId].user;
        uint128 betOn = bets[_requestId].betOn;
        uint256 winValue = uint256(bets[_requestId].amount);

        if (_randomness%100 < threshold) { // user wins
            bets[_requestId] = Bet(0,0,address(0));
            amountDue[user]=2*winValue;
            emit ChainlinkFulfilled(_requestId, true, betOn, user);
        } else { // house wins
            bets[_requestId] = Bet(0,0,address(0));
            availableFundsToGamble += 2*winValue; // add amount won from user to available funds
            emit ChainlinkFulfilled(_requestId, false, betOn, user);
        }
    }

    /// @notice allows users to claim the funds they won
    function requestFunds() external {
        uint256 amountWon = amountDue[msg.sender];
        require(amountWon > 0, "User owed no funds.");
        amountDue[msg.sender] = 0;
        (bool success,) = msg.sender.call{value:amountWon}("");
        require(success,"Transfer failed.");
    }

}
