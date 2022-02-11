const { networkConfig, autoFundCheck, developmentChains } = require('../../helper-hardhat-config')
//const skipIf = require('mocha-skip-if')
//const chai = require('chai')
const { expect } = require('chai')
//const BN = require('bn.js')
//chai.use(require('chai-bn')(BN))
const { BigNumber } = require('ethers')
const BN = BigNumber


//skip.if(!developmentChains.includes(network.name)).
describe('RandomNumberConsumer Contract', async function () {
  let randomNumberConsumer, linkToken, vrfCoordinatorMock, provider
  let owner, addr1, addr2, addr3, addr4

  beforeEach(async () => {
    [owner, addr1, addr2, addr3, addr4, _] = await ethers.getSigners()
    provider = waffle.provider

    console.log("------------------------------------------------------------------------")

    const chainId = await getChainId()
    const networkName = networkConfig[chainId]['name']
    await deployments.fixture(['mocks', 'vrf'])

    const LinkToken = await deployments.get('LinkToken')
    linkToken = await ethers.getContractAt('LinkToken', LinkToken.address)

    const RandomNumberConsumer = await deployments.get('RandomNumberConsumer')
    randomNumberConsumer = await ethers.getContractAt('RandomNumberConsumer', RandomNumberConsumer.address)

    const VRFCoordinatorMock = await deployments.get('VRFCoordinatorMock')
    vrfCoordinatorMock = await ethers.getContractAt('VRFCoordinatorMock', VRFCoordinatorMock.address)

    // fund contract with LINK
    if (await autoFundCheck(randomNumberConsumer.address, networkName, linkToken.address)) {
      await hre.run("fund-link", { contract: randomNumberConsumer.address, linkaddress: linkToken.address})
    }

    // fund contract with ETH
    await owner.sendTransaction({to:randomNumberConsumer.address,value:ethers.utils.parseEther("1.0")})
  })

  describe('Contract functionality', async () => {

    it('Should have valid functionality for owner to remove funds', async () => {
      const ownerBeforeFunds = await provider.getBalance(owner.address)
      const contractBeforeFunds = await provider.getBalance(randomNumberConsumer.address)

      let tx = await randomNumberConsumer.connect(owner).removeFunds(ethers.utils.parseEther("0.5"))

      const ownerAfterFunds = await provider.getBalance(owner.address)
      const contractAfterFunds = await provider.getBalance(randomNumberConsumer.address)

      expect(ownerAfterFunds).to.be.above(ownerBeforeFunds)
      expect(contractAfterFunds).to.equal(ethers.utils.parseEther("1.0").div(2))

      // should not be able to withdraw more than the contract holds
      await expect(randomNumberConsumer.connect(owner).removeFunds(ethers.utils.parseEther("1.0").add(1))).to.be.reverted

      // other users should not be able to remove funds
      await expect(randomNumberConsumer.connect(addr1).removeFunds(ethers.utils.parseEther("0.1"))).to.be.reverted
    }) 


    it('Should update counter when funds are provided to contract', async () => {
      let currentFunds = await provider.getBalance(randomNumberConsumer.address)
      let currentAvailableFunds = await randomNumberConsumer.availableFundsToGamble()
      expect(currentFunds).to.equal(currentAvailableFunds)

      await randomNumberConsumer.connect(owner).removeFunds(ethers.utils.parseEther("0.5"))
      currentFunds = await provider.getBalance(randomNumberConsumer.address)
      currentAvailableFunds = await randomNumberConsumer.availableFundsToGamble()
    })


    it('Should not allow user to gamble when they have invalid inputs', async () => {
      await expect(randomNumberConsumer.connect(addr1).gamble(0,{value:0})).to.be.revertedWith('User bet is invalid.')
      await expect(randomNumberConsumer.connect(addr1).gamble(0,{value:100})).to.be.revertedWith('Invalid input for winner type.')
      await expect(randomNumberConsumer.connect(addr1).gamble(1,{value:0})).to.be.revertedWith('User bet is invalid.')
    })


    it('Should allow user to successfully gamble when inputs are valid', async () => {
      // performing gambling transaction and checking for the emitted event
      let ethAmount = ethers.utils.parseEther("0.1")
      let tx = await randomNumberConsumer.connect(addr1).gamble(2, {value:ethAmount})
      let receipt = await tx.wait()
      let events = receipt.events?.filter((x) => {return x.event == "ChainlinkRequested"})
      let requestId = events[0]['args']['requestId']
      let sender = events[0]['args']['sender']
      let bet = await randomNumberConsumer.bets(requestId)

      expect(bet[0]).to.equal(ethAmount) // first index of Bet struct is amount bet
      expect(bet[1]).to.equal(2) // second index is betOn
      expect(bet[2]).to.equal(addr1.address) // third index is user address

      // check that available funds to gamble has decreased
      expect(await randomNumberConsumer.availableFundsToGamble()).to.equal(ethers.utils.parseEther("1.0").sub(ethAmount))

      let randomRequestId = "0x211f54d247f5c490e38753da457d612a92f7168b269d187aed0e63bc93b50e37"
      bet = await randomNumberConsumer.bets(randomRequestId)
      expect(bet[0]).to.equal(0) // this should be empty data
    })


    it('Should allow user to claim funds when they win', async () => {
      let ethAmount = ethers.utils.parseEther("0.1")
      let tx = await randomNumberConsumer.connect(addr1).gamble(2, {value:ethAmount})
      let receipt = await tx.wait()
      let events = receipt.events?.filter((x) => {return x.event == "ChainlinkRequested"})
      let requestId = events[0]['args']['requestId']

      expect(await randomNumberConsumer.amountDue(addr1.address)).to.equal(0) // initially the user is owed no funds
      await expect(randomNumberConsumer.connect(addr1).requestFunds()).to.be.reverted

      let startAvailableFunds = await randomNumberConsumer.availableFundsToGamble()
      let randomNumber = 39 // user wins with num <= 39
      await expect(vrfCoordinatorMock.callBackWithRandomness(requestId, randomNumber, randomNumberConsumer.address)).to.emit(randomNumberConsumer,"ChainlinkFulfilled").withArgs(requestId, true, 2, addr1.address)
      expect(await randomNumberConsumer.availableFundsToGamble()).to.equal(startAvailableFunds) // contract loses funds
      
      expect(await randomNumberConsumer.amountDue(addr1.address)).to.equal(ethAmount.mul(2)) // user wins, & so is owed funds
      expect(await provider.getBalance(randomNumberConsumer.address)).to.equal(startAvailableFunds.add(ethAmount.mul(2)))
      
      // user requesting their winnings
      expect(await randomNumberConsumer.amountDue(addr1.address)).to.equal(ethAmount.mul(2))
      let userStartFunds = await provider.getBalance(addr1.address)
      await randomNumberConsumer.connect(addr1).requestFunds()
      expect(await provider.getBalance(addr1.address)).to.be.above(userStartFunds)
      expect(await randomNumberConsumer.amountDue(addr1.address)).to.equal(0)
      expect(await provider.getBalance(randomNumberConsumer.address)).to.equal(startAvailableFunds)
    })


    it('Should handle the case when house wins', async () => {
      let ethAmount = ethers.utils.parseEther("0.1")
      let tx = await randomNumberConsumer.connect(addr1).gamble(2, {value:ethAmount})
      let receipt = await tx.wait()
      let events = receipt.events?.filter((x) => {return x.event == "ChainlinkRequested"})
      let requestId = events[0]['args']['requestId']

      let startAvailableFunds = await randomNumberConsumer.availableFundsToGamble()
      let randomNumber = 40 // user wins with num <= 39
      await expect(vrfCoordinatorMock.callBackWithRandomness(requestId, randomNumber, randomNumberConsumer.address)).to.emit(randomNumberConsumer,"ChainlinkFulfilled").withArgs(requestId, false, 2, addr1.address)
      expect(await randomNumberConsumer.availableFundsToGamble()).to.equal(startAvailableFunds.add(ethAmount.mul(2))) // contract gains funds

      await expect(randomNumberConsumer.connect(addr1).requestFunds()).to.be.revertedWith("User owed no funds.")
      expect(await randomNumberConsumer.amountDue(addr1.address)).to.equal(0)
      let bet = await randomNumberConsumer.bets(requestId)
      expect(bet[0]).to.equal(0)
    })


    it('Should handle availableFundsToGamble correctly when multiple users gamble in same block', async () => {
      let ethAmount1 = ethers.utils.parseEther("0.5")
      let ethAmount2 = ethers.utils.parseEther("0.25")
      let ethAmount3 = ethers.utils.parseEther("0.125")

      provider.send("evm_setAutomine", [false]) // allow multiple transactions to be included in this block

      await randomNumberConsumer.connect(addr1).gamble(2, {value:ethAmount1})
      let tx2 = await randomNumberConsumer.connect(addr2).gamble(2, {value:ethAmount2.add(1)}) // this should fail
      await provider.send("evm_mine")
      expect(await randomNumberConsumer.availableFundsToGamble()).to.equal(ethAmount1)

      await randomNumberConsumer.connect(addr2).gamble(2, {value:ethAmount2})
      await randomNumberConsumer.connect(addr3).gamble(2, {value:ethAmount3}) // these should both pass
      await provider.send("evm_mine")
      expect(await randomNumberConsumer.availableFundsToGamble()).to.equal(ethAmount3)
    })

  })

})
