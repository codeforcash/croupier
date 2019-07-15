import * as _ from "lodash";
import * as moment from "moment";
import * as throttledQueue from "throttled-queue";
import Croupier from "./croupier";
import * as Bot from "./keybase-bot";

import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";

import {
  IBetData,
  IBetList,
  IParticipant,
  IPopularityContest,
  IPositionSize,
  IPowerup,
  IPowerupAward,
  IReactionContent,
} from "./types";

type ThrottledChat = (message: string) => Promise<any>;
type ThrottledMoneyTransfer = (xlmAmount: number, recipient: string) => Promise<any>;

class Snipe {

  public bot1: Bot;
  public bot2: Bot;
  public channel: ChatChannel;
  public croupier: Croupier;
  public participants: Array<IParticipant>;
  public betting_open: boolean;
  public clock: string;
  public timeout: NodeJS.Timeout;
  public countdown: number;
  public snipeId: number;
  public betting_stops: moment.Moment;
  public chatSend: ThrottledChat;
  public moneySend: ThrottledMoneyTransfer;
  public positionSizes: IPositionSize;
  public reflipping: boolean;
  public runningClocks: object;
  public bettingTable: string;
  public blinds: number;
  public betting_started: number;
  public popularityContests: Array<IPopularityContest>;
  public potSizeStored: number;
  public clockRemaining: number;
  public freeze: string;
  public powerups: Array<IPowerupAward>;
  public flipMonitorIntervals: object;

  public constructor(croupier, channel, bots, options) {

    const self = this;
    this.runningClocks = {};
    this.flipMonitorIntervals = {};
    this.croupier = croupier;
    this.channel = channel;
    this.bot1 = bots.bot1;
    this.bot2 = bots.bot2;

    this.betting_open = true;
    if (options.betting_started) {
      this.betting_started = parseInt(options.betting_started, 10);
    } else {
      this.betting_started = +new Date();
    }

    if (typeof(options.countdown) === "undefined") {
      options.countdown = 60;
    }
    this.countdown = options.countdown;
    this.betting_stops = moment().add(this.countdown, "seconds");

    if (options.blinds) {
      this.blinds = parseFloat(options.blinds);
    } else {
      this.blinds = 0.01;
    }

    const chatThrottle: any = throttledQueue(5, 5000);

    this.chatSend = (message) => {
      return new Promise((resolveChatThrottle) => {
        chatThrottle(() => {
          self.bot1.chat.send(channel, {
            body: message,
          }, undefined).then((messageId) => {
            resolveChatThrottle(messageId);
          });
        });
      });
    };

    this.clock = null;
    if (options.clock_remaining) {
      this.clockRemaining = options.clock_remaining;
    } else {

    }

    const moneyThrottle: any = throttledQueue(1, 1000);
    this.moneySend = (amount, recipient) => {
      return new Promise((resolveMoneyThrottle) => {
        moneyThrottle(() => {
          self.bot1.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
          resolveMoneyThrottle();
        });
      });
    };

    if (options.participants) {
      this.participants = options.participants;
    } else {
      this.participants = [];
    }

    this.popularityContests = [];
    if (options.position_sizes) {
      this.positionSizes = options.position_sizes;
    } else {
      this.positionSizes = {};
    }

    if (options.potSize) {
      this.potSizeStored = options.potSize;
    }

    if (options.snipeId) {
      this.snipeId = options.snipeId;
    }

    this.timeout = null;

    let sassyPopularityContestDescription: string = "Put it to a vote: who does the group like more, ";
    sassyPopularityContestDescription += "you or the pot leader?  If the pot leader wins, your ";
    sassyPopularityContestDescription += "position is reduced to 1.  If you win, you and the pot ";
    sassyPopularityContestDescription += "leader swap position sizes!";

    this.powerups = [
      {
        description: `Go nuclear and play everyone's powerups in the order they were received`,
        emoji: "☢️",
        name: "nuke",
        reaction: ":radioactive_sign:",
      },
      {
        description: "For the next 10 seconds, powerups and bets are worthless and increase your position by 1",
        emoji: "🍧",
        name: "freeze",
        reaction: ":shaved_ice:",
      },
      {
        description: `o/\` It's the final countdown!  Reset the clock to 1 minute`,
        emoji: "🕺",
        name: "the-final-countdown",
        reaction: ":man_dancing:",
      },
      {
        description: `Level the playing field and reset everybody's positions to 1`,
        emoji: "🏳️‍🌈",
        name: "level-the-playing-field",
        reaction: ":rainbow-flag:",
      },
      {
        description: sassyPopularityContestDescription,
        emoji: "👯",
        name: "popularity-contest",
        reaction: ":dancers:",
      },
      {
        description: "Cut the remaining time in half",
        emoji: "⌛",
        name: "half-life",
        reaction: ":hourglass:",
      },
      {
        description: "Double the remaining time",
        emoji: "⏳",
        name: "double-life",
        reaction: ":hourglass_flowing_sand:",
      },
      {
        description: `Reduce the pot leader's position size to 1`,
        emoji: "🔫",
        name: "assassin",
        reaction: ":gun:",
      },
      {
        description: "Your position size has an even chance of doubling/halving",
        emoji: "🗡",
        name: "double-edged-sword",
        reaction: ":dagger_knife:",
      },
    ];

  }

  // If the same person made 3 bets in a row, issue a powerup
  // but not if they have recently been issued a powerup
  public shouldIssuePowerup(): boolean {
    const count: number = this.participants.length;
    if (count >= 3
        && this.participants[count - 1].username === this.participants[count - 2].username
        && this.participants[count - 2].username === this.participants[count - 3].username
      ) {

      let lastPowerupIndex: number = 0;
      this.participants.forEach((participant, idx) => {
        if (participant.powerup) {
          lastPowerupIndex = idx;
        }
      });

      if (lastPowerupIndex === 0) {
        return true;
      }
      if (((count - 1) - lastPowerupIndex) >= 3) {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  public freezeBet(msg: MessageSummary): void {
    this.chatSend(`@${msg.sender.username}'s attempt was frozen and instead @${this.freeze}'s position increased +1`);
    this.positionSizes[this.freeze] += 1;
  }

  public checkForPopularityContestEnd(pollMessageId: string): void {
    const self = this;
    this.popularityContests.forEach((contest, contestIdx) => {

      if (contest.votesForChallenger.length >= 3) {
        const leaderPositionSize: number = self.positionSizes[contest.leader];
        const challengerPositionSize: number = self.positionSizes[contest.challenger];
        self.positionSizes[contest.leader] = challengerPositionSize;
        self.positionSizes[contest.challenger] = leaderPositionSize;
        let sassySwapMsg: string = `@${contest.challenger} and @${contest.leader} have swapped position sizes!`;
        sassySwapMsg += `You can't buy your way to the top in this game!`;
        self.chatSend(sassySwapMsg);

        // TODO: could be dangerous to modify an array while looping over it?
        // mark the contest closed ...
        self.popularityContests.splice(contestIdx, 1);
      } else if (contest.votesForLeader.length >= 3) {
        self.positionSizes[contest.challenger] = 1;

        let sassyContestMessage: string = `@${contest.challenger} lost the popular vote and is punished. `;
        sassyContestMessage += `${contest.challenger}'s position size = 1.  `;
        sassyContestMessage += `@${contest.leader} reigns supreme.  Position size = 1.`;
        self.chatSend(sassyContestMessage);
        // mark the contest closed
        self.popularityContests.splice(contestIdx, 1);
      }

    });
  }

  public issuePowerup(participantIndex: number): void {
    const award: IPowerupAward = _.sample(this.powerups);
    this.participants[participantIndex].powerup = {
      award,
      awardedAt: +new Date(),
      participantIndex,
      reactionId: null,
      usedAt: null,
    };

    const awardee: string = this.participants[participantIndex].username;
    this.chatSend(`Congrats @${awardee}, you won the **${award.name}** powerup.
      *${award.description}*
      Click the emoji to consume the powerup.`).then((msg) => {
        this.bot1.chat.react(this.channel, msg.id, award.reaction, undefined);
        this.participants[participantIndex].powerup.reactionId = msg.id;
    });

  }

  public addSnipeParticipant(txn: Transaction, onBehalfOf?: string): void {

    const self = this;
    let newParticipant: IParticipant;
    let betBeneficiary: string;

    if (typeof(onBehalfOf) === "undefined") {
      newParticipant = {
        transaction: txn,
        username: txn.fromUsername,
      };
      betBeneficiary = txn.fromUsername;
    } else {
      newParticipant = {
        onBehalfOf,
        transaction: txn,
        username: txn.fromUsername,
      };
      betBeneficiary = onBehalfOf;
    }

    self.participants.push(newParticipant);
    if (typeof(self.positionSizes[betBeneficiary]) === "undefined") {
      self.positionSizes[betBeneficiary] = Math.floor(txn.amount / 0.01);
    } else {
      self.positionSizes[betBeneficiary] += Math.floor(txn.amount / 0.01);
    }

    if (this.shouldIssuePowerup()) {
      this.issuePowerup(self.participants.length - 1);
    }

    self.croupier.updateSnipeLog(self.channel);
  }

  public clearSnipe(reason: string): void {
    console.log("clearing cuz ", reason);
    this.croupier.documentSnipe(this, reason);
    this.croupier.activeSnipes[JSON.stringify(this.channel)] = undefined;
  }

  public sendAmountToWinner(winnerUsername: string, channel: ChatChannel): void {
    let bounty: number = 0;
    const self = this;

    const transactionFeePromises: Array<Promise<any>> = [];

    self.participants.forEach((participant) => {
       bounty += parseFloat(participant.transaction.amount);
       transactionFeePromises.push(self.croupier.calculateTransactionFees(participant.transaction));
    });

    Promise.all(transactionFeePromises).then((values: Array<number>) => {
      values.forEach((val) => {
        bounty -= val;
      });
      bounty = _.round(bounty, 7);
      console.log("now rounded", bounty);

      //  If winnerUsername is a participant in this chat, moneySend
      //  Otherwise, use stellar.expert.xlm method
      self.bot1.team.listTeamMemberships({
        team: channel.name,
      }).then((res) => {

        let allMembers: Array<string> = [];
        allMembers = allMembers.concat(res.members.owners.map((u) => u.username));
        allMembers = allMembers.concat(res.members.admins.map((u) => u.username));
        allMembers = allMembers.concat(res.members.writers.map((u) => u.username));
        allMembers = allMembers.concat(res.members.readers.map((u) => u.username));

        // it's possible the winner is not in the chat, that they won through a onBehalfOf contribution of someone else
        if (allMembers.indexOf(winnerUsername) === -1) {
          self.bot1.wallet.send(winnerUsername, bounty.toString()).then((txn) => {
            let bountyMsg: string = `\`+${bounty}XLM@${winnerUsername}\` `;
            bountyMsg += `:arrow_right: `;
            bountyMsg += `https://stellar.expert/explorer/public/tx/${txn.txId}\n\n`;
            bountyMsg += `Please contact ${winnerUsername} and request they claim their winnings.`;
            self.chatSend(bountyMsg);
          });
        } else {
          self.moneySend(bounty, winnerUsername);
        }
      });
    });
  }

  public resolveFlip(winningNumber: number): string {
    let winnerUsername: string;
    const bettorRange: object = this.buildBettorRange();
    Object.keys(bettorRange).forEach((username) => {
      if (bettorRange[username][0] <= winningNumber && bettorRange[username][1] >= winningNumber) {
        winnerUsername = username;
      }
    });
    this.sendAmountToWinner(winnerUsername, this.channel);
    this.chatSend(`Congrats to @${winnerUsername}`);
    return winnerUsername;
  }

  public buildBettorRange(): any {
    const bettorMap: object = {};
    const self = this;
    const bettorRange: object = {};
    let start: number = 0;

    Object.keys(self.positionSizes).sort((a, b) => {
      return self.positionSizes[a] > self.positionSizes[b] ? -1 : 1;
    }).forEach((username) => {
      bettorRange[username] = [start + 1, start + self.positionSizes[username]];
      start += self.positionSizes[username];
    });
    return bettorRange;
  }

  public displayFixedNice(a: number): string {
    let aFormatted: string = a.toFixed(2).toString();
    if (aFormatted.slice(-2, aFormatted.length) === "00") {
      aFormatted = parseInt(aFormatted, 10).toString();
    }
    return aFormatted;
  }

  public buildBettingTable(): string {

    const potSize: number = this.calculatePotSize();
    const bettorRange: object = this.buildBettorRange();

    console.log("within BuildBettingTable, bettorRange:", bettorRange);

    const maxValue: number = Math.max(..._.flatten(Object.values(bettorRange)));
    let bettingTable: string = `Pot size: ${this.displayFixedNice(potSize)}XLM\n`;
    let bettorRank: number = 1;

    Object.keys(bettorRange).forEach((username) => {

      const chancePct: number = 100 * ( (1 + (bettorRange[username][1] - bettorRange[username][0])) / maxValue);

      bettingTable += `\n${bettorRank}. @${username}: \``;
      bettorRank += 1;
      if (bettorRange[username][0] === bettorRange[username][1]) {
        bettingTable += `${bettorRange[username][0]}\``;
      } else {
        bettingTable += `${bettorRange[username][0].toLocaleString()} - ${bettorRange[username][1].toLocaleString()}\``;
      }
      bettingTable += ` (${this.displayFixedNice(chancePct)}% chance)`;
    });

    return bettingTable;

  }

  public makeSubteamForFlip(): void {
    const self = this;
    const subteamName: string = `croupierflips.snipe${self.snipeId}`;
    const usernamesToAdd: Array<object> = [{username: "croupier", role: "admin"}];

    Object.keys(self.positionSizes).forEach((username) => {
      usernamesToAdd.push({
        role: "reader",
        username,
      });
    });

    console.log("Creating the subteam", subteamName);

    const newSubteam: ChatChannel = {
      membersType: "team", name: subteamName,
    };

    self.bot1.team.createSubteam(subteamName).then((res) => {
      console.log("Subteam creation complete!", res);
      console.log("Attempting to add people to the team", usernamesToAdd);
      self.bot1.team.addMembers({
        team: subteamName,
        usernames: usernamesToAdd,
      }).then((addMembersRes) => {
        console.log("Adding people to the team was successful!", addMembersRes);
        self.flip(newSubteam);
      }).catch((e) => {
        console.log(e);
        self.flip(newSubteam);
      });
    });

  }

  public flip(whereToFlip: ChatChannel): void {
    const self = this;
    if (typeof(whereToFlip) === "undefined") {
      whereToFlip = self.channel;
    }

    const bettorRange: object = this.buildBettorRange();
    const bettingValues: Array<Array<number>> = Object.values(bettorRange);
    const flatBettingValues: Array<number> = _.flatten(bettingValues);
    const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
    const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

    this.bot2.chat.send(whereToFlip, {
      body: "**Final betting table...**",
    }, undefined);
    this.bot2.chat.send(whereToFlip, {
      body: self.buildBettingTable(),
    }, undefined);
    this.bot2.chat.send(whereToFlip, {
      body: `/flip ${minBet}..${maxBet}`,
    }, undefined).then((res) => {
      self.reflipping = false;
    });
  }

  public checkWalletBalance(username: string): Promise<any> {
    let balance: number = 0;
    const self = this;
    return new Promise((resolve, reject) => {

      try {

        self.bot1.wallet.lookup(username).then((acct) => {
          console.log(acct);
          self.bot1.wallet.balances(acct.accountId).then((balances) => {
            console.log(balances);
            balances.forEach((acctDetail) => {
              console.log(acctDetail.balance[0].amount);
              balance += parseFloat(acctDetail.balance[0].amount);
            });
            resolve(balance);
          }).catch((e) => {
            console.log(e);
            reject(e);
          });
        }).catch((e) => {
          console.log(e);
          reject(e);
        });

      } catch (e) {
        console.log(e);
        reject(e);
      }

    });
  }

  public processNewBet(txn: Transaction, msg: MessageSummary): Promise<boolean> {
    const channel: ChatChannel = msg.channel;
    const onBehalfOfMatch: Array<any> = msg.content.text.body.match(/(for|4):?\s?@?(\w+@?(\w+)?)/i);

    const self = this;

    return new Promise((resolve) => {

      if (onBehalfOfMatch !== null) {
        const onBehalfOfRecipient: string = onBehalfOfMatch[2];
        self.processNewBetOnBehalfOf(txn, msg, onBehalfOfRecipient, resolve);
      } else {
        self.addSnipeParticipant(txn, undefined);
        self.bot1.chat.react(channel, msg.id, ":heavy_check_mark:", undefined);
        resolve(true);
      }
    });
  }

  public processNewBetOnBehalfOf(txn, msg, recipient, resolve) {
    const channel: ChatChannel = msg.channel;
    const self = this;

    // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
    // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
    // new wallets
    self.checkWalletBalance(recipient).then((balance) => {
      if (balance === null || balance < 2.01) {
        if (txn.amount < 2.02) {
          let sassyMessage: string = `Betting on behalf of ${recipient}?  `;
          sassyMessage += "Seems like they do not have a wallet yet, ";
          sassyMessage += `so your bet must be at least 2.02XLM (was ${txn.amount})`;
          self.chatSend(sassyMessage);
          self.croupier.processRefund(txn, msg.channel);
          resolve(false);
        }
      } else if (typeof(self.positionSizes[txn.fromUsername]) === "undefined") {
        self.chatSend(`You cannot bet on behalf of ${recipient} unless you are participating as well`);
        resolve(false);
      } else {
        self.addSnipeParticipant(txn, recipient);
        self.chatSend(`@${recipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
        self.bot1.chat.react(channel, msg.id, ":gift:", undefined);
        resolve(true);
      }
    }).catch((e) => {
      console.log("Probably ran into a lookup error", e);
      if (txn.amount < 2.02) {
        let sassyMessage: string = `Betting on behalf of ${recipient}?  `;
        sassyMessage += "Seems like they do not have a wallet yet, ";
        sassyMessage += `so your bet must be at least 2.02XLM (was ${txn.amount})`;
        self.chatSend(sassyMessage);
        self.croupier.processRefund(txn, msg.channel);
        resolve(false);
      } else {
        self.addSnipeParticipant(txn, recipient);
        self.chatSend(`@${recipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
        self.bot1.chat.react(channel, msg.id, ":gift:", undefined);
        resolve(true);
      }
    });
  }

  public calculatePotSize(): number {
    let sum: number;
    if (this.potSizeStored) { // temp solution while we build a server solution robust enough to hold big data
      sum = this.potSizeStored;
    } else {
      sum = 0;
    }

    this.participants.forEach((participant) => {
      sum += parseFloat(participant.transaction.amount);
    });
    return sum;
  }

  public getTimeLeft(): number {
    return Math.ceil(Math.abs(moment.duration(this.betting_stops.diff(moment())).asSeconds()));
  }

  public resetSnipeClock(): void {
    if (this.bettingTable) {
      this.bot1.chat.delete(this.channel, this.bettingTable, {}).then(() => {
        this.chatSend(this.buildBettingTable()).then((msg) => {
          this.bettingTable = msg.id;
        });
      });
    } else {
      this.chatSend(this.buildBettingTable()).then((msg) => {
        this.bettingTable = msg.id;
      });
    }
    const timeRemaining: number = Math.ceil(this.getTimeLeft());
    console.log("time remaining", timeRemaining);
    clearTimeout(this.timeout);

    let boost: number;
    let timerEndsInSeconds: number;
    if (timeRemaining <= 30) {
      timerEndsInSeconds = 60;
    } else {
      boost = 10;
      timerEndsInSeconds = timeRemaining + boost;
    }

    this.betting_stops = moment().add(timerEndsInSeconds, "seconds");

    this.bot1.chat.delete(this.channel, this.clock, {});
    const self = this;
    const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
      self.finalizeBets();
    }, timerEndsInSeconds * 1000);
    this.timeout = finalizeBetsTimeout;

  }

  public launchSnipe(): void {
    // Tell the channel: OK, your snipe has been accepted for routing.
    const self = this;
    let message: string = `The snipe is on (**#${self.snipeId}**).  `;
    message += `Bet in multiples of 0.01XLM.  Betting format:`;
    message += `\`\`\`+0.01XLM@${self.croupier.botUsername}\`\`\``;
    message += `Minimum bet: **${this.displayFixedNice(self.blinds)}XLM**`;

    self.chatSend(message);

    self.chatSend(`Betting stops ${moment().to(self.betting_stops)}`).then((sentMessage) => {
      self.clock = sentMessage.id;
      self.runClock();
    });

    const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
      self.finalizeBets();
    }, self.countdown * 1000);
    self.timeout = finalizeBetsTimeout;
  }

  public finalizeBets(): void {
    const self = this;
    self.chatSend("No more bets!");
    self.betting_open = false;
     // Give 5 seconds to finalize transactions + 1 extra.
    setTimeout(() => {
      self.executeFlipOrCancel();
    }, 6 * 1000);
  }

  public refundAllParticipants(): void {
    const self = this;
    const bets: IBetList = {};
    self.participants.forEach((participant) => {
      if (typeof(bets[participant.transaction.fromUsername]) === "undefined") {
        const betData: IBetData = {
          fees: [],
          wagers: [],
        };
        bets[participant.transaction.fromUsername] = betData;

      }
      bets[participant.transaction.fromUsername].fees.push(self.croupier.calculateTransactionFees(participant.transaction));
      bets[participant.transaction.fromUsername].wagers.push(participant.transaction.amount);
    });

    const participantList: Array<string> = Object.keys(bets);

    participantList.forEach((participant) => {
      Promise.all(bets[participant].fees).then((fees) => {
        console.log("fees", fees);
        const feeSum: number = fees.reduce((a, b) => parseFloat(a.toString()) + parseFloat(b.toString()));
        console.log("feeSum", feeSum);
        const wagerSum: number = bets[participant].wagers.reduce((a, b) => {
          return parseFloat(a.toString()) + parseFloat(b.toString());
        });
        console.log("wagerSum", wagerSum);
        const refund: number = _.round(wagerSum - feeSum, 7);
        console.log("refund", refund);
        self.moneySend(refund, participant);
      });
    });
  }

  public executeFlipOrCancel(): void {
    const self = this;
    if (self.participants) {
      const participantUsernames: Array<string> = self.participants.map((participant) => {
        return participant.onBehalfOf || participant.username;
      });
      const uniqParticipants: Array<string> = _.union(participantUsernames);
      if (uniqParticipants.length > 1) {
        self.flip(self.channel);
      } else {
        self.refundAllParticipants();
        self.chatSend("The snipe has been canceled due to a lack of participants.");
        self.clearSnipe("lack-of-participants");
      }
    }
  }

  public cancelFlip(conversationId: string, err: Error): void {

    console.log("err", err);
    clearInterval(this.flipMonitorIntervals[conversationId]);
    this.chatSend(`The flip has been cancelled due to error, and everyone is getting a refund`);
    this.refundAllParticipants();
    this.clearSnipe("flip-error");
  }

  public getChannelFromSnipeId(snipeId: number): ChatChannel {
    let channel: ChatChannel;
    const BreakException: object = {};
    const self = this;
    try {
      Object.keys(self.croupier.activeSnipes).forEach((stringifiedChannel) => {
        if (self.croupier.activeSnipes[stringifiedChannel].snipeId === snipeId) {
          channel = JSON.parse(stringifiedChannel);
          throw BreakException;
        }
      });
    } catch (e) {
      // all good
    }
    return channel;
  }

  public getOriginChannel(channelName: string): ChatChannel {
    const channelMatch: Array<any> = channelName.match(/croupierflips.snipe(\d+)/);
    const snipeId: number = parseInt(channelMatch[1], 10);
    return this.getChannelFromSnipeId(snipeId);
  }

  public monitorFlipResults(msg: MessageSummary): void {

    const self = this;
    let ourChannel: boolean;
    let snipe: Snipe;

    self.flipMonitorIntervals[msg.conversationId] = setInterval((() => {

      try {
        self.bot1.chat.loadFlip(
          msg.conversationId,
          msg.content.flip.flipConvId,
          msg.id,
          msg.content.flip.gameId,
        ).then((flipDetails) => {
          if (flipDetails.phase === 2) {
            console.log("results are in");
            const winner: string = self.resolveFlip(flipDetails.resultInfo.number);
            clearInterval(self.flipMonitorIntervals[msg.conversationId]);
            self.clearSnipe(winner);
          } else {
            console.log("results are NOT in", flipDetails);
          }
        }).catch((err) => {

          console.log("Error: ", err);

          const channelMatch: Array<any> = msg.channel.name.match(/croupierflips.snipe(\d+)/);
          if (channelMatch === null) {
            snipe = self.croupier.activeSnipes[JSON.stringify(msg.channel)];
            ourChannel = false;
          } else {

            console.log("channelMatch", channelMatch[1]);
            const originalChannel = self.getChannelFromSnipeId(parseInt(channelMatch[1], 10));
            console.log("original channel", originalChannel);
            snipe = self.croupier.activeSnipes[JSON.stringify(originalChannel)];
            ourChannel = true;
          }

          if (snipe.reflipping) {
            return false;
          }
          snipe.reflipping = true;
          clearInterval(self.flipMonitorIntervals[msg.conversationId]);

          if (ourChannel) {
            // extract the name of the offender
            // remove the offender from the team
            // clear the interval
            // run the flip again
            self.bot1.chat.getFlipData(msg.conversationId,
              msg.content.flip.flipConvId,
              msg.id,
              msg.content.flip.gameId).then((getFlipDataRes) => {
              console.log("getflipdata res!");
              console.log(getFlipDataRes);
              const stdout = getFlipDataRes[1];
              console.log(stdout);

              const result: any = JSON.parse(stdout.trim()).result;
              const errorInfo: any = result.status.errorInfo;
              console.log(errorInfo);

              if (Object.keys(result.status).indexOf("errorInfo") !== -1 && errorInfo.dupreg && errorInfo.dupreg.user) {
                self.bot1.team.removeMember({
                  team: msg.channel.name,
                  username: errorInfo.dupreg.user,
                }).then((removeMemberRes) => {
                  snipe.chatSend(`We have punted ${errorInfo.dupreg.user} for duplicate registration issues`);
                  self.flip(msg.channel);
                });
              } else if (result.status.phase === 2) {
                console.log("results are in");
                console.log(result.status.resultInfo.number);
                const winner: string = self.resolveFlip(result.status.resultInfo.number);
                console.log("winner", winner);
                clearInterval(self.flipMonitorIntervals[msg.conversationId]);
                self.clearSnipe(winner);
              } else {
                self.flip(msg.channel);
              }
            });
          } else {
            let flipErrorMessage: string = "Due to error, we are going to re-cast the flip in a ";
            flipErrorMessage += "separate subteam over which we have governance and can kick anyone ";
            flipErrorMessage += "with a duplicate registration.";
            snipe.chatSend(flipErrorMessage);
            self.makeSubteamForFlip();
          }
        });
      } catch (err) {
        self.cancelFlip(msg.conversationId, err);
      }
    }), 5000);
  }

  public adjustBlinds(): void {
    const now: number = +new Date();
    const secondsElapsed: number = Math.floor((now - this.betting_started) / 1000);
    const minutesElapsed: number = Math.floor(secondsElapsed / 60.0);
    let blinds: number;
    if (minutesElapsed < 10) {
      blinds = 0.01;
    } else {
      blinds = 0.01 * Math.pow(2, Math.floor((minutesElapsed - 10) / 5));
      // c.f. https://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-only-if-necessary
      blinds = Math.round((blinds + 0.00001) * 100) / 100; // scale to 2 dp
    }
    if (blinds !== this.blinds) {
      this.blinds = blinds;
      this.croupier.updateSnipeLog(this.channel);
      this.chatSend(`Blinds are raised. Minimum bet: **${this.displayFixedNice(blinds)}XLM**`);
    }
  }

  public runClock(): void {

    const self = this;
    const seconds: number = self.getTimeLeft();

    try {
      self.adjustBlinds();
      // :hourglass: :hourglass_flowing_sand:
      if (seconds % 5 === 0) {

        let hourglass: string;
        const lastDigit: string = JSON.stringify(seconds).slice(-1);
        if (lastDigit === "5") {
          hourglass = ":hourglass:";
        } else {
          hourglass = ":hourglass_flowing_sand:";
        }

        let stopsWhen: string = moment().to(self.betting_stops);
        if (seconds < 55) {
          stopsWhen = `in ${seconds} seconds`;
        }
        console.log(`attempting to edit message ${self.clock} in channel ${self.channel}`);
        if (self.clock === null || typeof(self.clock) === "undefined") {
          self.bot1.chat.send(self.channel, {
            body: hourglass + ` betting stops ${stopsWhen}`,
          }, undefined).then((sentMessage) => {
            self.clock = sentMessage.id;
          }).catch((e) => {
            console.log(e);
          });
        } else {
          self.bot1.chat.edit(self.channel, self.clock, {
            message: {
              body: hourglass + ` betting stops ${stopsWhen}`,
            },
          }).then((res) => {
            console.log(res);
          }).catch((e) => {
            self.clock = null;
            console.log(e);
          });
        }

      }
    } catch (e) {
      console.log("ran into error in runClock fxn, ", e);
      return;
    }

    if (seconds > 1) {
      setTimeout(() => {
        self.runClock();
      }, 1000);
    } else {
      setTimeout(() => {
        self.bot1.chat.delete(self.channel, self.clock, {});
      }, 1000);
    }
  }

  public buildPowerupsTable(whose: string): string {

    let table: string = "";
    const self = this;
    const powerupsCount: object = {};

    self.participants.forEach((bet: IParticipant) => {
      if (bet.powerup && bet.powerup.usedAt === null && bet.username === whose) {
        const awardJsonified: string = JSON.stringify(bet.powerup.award);
        if (typeof(powerupsCount[awardJsonified]) === "undefined") {
          powerupsCount[awardJsonified] = 0;
        }
        powerupsCount[awardJsonified] += 1;
      }
    });

    Object.keys(powerupsCount).forEach((awardJsonified) => {
      const award: IPowerupAward = JSON.parse(awardJsonified);
      table += `${powerupsCount[awardJsonified]}x ${award.reaction} **${award.name}**: ${award.description}\n`;
    });
    if (table === "") {
      table = `@${whose} has no powerups :disappointed:\n`;
    }
    return table;
  }

  public checkTextForPowerup(msg: MessageSummary): void {
    const self = this;
    // would be better to have the regexp match object type
    const powerupsQuery: Array<any> = msg.content.text.body.match(/(\.powerups|🐶|:dog:)\s?@?(\w+)?/);
    if (powerupsQuery !== null) {
      if (typeof(powerupsQuery[2]) !== "undefined") {
        const whose: string = powerupsQuery[1];
        if (self.positionSizes[whose] > 10) {
          self.positionSizes[whose] -= 10;
          const powerupsTable: string = self.buildPowerupsTable(whose);
          self.chatSend(`${powerupsTable}\nIt cost @${msg.sender.username} 10 position to scope @${whose} powerups`);
        }
      } else {
        const whose: string = msg.sender.username;
        if (self.positionSizes[whose] > 1) {
          self.positionSizes[whose] -= 1;
          const powerupsTable: string = self.buildPowerupsTable(whose);
          self.chatSend(`${powerupsTable}\nIt cost @${whose} 1 position to check their own powerups`);
        }
      }
      return;
    } else {
      self.participants.forEach((bet: IParticipant) => {
        if (msg.sender.username === bet.username) {
          if (bet.powerup && bet.powerup.usedAt === null) {
            if (msg.content.text.body.toLowerCase().indexOf(bet.powerup.award.reaction) !== -1
                  || msg.content.text.body.indexOf(bet.powerup.award.emoji) !== -1) {
              self.consumePowerup(bet.powerup);
            }
          }
        }
      });
    }
  }

  public checkReactionForPowerup(msg: MessageSummary): void {
    const reactionId: string = msg.id;
    const reactionContent: IReactionContent = msg.content;
    const self = this;

    self.participants.forEach((bet: IParticipant) => {
      if (msg.sender.username === bet.username) {
        if (bet.powerup && bet.powerup.usedAt === null) {
          if (reactionContent.reaction.b === bet.powerup.award.reaction &&
            reactionContent.reaction.m === bet.powerup.reactionId) {
            self.consumePowerup(bet.powerup);
          }
        }
      }
    });
  }

  public findPotLead(): string {
    const self = this;
    return _.maxBy(_.keys(this.positionSizes), (username: string) => {
      return self.positionSizes[username];
    });
  }

  public consumePowerup(powerup: IPowerup): void {

    const self = this;
    let sassyMessage: string;
    const consumer: string = this.participants[powerup.participantIndex].username;
    const leader: string = this.findPotLead();
    powerup.usedAt = +new Date();
    let doNotResetClock: boolean = false;
    switch (powerup.award.name) {
      case "nuke":
        doNotResetClock = true;
        const unusedPowerupsLength: number = self.participants.filter((p) => {
          return p.powerup && p.powerup.usedAt === null;
        }).length;

        self.chatSend(`@${consumer} went nuclear.  Enjoy the show :fireworks:.`).then(() => {

          self.participants.forEach((participant) => {
            if (participant.powerup) {
              if (participant.powerup.usedAt === null) {
                self.consumePowerup(participant.powerup);
              }
            }
          });

          if (unusedPowerupsLength === 0) {
            self.chatSend(`...well, that was awkward. All that nuclear FUD, and for what?`);
          }
        });
        break;
      case "freeze":
        sassyMessage = `@${consumer} played Freeze.  `;
        sassyMessage += `Any action by anyone other than ${consumer} or @croupier during `;
        sassyMessage += `the next 10 seconds will be ignored and instead increase ${consumer}'s `;
        sassyMessage += `position by 1.`;
        self.chatSend(sassyMessage);
        self.freeze = consumer;
        setTimeout(() => {
          self.chatSend(`@${consumer}'s freeze has expired!`);
          self.freeze = undefined;
        }, 1000 * 10);
        break;
      case "the-final-countdown":
        self.betting_stops = moment().add(60, "seconds");
        sassyMessage = `@${consumer} played The Final Countdown.  `;
        sassyMessage += `Will things ever be the same again?  60 seconds on the clock.  `;
        sassyMessage += `It's the final countdown.`;
        self.chatSend(sassyMessage);
        doNotResetClock = true;
        break;
      case "level-the-playing-field":
        Object.keys(self.positionSizes).forEach((username) => {
          self.positionSizes[username] = 1;
        });
        sassyMessage = `@${consumer} leveled the playing field in a big way.`;
        sassyMessage += `  Everyone's positions are now equal.  One love.`;
        self.chatSend(sassyMessage);
        break;
      case "half-life":  // Cut the remaining time in half
        const timeToSubtract: number = Math.floor(self.getTimeLeft() / 2.0);
        self.betting_stops = self.betting_stops.subtract(timeToSubtract, "seconds");
        self.chatSend(`@${consumer} chopped ${timeToSubtract} seconds off the clock.`);
        doNotResetClock = true;
        break;
      case "double-life": // Double the remaining time
        const timeToAdd: number = Math.floor(self.getTimeLeft());
        self.betting_stops = self.betting_stops.add(timeToAdd, "seconds");
        self.chatSend(`@${consumer} added ${timeToAdd} seconds to the clock.`);
        doNotResetClock = true;
        break;
      case "assassin": // Reduce the pot leader's position size to 1
        self.positionSizes[leader] = 1;
        sassyMessage = `@${consumer}'s :gun: seriously injured @${leader} and their position size is now 1.`;
        self.chatSend(sassyMessage);
        break;
      case "popularity-contest":
        if (consumer === leader) {
          self.chatSend(`You cannot challenge yourself in this game. ::powerup fizzles::`);
          return;
        }

        sassyMessage = `@${consumer} called a popularity contest to challenge @${leader}'s throne!`;
        sassyMessage +=  `  Whom do you prefer?  `;
        sassyMessage += `First to 3 votes wins `;
        sassyMessage += `(4 votes including the initial reaction seeded by me the Croupier)!`;
        self.bot1.chat.send(self.channel, {
          body: sassyMessage,
        }, undefined).then((msgData) => {
          const challengerReaction: Promise<any> = self.bot1.chat.react(self.channel, msgData.id, `${consumer}`);
          const leaderReaction: Promise<any> = self.bot1.chat.react(self.channel, msgData.id, `${leader}`);
          Promise.all([challengerReaction, leaderReaction]).then((values) => {
            self.popularityContests.push({
              challenger: consumer,
              leader,
              pollMessageId: msgData.id,
              votesForChallenger: [],
              votesForLeader: [],
            });
          });
        });
        break;
      case "double-edged-sword": // Even chance of halving or doubling one's position size
        if (Math.random() >= 0.5) {
          self.positionSizes[consumer] = 2 * self.positionSizes[consumer];
          sassyMessage = `A favorable day!  @${consumer}'s position size has doubled`;
          sassyMessage += ` to ${self.positionSizes[consumer]}`;
          self.chatSend(sassyMessage);
        } else {
          self.positionSizes[consumer] = Math.ceil(self.positionSizes[consumer] / 2);
          sassyMessage = `Ouch! @${consumer} cut their hand on the double edged sword`;
          sassyMessage += ` and is now dealing with ${self.positionSizes[consumer]}.`;
          self.chatSend(sassyMessage);
          // TODO: if 1->1, 'guess one cannot go lower than the lowest of the low'
        }
        break;
      default:
        // nothing.
        break;
    }
    self.croupier.updateSnipeLog(self.channel);
    if (!doNotResetClock) {
      self.resetSnipeClock();
    }
  }

  public checkForPopularityContestVote(msg: MessageSummary): void {
    if (typeof(this.popularityContests) === "undefined")  {
      return;
    }
    const reactionId: string = msg.id;
    const reactionContent: IReactionContent = msg.content;
    const self = this;
    this.popularityContests.forEach((contest) => {
      if (contest.pollMessageId === reactionContent.reaction.m) {
        if (reactionContent.reaction.b === contest.leader) {
          contest.votesForLeader.push(reactionId);
          self.checkForPopularityContestEnd(reactionContent.reaction.m);
        } else if (reactionContent.reaction.b === contest.challenger) {
          contest.votesForChallenger.push(reactionId);
          self.checkForPopularityContestEnd(reactionContent.reaction.m);
        }
      }
    });
  }

  public checkForPopularityContestVoteRemoval(msg: MessageSummary): void {
    let getIdx: number;
    const deleteReactionIds: Array<string> = msg.content.delete.messageIDs;
    // check for open popularity contests.
    this.popularityContests.forEach((contest, contestIdx) => {
      deleteReactionIds.forEach((reactionToDeleteId) => {
        getIdx = contest.votesForLeader.indexOf(reactionToDeleteId);
        if (getIdx !== -1) {
          contest.votesForLeader.splice(getIdx, 1);
        }
        getIdx = contest.votesForChallenger.indexOf(reactionToDeleteId);
        if (getIdx !== -1) {
          contest.votesForChallenger.splice(getIdx, 1);
        }
      });
    });
  }

}

export default Snipe;
