const app = Vue.createApp({
  methods: {
    // methods to handle when user is attemping to connect their wallet
    async connectWallet() {
      try {
        this.abi = rnc.abi
        this.contractAddress = rnc.address

        const provider = new ethers.providers.Web3Provider(window.ethereum)
        const chainInfo = await provider.getNetwork()

        if (chainInfo.name !== "rinkeby") {
          this.walletText = "Must use Rinkeby"
          return
        }

        await provider.send("eth_requestAccounts", []) // Prompt user for account connection
        const signer = provider.getSigner()
        const address = await signer.getAddress()

        window.walletInfo = {} // global storage object
        window.walletInfo.provider = provider
        window.walletInfo.signer = signer
        window.walletInfo.address = address
        window.walletInfo.chainInfo = chainInfo

        let text = address.substring(0,6)+"..."+address.substring(address.length-4,address.length)
        this.walletText = text

        contract = this.instantiateContract()
        window.walletInfo.contract = contract

        // setting information in the table
        await this.setPoolBalance()
        await this.setWinnerAndStreak()
        await this.setWinPercentage()
          
        // adding event handlers
        await this.addEventHandlers()

        // set user owed funds amount in UI
        await this.getUserOwedFunds()

        console.log()
        

        this.validWallet=true // valid wallet attached
      } catch(error) { // user didn't connect metamask
        this.walletText = "No wallet detected"
        console.log(error)
      }
    },
    // instantiates and stores contract object
    instantiateContract() {
      let contract = new ethers.Contract(this.contractAddress, this.abi, window.walletInfo.signer)
      return contract
    },
    // returns the balance of a given address in ETH
    async getBalance(address) {
      let balance = await window.walletInfo.provider.getBalance(address)
      return balance
    },
    // sets the poolAmount for the gambling contract
    async setPoolBalance() {
      let balance = await window.walletInfo.contract.availableFundsToGamble() //await this.getBalance(this.contractAddress)
      balance = ethers.utils.formatEther(balance)
      this.poolAmountNumber = parseFloat(balance)
    },
    // gets the winner from the ChainlinkFulfilled event
    getLastWinner(result) {
      let betOn = result.args[2].toNumber()
      let otherBetOn
      if (betOn === 1) {otherBetOn=2} else {otherBetOn=1}
      let winner 
      if (result.args[1] === true) {winner=betOn} else {winner=otherBetOn}
      return winner
    },
    // sets information on last winner and win streak
    async setWinnerAndStreak() {
      let filter = window.walletInfo.contract.filters.ChainlinkFulfilled(null,null,null,null)
      let results = await contract.queryFilter(filter)

      let winStreak=1
      let lastWinner = this.getLastWinner(results[results.length-1])

      for (let i=results.length-2; i>=0; i--) {
        let thisWinner = this.getLastWinner(results[i])
        if (thisWinner === lastWinner) {
          winStreak++
        } else {
          break
        }
      }
      this.lastWinner = "Turtle "+lastWinner.toString()
      this.winStreak = winStreak.toString()+" win(s)"
    },
    // sets the win percentage for the user
    async setWinPercentage() {
      let filter = window.walletInfo.contract.filters.ChainlinkFulfilled(null,null,null,window.walletInfo.address)
      let results = await contract.queryFilter(filter)
      
      if (results.length === 0) { return }

      let numWins=0
      for (let i=0; i<results.length; i++) {
        if (results[i].args[1] === true) {
          numWins++
        }
      }
      this.winPercentage = (numWins/results.length).toString().substring(0,6)
    },
    // functionality for when the user presses the gamble button
    async handleGamble() {
      // check if valid wallet attached:
      if (!this.validWallet) {
        return
      }

      // check if the selected turtle is valid:
      let turtlePicked = this.turtlePicked.trim() 
      let turtleRe = new RegExp("^[1|2]$")
      if (!turtleRe.test(turtlePicked)) { // there is an error
        let turtleNode = document.getElementById("turtle-pick")
        turtleNode.setCustomValidity('Select a valid turtle (1 or 2)')
        turtleNode.reportValidity()
        return
      }

      // check if the inputted value is valid:
      let maxValue = this.poolAmountNumber/2 // cannot bet more than 1/2 pool
      let nodeValue = this.amountGambled.trim()
      let amountRe = new RegExp("^[0-9]*([.][0-9]{1,18})?$")
      let amountNode = document.getElementById("amount")
      let amountBet // this is denominated in ETH
      if (!amountRe.test(nodeValue) || nodeValue=="") { // there is an error
        amountNode.setCustomValidity('Input a valid number.')
        amountNode.reportValidity()
        return
      } else {
        amountBet = parseFloat(nodeValue)
        if (amountBet > maxValue) {
          amountNode.setCustomValidity('Input is more than 1/2 pool.')
          amountNode.reportValidity()
          return
        }
      }

      // start the gambling process assuming the inputs to be correct
      try {
        let amountBetWei = ethers.BigNumber.from(Math.floor(amountBet*(10**18)).toString())
        await window.walletInfo.contract.gamble(parseInt(turtlePicked),{value:amountBetWei})
        this.userGambled = true
        this.popupMessage = "Gambling has been initiated. Waiting for the race to begin (~5 minutes)."
      } catch(error) {
        console.log(error)
      }
    },
    // adds the three events listeners for updating UI
    async addEventHandlers() {
      window.walletInfo.contract.on("ChainlinkRequested", async (requestId,sender) => { await this.updateChainlinkRequested() })
      window.walletInfo.contract.on("ChainlinkFulfilled", async (requestId,winner,betOn,sender) => { await this.updateChainlinkFulfilledGeneral() })
      window.walletInfo.contract.on("ChainlinkFulfilled", async (requestId,winner,betOn,sender) => { await this.updateChainlinkFulfilledUserSpecific(sender,winner,betOn) })
    },
    // event listener for when someone initiates the gambling flow
    async updateChainlinkRequested() {
      await this.setPoolBalance()
    },
    // event listener for when VRF returns, for all users
    async updateChainlinkFulfilledGeneral() {
      await this.setPoolBalance()
      await this.setWinnerAndStreak()
    },
    // event listener for when VRF returns for this specific user
    async updateChainlinkFulfilledUserSpecific(sender,winner,betOn) {
      if (sender === window.walletInfo.address) {
        this.runGameAnimation(winner,betOn)
        await this.setWinPercentage()
      }
    },
    // starts animation for turtle and street movement
    movingAnimation() {
      document.getElementById("turtle1").style.bottom = "0px"
      document.getElementById("turtle2").style.bottom = "0px"

      let streetId = null // street animation
      let i = 1  
      streetId = setInterval(function() {
        document.getElementById("street").src="./static/img/streets/street_"+i+".png"
        i ++
        if (i==11)
          i=1
      }, 60)

      let turtleId = null // turtle animation
      let j = 1  
      turtleId = setInterval(function() {
        document.getElementById("turtle1").src="./static/img/turtles/turtle_1_"+j+".png"
        document.getElementById("turtle2").src="./static/img/turtles/turtle_2_"+j+".png"
        j ++
        if (j==3)
          j=1
      }, 60)

      return [streetId,turtleId] // used to remove this animation later
    },
    // starts the racing animation
    racingAnimation(turtleWinDistances,turtleLoseDistances,secPerMove,winTurtle,loseTurtle,streetId,turtleId,winner) {
      let topPerc = 79 // the ceiling of the race
      let singleDistancePerc = topPerc/100

      for (let i=0; i<secPerMove.length; i++) {

        let thisSecPerMove = secPerMove[i]
        let turtleWinPerc = parseFloat(turtleWinDistances[i]*singleDistancePerc)
        let turtleLosePerc = parseFloat(turtleLoseDistances[i]*singleDistancePerc)
        $("#turtle"+winTurtle).animate({bottom:turtleWinPerc+"%"},thisSecPerMove*1000,easing="linear")
        if (i === secPerMove.length-1) { // to run at the end of the race
          $("#turtle"+loseTurtle).animate({bottom:turtleLosePerc+"%"},thisSecPerMove*1000,easing="linear",complete=function() {
            clearInterval(streetId)
            clearInterval(turtleId)
            mountedApp.runningRace = false // this.runningRace=True will not work here
            mountedApp.userGambled = false
            if (winner) { // if the user won this race
              mountedApp.getUserOwedFunds().then(result=>{})
            }
          })
        } else {
          $("#turtle"+loseTurtle).animate({bottom:turtleLosePerc+"%"},thisSecPerMove*1000,easing="linear")  
        }        
      }
    },
    // runs the game animation
    runGameAnimation(winner,betOn) {
      betOn = betOn.toString()
      let otherTurtle
      let winTurtle
      let loseTurtle
      if (betOn === "1") { otherTurtle = "2" } else { otherTurtle = "1" }
      if (winner) { winTurtle = betOn; loseTurtle = otherTurtle } else { winTurtle = otherTurtle; loseTurtle = betOn }

      let turtleWinDistances; let turtleLoseDistances; let secPerMove; // getting simulation of race
      [turtleWinDistances,turtleLoseDistances,secPerMove] = simulateGame()

      this.runningRace = true
      if (winner) { // user won this race
        this.popupMessage = "Congratulations you won! Remember to claim your winnings."
      } else {
        this.popupMessage = "RIP you lost. Better luck next time!"
      }

      let streetId ; let turtleId
      [streetId,turtleId] = this.movingAnimation()
      this.racingAnimation(turtleWinDistances,turtleLoseDistances,secPerMove,winTurtle,loseTurtle,streetId,turtleId,winner)
    },
    // checks for the amount of funds owed to user
    async getUserOwedFunds() {
      let owedFunds = await window.walletInfo.contract.amountDue(window.walletInfo.address)
      this.claimAmount = owedFunds
    },
    // handler for allowing user to claim their funds
    async claimFunds() {
      if (this.claimAmount.gt(0)) {
        try {
          await window.walletInfo.contract.requestFunds()
          this.claimAmount = ethers.BigNumber.from(0)
        } catch(error) {
          console.log(error)
        }
      }
    },
  },
  computed: {
    // displays pool amount for contract
    poolAmount() {
      if (this.poolAmountNumber === null) {
        return "N/A"
      } else {
        return this.poolAmountNumber.toString().substring(0,12)+" ETH"
      }
    },
    // displays amount of funds owed to user
    claimText() {
      let fundsToClaim = this.claimAmount
      fundsToClaim = ethers.utils.formatEther(fundsToClaim)
      if (fundsToClaim < 0.00001 && fundsToClaim>0) {
        fundsToClaim = "< 0.00001"
      } else if (fundsToClaim > 10000) {
        fundsToClaim = "> 10000"
      } else {
        fundsToClaim = fundsToClaim.toString().substring(0,7)
      }
      return "Claim: "+fundsToClaim+" ETH"
    },
  }, 
  data() {
    return {
      walletText: "Connect to a wallet",
      winPercentage: "N/A",
      poolAmountNumber:null,
      lastWinner: "N/A",
      winStreak: "N/A",
      popupMessage: "Welcome to Turtle race. All bets are double or nothing. You can't bet more than 1/2 of the pool. Good luck!",
      claimAmount: ethers.BigNumber.from(0),
      
      validWallet: false, // false represents no valid wallet attached
      userGambled: false, // true represents user starting gambling flow
      runningRace: false, // true represents user race animation has started

      clickable: "clickable", // css class variable
      nonClickable: "non-clickable", // css class variable
      amountGambled: null,
      turtlePicked: null,
      abi: null,
      contractAddress: null,
    }
  },
})