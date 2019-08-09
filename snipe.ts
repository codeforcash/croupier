import * as EventEmitter from "events";
import * as _ from "lodash";
import * as moment from "moment";
import * as throttledQueue from "throttled-queue";
import Croupier from "./croupier";
import * as Bot from "./keybase-bot";

import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";

import { IBetData, IBetList, IParticipant, IPopularityContest, IPositionSize, IPowerup, IPowerupAward, IReactionContent } from "./types";

type ThrottledChat = (message: string) => Promise<any>;
type ThrottledMoneyTransfer = (xlmAmount: number, recipient: string) => Promise<any>;

class Snipe {
  public emitter: EventEmitter;
  public bot1: Bot;
  public bot2: Bot;
  public channel: ChatChannel;
  public croupier: Croupier;
  public participants: Array<IParticipant>;
  public bettingOpen: boolean;
  public clock: string;
  public timeout: NodeJS.Timeout;
  public countdown: number;
  public snipeId: string;
  public bettingStops: moment.Moment;
  public chatSend: ThrottledChat;
  public moneySend: ThrottledMoneyTransfer;
  public positionSizes: IPositionSize;
  public reflipping: boolean;
  public runningClocks: object;
  public bettingTable: string;
  public blinds: number;
  public bettingStarted: number;
  public popularityContests: Array<IPopularityContest>;
  public clockRemaining: number;
  public freeze: string;
  public powerups: Array<IPowerupAward>;
  public flipMonitorIntervals: object;
  public croupierMessages: object;
  public freeEntryReactions: Array<string>;
  public scrollCount: number;

  public constructor(croupier: Croupier, channel: ChatChannel, bots: any, options: any) {
    // TODO: Bots and Options should really be interfaces, not an any

    const self: Snipe = this;
    this.scrollCount = 0;
    this.freeEntryReactions = [
      ":smile:",
      ":smiley:",
      ":raising_hand:",
      ":man-raising-hand:",
      ":woman-raising-hand:",
      ":thumbsup:",
      ":clap:",
      ":man-tipping-hand:",
      ":woman-tipping-hand:",
      ":sparkles:",
      ":zany_face:",
      ":+1:",
      ":boom:",
      ":fire:",
      ":tada:",
      ":joy:",
    ];
    this.emitter = new EventEmitter();
    this.croupierMessages = {};
    this.runningClocks = {};
    this.flipMonitorIntervals = {};
    this.croupier = croupier;
    this.croupier.channelSet.add(JSON.stringify(channel));
    this.channel = channel;
    this.bot1 = bots.bot1;
    this.bot2 = bots.bot2;

    this.bettingOpen = true;
    if (options.bettingStarted) {
      this.bettingStarted = parseInt(options.bettingStarted, 10);
    } else {
      this.bettingStarted = +new Date();
    }

    if (typeof options.countdown === "undefined") {
      options.countdown = 60;
    }
    this.countdown = options.countdown;
    this.bettingStops = moment().add(this.countdown, "seconds");

    if (options.blinds) {
      this.blinds = parseFloat(options.blinds);
    } else {
      this.blinds = 0.01;
    }

    const chatThrottle: any = throttledQueue(5, 5000);

    this.chatSend = (message) => {
      return new Promise((resolveChatThrottle) => {
        chatThrottle(() => {
          self.bot1.chat
            .send(
              channel,
              {
                body: message,
              },
              undefined,
            )
            .then((sentMessage) => {
              self.croupierMessages[sentMessage.id] = [];
              resolveChatThrottle(sentMessage);
            });
        });
      });
    };

    this.clock = null;
    if (options.clockRemaining) {
      this.clockRemaining = options.clockRemaining;
    }

    const moneyThrottle: any = throttledQueue(1, 1000);
    this.moneySend = (amount, recipient, extraParams = "") => {
      return new Promise((resolveMoneyThrottle) => {
        moneyThrottle(() => {
          try {

            if (self.channel.membersType === "impteamnative") {
              self.bot1.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(),
                                           recipient, extraParams, true);
            } else {
              self.bot1.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(),
                                           recipient, extraParams, false);
            }

            resolveMoneyThrottle();
          } catch (e) {
            self.bot1.chat.send(
              {
                name: `zackburt,${self.croupier.botUsername}`,
                public: false,
                topicType: "chat",
              },
              {
                body: `There was an error sending money

              Snipe: ${self.snipeId}
              Channel topic: ${channel.topicName}
              Channel name: ${channel.name}
              Amount: ${amount.toString()}
              Recipient: ${recipient}
              Extra Params: ${extraParams}

              ERRORS: ${e}`,
              },
              undefined,
            );
          }
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

    if (options.snipeId) {
      this.snipeId = options.snipeId.toString();
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

  // Issue a powerup if...
  //   The same person made 3 paid bets in a row
  //   OR the same person made 10 FREE bets in a row
  //
  // But DO NOT if they have recently been issued a powerup.

  public shouldIssuePowerup(): boolean {
    const count: number = this.participants.length;

    const self: Snipe = this;

    // Have there been at least 3 bets?
    // And have the 3 most recent bets all been entered by the same person?
    if (
      count >= 3 &&
      this.participants[count - 1].username === this.participants[count - 2].username &&
      this.participants[count - 2].username === this.participants[count - 3].username
    ) {

      // If any of the last 3 bets were freeBets, let's ensure that all 10 were free Bets and by the same person.
      // If so, return true; if not, return false.
      // Otherwise, proceed with normal paid bet logic.
      if (this.participants[count - 1].transaction.freeBet || this.participants[count - 2].transaction.freeBet ||
          this.participants[count - 3].transaction.freeBet) {

        if (count >= 10) {

          const issuee: string = this.participants[count - 1].username;

          for (let i: number = 1; i <= 10; i++) {
            if (this.participants[count - i].username !== issuee) {
              return false;
            }
            if (!this.participants[count - i].transaction.freeBet) {
              return false;
            }
          }

          // Ok, the last 10 have all been free bets by username.
          // But when was the most recent powerup issued?

          let lastPowerupIndex: number = 0;
          this.participants.forEach((participant, idx) => {
            if (participant.powerup) {
              lastPowerupIndex = idx;
            }
          });

          // Have we never issued a powerup before? Then, issue.
          if (lastPowerupIndex === 0) {
            return true;
          }

          // Has it been at least 3 powerups since the most recent powerup was issued?
          // This logic doesn't work if there has never been a powerup issued,
          // hence the extra condition check ^
          if (count - 1 - lastPowerupIndex >= 10) {
            return true;
          } else {
            return false;
          }

        } else {
          return false;
        }

      } else {
        //  This branch contains the logic for deciding whether to award
        //  a powerup for a paid bet.

        // If any of the 3 most recent were free bets, do not award powerup.
        for (let i: number = 1; i <= 3; i++) {
          if (this.participants[count - i].transaction.freeBet) {
            return false;
          }
        }

        //  Get the index of the bet for which the most recent powerup was issued
        let lastPowerupIndex: number = 0;
        this.participants.forEach((participant, idx) => {
          if (participant.powerup) {
            lastPowerupIndex = idx;
          }
        });

        // Have we never issued a powerup before? Then, issue.
        if (lastPowerupIndex === 0) {
          return true;
        }

        // Has it been at least 3 powerups since the most recent powerup was issued?
        // This logic doesn't work if there has never been a powerup issued,
        // hence the extra condition check ^
        if (count - 1 - lastPowerupIndex >= 3) {
          return true;
        } else {
          return false;
        }

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
    const self: Snipe = this;
    this.popularityContests.forEach((contest, contestIdx) => {
      if (contest.votesForChallenger.length >= 3) {
        const leaderPositionSize: number = self.positionSizes[contest.leader];
        const challengerPositionSize: number = self.positionSizes[contest.challenger];
        self.positionSizes[contest.leader] = challengerPositionSize;
        self.positionSizes[contest.challenger] = leaderPositionSize;
        let sassySwapMsg: string = `@${contest.challenger} and @${contest.leader} have swapped position sizes!`;
        sassySwapMsg += ` You can't buy your way to the top in this game!`;
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
    this.chatSend(
      `Congrats @${awardee}, you won the **${award.name}** powerup.
      *${award.description}*
      Click the emoji to consume the powerup.`,
    ).then((msg) => {
      this.bot2.chat.react(this.channel, msg.id, award.reaction, undefined);
      this.participants[participantIndex].powerup.reactionId = msg.id;
    });
  }

  public addSnipeParticipants(txn: Transaction, onBehalfOfList: Array<string>): Promise<any> {

    const self: Snipe = this;
    return new Promise((resolve) => {

      let newParticipant: IParticipant;
      onBehalfOfList.forEach((onBehalfOf) => {

        if (typeof self.positionSizes[onBehalfOf] === "undefined") {
          self.positionSizes[onBehalfOf] = Math.max(1, Math.floor(txn.amount / 0.01));
        } else {
          self.positionSizes[onBehalfOf] += Math.max(1, Math.floor(txn.amount / 0.01));
        }
      });

      newParticipant = {
        onBehalfOf: "here",
        transaction: txn,
        username: txn.fromUsername,
      };
      self.participants.push(newParticipant);

      if (this.shouldIssuePowerup()) {
        this.issuePowerup(self.participants.length - 1);
      }

      try {
        self.croupier.updateSnipeLog(self.channel);
      } catch (e) {
        // Could not update database at this time
        console.log("Could not update snipe log", e);
      }

      resolve(true);

    });

  }

  public addSnipeParticipant(txn: Transaction, onBehalfOf?: string): void {

    console.log("add snipe participant called");

    const self: Snipe = this;
    let newParticipant: IParticipant;
    let betBeneficiary: string;

    if (typeof onBehalfOf === "undefined") {
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
    if (typeof self.positionSizes[betBeneficiary] === "undefined") {
      self.positionSizes[betBeneficiary] = Math.floor(txn.amount / 0.01);
    } else {
      self.positionSizes[betBeneficiary] += Math.floor(txn.amount / 0.01);
    }

    if (this.shouldIssuePowerup()) {
      this.issuePowerup(self.participants.length - 1);
    }

    try {
      self.croupier.updateSnipeLog(self.channel);
     } catch (e) {
       console.log("was unable to successfully updateSnipeLog", e);
     }
    console.log("update snipe log called");
  }

  public clearSnipe(reason: string): void {
    console.log("clearing cuz ", reason);
    this.croupier.documentSnipe(this, reason);
    this.croupier.activeSnipes[JSON.stringify(this.channel)] = undefined;
  }

  public calculateSnipeBounty(): Promise<number> {
    let bounty: number = 0;
    const self: Snipe = this;

    return new Promise((resolve) => {
      const transactionFeePromises: Array<Promise<any>> = [];

      self.participants.forEach((participant) => {
        if (!participant.transaction.freeBet) {
          bounty += parseFloat(participant.transaction.amount);
          transactionFeePromises.push(self.croupier.calculateTransactionFees(participant.transaction));
        }
      });

      Promise.all(transactionFeePromises).then((values: Array<number>) => {
        values.forEach((val) => {
          bounty -= val;
        });
        bounty = _.round(bounty, 7);
        resolve(bounty);
      });
    });
  }

  public sendAmountToWinner(winnerUsername: string, bounty: number, channel: ChatChannel): Promise<any> {
    const self: Snipe = this;

    return new Promise((resolve) => {
      //  If winnerUsername is a participant in this chat, moneySend
      //  Otherwise, use stellar.expert.xlm method

       self.getChannelMembers(channel).then((allMembers) => {
          // it's possible the winner is not in the chat, that they won through a onBehalfOf contribution of someone else
          if (allMembers.indexOf(winnerUsername) === -1) {
            try {
              self.bot1.wallet.send(winnerUsername, bounty.toString()).then((txn) => {
                let bountyMsg: string = `\`+${bounty}XLM@${winnerUsername}\` `;
                bountyMsg += `:arrow_right: `;
                bountyMsg += `https://stellar.expert/explorer/public/tx/${txn.txId}\n\n`;
                bountyMsg += `Please contact ${winnerUsername} and request they claim their winnings.`;
                self.chatSend(bountyMsg);
                console.log("emitting roundComplete event");
                self.emitter.emit("roundComplete");
                resolve();
              });
            } catch (e) {
              self.bot1.chat.send(
                {
                  name: `zackburt,${self.croupier.botUsername}`,
                  public: false,
                  topicType: "chat",
                },
                {
                  body: `There was an error sending money to a winner

              Snipe: ${self.snipeId}
              Winner: ${winnerUsername}
              Amount: ${bounty.toString()}

              ERRORS: ${e}`,
                },
                undefined,
              );
              throw e;
            }
          } else {
            self.moneySend(bounty, winnerUsername).then((d) => {
              console.log("emitting roundComplete event");
              self.emitter.emit("roundComplete");
              resolve();
            }).catch((e) => {
              self.bot1.chat.send(
                {
                  name: `zackburt,${self.croupier.botUsername}`,
                  public: false,
                  topicType: "chat",
                },
                {
                  body: `There was an error sending money to a winner

              Snipe: ${self.snipeId}
              Winner: ${winnerUsername}
              Amount: ${bounty.toString()}

              ERRORS: ${e}`,
                },
                undefined,
              );
            });
          }
        });
    });
  }

  public resolveFlip(winningNumber: number): Promise<string> {
    const self: Snipe = this;
    let winnerUsername: string;
    const bettorRange: object = this.buildBettorRange();
    Object.keys(bettorRange).forEach((username) => {
      if (bettorRange[username][0] <= winningNumber && bettorRange[username][1] >= winningNumber) {
        winnerUsername = username;
      }
    });

    this.chatSend(`Congrats to @${winnerUsername}`);

    return new Promise((resolve) => {
      console.log("calculating snipe bounty");
      this.calculateSnipeBounty().then((bounty) => {
        console.log("calculated the bounty", bounty);

        self.croupier.tabulateNetGains(winnerUsername, bounty, self.participants).then((winnerNetGains) => {
          console.log("tabulated the net gains", winnerNetGains);
          if (winnerNetGains < 5000) {
            console.log("calling sendAmountToWinner");
            self.sendAmountToWinner(winnerUsername, bounty, self.channel).then(() => {
              console.log("resolved sendAmountToWinner", winnerUsername);
              resolve(winnerUsername);
            });
          } else {
            const w9url: string = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";
            const w8benurl: string = "https://www.irs.gov/pub/irs-pdf/fw8ben.pdf";
            const channelName: string = `zackburt,${self.croupier.botUsername},${winnerUsername}`;
            const channel: ChatChannel = { name: channelName, public: false, topicType: "chat" };

            self.bot1.chat.send(
              channel,
              {
                body: `Congratulations on winning snipe ${self.snipeId} and the bounty ${bounty}

                In order to send your winnings we must process a tax form.

                If you live in the US, reply with this complete form: ${w9url}

                If you live outside the US, reply with this complete form: ${w8benurl}`,
              },
              undefined,
            );
            resolve(winnerUsername);
          }
        });
      });
    });
  }

  public buildBettorRange(): any {
    const bettorMap: object = {};
    const self: Snipe = this;
    const bettorRange: object = {};
    let start: number = 0;

    Object.keys(self.positionSizes)
      .sort((a, b) => {
        return self.positionSizes[a] > self.positionSizes[b] ? -1 : 1;
      })
      .forEach((username) => {
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
      const chancePct: number = 100 * ((1 + (bettorRange[username][1] - bettorRange[username][0])) / maxValue);

      bettingTable += `\n${bettorRank}. ${username}: \``;
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

  public subteamName(): string {

    console.log("this.snipeId", this.snipeId);
    console.log("typeof this.snipeId", typeof(this.snipeId));

    const subTeamId: string = this.snipeId.substr(0, 11);
    return `${process.env.SUBTEAM_NAME}.snipe${subTeamId}`;

  }

  public makeSubteamForFlip(): void {
    const self: Snipe = this;

    try {

      const usernamesToAdd: Array<object> = [{
         role: "admin", username: self.croupier.botUsername,
      }];

      console.log("Creating the subteam", self.subteamName());

      const newSubteam: ChatChannel = {
        membersType: "team",
        name: self.subteamName(),
      };

      self.bot1.team.createSubteam(self.subteamName()).then((res) => {
        console.log("Subteam creation complete!", res);
        console.log("Attempting to add self to the team", usernamesToAdd);

        self.bot1.team
          .addMembers({
            team: self.subteamName(),
            usernames: usernamesToAdd,
          });

        self.chatSend(`Anyone is free to join the subteam @${self.subteamName()} ...
        Reflip is in 30 seconds.`).then((sentChat) => {
          self.bot2.chat.react(self.channel, sentChat.id, "Invite Me", undefined);
        });

        setTimeout(() => {

          try {
            self.flip(newSubteam);
          } catch (e) {
            console.log(e);
            self.flip(newSubteam);
          }

        }, 30 * 1000);

      }).catch((e) => {

        console.log("Unfortunately could not create the subteam, due to ", e);

      });

    } catch (e2) {
      console.log("ran into issue:", e2);
    }
  }

  public flip(whereToFlip: ChatChannel): void {
    const self: Snipe = this;
    if (typeof whereToFlip === "undefined") {
      whereToFlip = self.channel;
    }

    const bettorRange: object = this.buildBettorRange();
    const bettingValues: Array<Array<number>> = Object.values(bettorRange);
    const flatBettingValues: Array<number> = _.flatten(bettingValues);
    const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
    const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

    this.bot1.chat.send(
      whereToFlip,
      {
        body: "**Final betting table...**",
      },
      undefined,
    );
    this.bot1.chat.send(
      whereToFlip,
      {
        body: self.buildBettingTable(),
      },
      undefined,
    );
    this.bot1.chat
      .send(
        whereToFlip,
        {
          body: `/flip ${minBet}..${maxBet}`,
        },
        undefined,
      )
      .then((res) => {
        self.reflipping = false;
      });
  }

  public processNewBet(txn: Transaction, msg: MessageSummary): Promise<boolean> {
    const channel: ChatChannel = msg.channel;
    const onBehalfOfMatch: Array<any> = msg.content.text.body.match(/(for):?\s?@?(\w+@?(\w+)?)/i);

    const self: Snipe = this;

    console.log("process new bet");

    return new Promise((resolve) => {
      if (onBehalfOfMatch !== null) {
        const onBehalfOfRecipient: string = onBehalfOfMatch[2];
        self.processNewBetOnBehalfOf(txn, msg, onBehalfOfRecipient, resolve);
      } else {
        self.addSnipeParticipant(txn, undefined);
        self.bot2.chat.react(channel, msg.id, ":heavy_check_mark:", undefined);
        resolve(true);
      }
    });
  }

  public processNewBetOnBehalfOf(txn: Transaction, msg: MessageSummary, recipient: string, resolve: any): void {
    const channel: ChatChannel = msg.channel;
    const self: Snipe = this;
    const currentPotSize: number = this.calculatePotSize();

    if (recipient === "here") {
      self.processNewBetForChannel(txn, msg, resolve);
      return;
    }

    // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
    // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
    // new wallets

    self.croupier
    .checkWalletBalance(recipient)
    .then((balance) => {

      console.log(balance);
      if (balance === null || balance < 2.01) {
        if ((currentPotSize + txn.amount) <= 2.01) {

          console.log(txn.amount);
          console.log(typeof txn.amount);

          const howMuchToBet: number = 2.01 - currentPotSize;

          let sassyMessage: string = `Betting on behalf of ${recipient}?  `;
          sassyMessage += "Seems like they do not have a wallet yet, ";
          sassyMessage += `so in the event they win, they must win at least 2.01XLM. `;
          sassyMessage += `Therefore, please bet at least ${howMuchToBet.toString()}XLM`;
          sassyMessage += ` (plus a smidge extra to cover the transaction fees)`;
          self.chatSend(sassyMessage);
          console.log("calling processRefund");
          self.croupier.processRefund(txn, msg.channel).then(() => {
            resolve(false);
          }).catch((e) => {
            console.log(e);
          });
        } else {
          self.addSnipeParticipant(txn, recipient);
          self.chatSend(`@${recipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
          self.bot2.chat.react(channel, msg.id, ":gift:", undefined);
          resolve(true);
        }
      } else if (typeof self.positionSizes[txn.fromUsername] === "undefined") {
        self.chatSend(`You cannot bet on behalf of ${recipient} unless you are participating as well`);
        self.croupier.processRefund(txn, msg.channel).then(() => {
            resolve(false);
        }).catch((e) => {
          console.log(e);
        });
      } else {
        self.addSnipeParticipant(txn, recipient);
        self.chatSend(`@${recipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
        self.bot2.chat.react(channel, msg.id, ":gift:", undefined);
        resolve(true);
      }
    }).catch((e) => {
      // blank
      console.log("ran into error", e);
    });

  }

  public calculatePotSize(): number {
    let sum: number;
    sum = 0;
    this.participants.forEach((participant) => {

      console.log("participant", participant);

      if (!participant.transaction.freeBet) {
        sum += parseFloat(participant.transaction.amount);
      }
    });
    return sum;
  }

  public getTimeLeft(): number {
    return Math.ceil(Math.abs(moment.duration(this.bettingStops.diff(moment())).asSeconds()));
  }

  public resetSnipeClock(): void {
    const timeRemaining: number = Math.ceil(this.getTimeLeft());
    console.log("time remaining", timeRemaining);
    clearTimeout(this.timeout);

    let boost: number;
    let timerEndsInSeconds: number;
    if (timeRemaining <= 30) {
      if (process.env.TEST) {
        // If we're in the test suite, don't add time to the clock
        timerEndsInSeconds = timeRemaining;
      } else {
        timerEndsInSeconds = 60;
      }
    } else {
      boost = 10;
      timerEndsInSeconds = timeRemaining + boost;
    }

    this.bettingStops = moment().add(timerEndsInSeconds, "seconds");

    const self: Snipe = this;
    const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
      self.finalizeBets();
    }, timerEndsInSeconds * 1000);
    this.timeout = finalizeBetsTimeout;
  }

  public launchSnipe(): void {
    // Tell the channel: OK, your snipe has been accepted for routing.
    const self: Snipe = this;
    let message: string = `The round has begun (**#${self.snipeId}**).  `;
    message += `Bet in multiples of 0.01XLM.  Betting format:`;
    message += `\`\`\`+0.01XLM@${self.croupier.botUsername}\`\`\``;
    message += `Minimum bet: 0.01XLM\n`;
    message += `Make 3 uninterrupted bets and receive a powerup!`;
    message += `\n\n**Please ensure you have read the rules before making any bets**  `;
    message += `/keybase/public/${this.croupier.botUsername}/RULES.md`;

    self.chatSend(message);

    self.chatSend(`Betting stops ${moment().to(self.bettingStops)}`).then((sentMessage) => {
      self.clock = sentMessage.id;
      self.runClock();
    });

    const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
      self.finalizeBets();
    }, self.countdown * 1000);
    self.timeout = finalizeBetsTimeout;
  }

  public finalizeBets(): void {
    const self: Snipe = this;
    self.chatSend("No more bets!");
    self.bettingOpen = false;
    // Give 5 seconds to finalize transactions + 1 extra.
    setTimeout(() => {
      self.executeFlipOrCancel();
    }, 6 * 1000);
  }

  public refundAllParticipants(): void {
    const self: Snipe = this;
    const bets: IBetList = {};
    self.participants.forEach((participant) => {
      if (typeof bets[participant.transaction.fromUsername] === "undefined") {
        const betData: IBetData = {
          fees: [],
          wagers: [],
        };
        bets[participant.transaction.fromUsername] = betData;
      }
      bets[participant.transaction.fromUsername].fees.push(
        self.croupier.calculateTransactionFees(participant.transaction));
      bets[participant.transaction.fromUsername].wagers.push(
        participant.transaction.amount);
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
    const self: Snipe = this;
    const uniqParticipants: Array<string> = _.union(Object.keys(self.positionSizes));
    if (uniqParticipants.length > 1) {
      self.flip(self.channel);
    } else {
      self.refundAllParticipants();
      self.chatSend("The snipe has been canceled due to a lack of participants.");
      self.clearSnipe("lack-of-participants");
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
    const self: Snipe = this;
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

    const subteamMatch: RegExp = new RegExp(`{process.env.SUBTEAM_NAME}\.snipe(\d+)`);
    const channelMatch: Array<any> = channelName.match(subteamMatch);
    const snipeId: number = parseInt(channelMatch[1], 10);
    return this.getChannelFromSnipeId(snipeId);
  }

  public monitorFlipResults(msg: MessageSummary): void {
    const self: Snipe = this;
    let ourChannel: boolean;
    let snipe: Snipe;

    self.flipMonitorIntervals[msg.conversationId] = setInterval(() => {
      try {
        self.bot1.chat
          .loadFlip(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId)
          .then((flipDetails) => {
            if (flipDetails.phase === 2) {
              console.log("results are in");
              clearInterval(self.flipMonitorIntervals[msg.conversationId]);

              if (JSON.stringify(self.channel) !== JSON.stringify(msg.channel)) {
                let copyResults: string = `The winning number in @${msg.channel.name} `;
                copyResults += `was **${flipDetails.resultInfo.number}**`;
                self.chatSend(copyResults);
              }

              self.resolveFlip(flipDetails.resultInfo.number).then((winner) => {
                self.clearSnipe(winner);
              });
            } else {
              // Do nothing.
              console.log("results are NOT in");
            }
          })
          .catch((err) => {
            console.log("Error: ", err);

            const subteamMatch: RegExp = new RegExp(`${process.env.SUBTEAM_NAME}\.snipe(\d+)`);
            const channelMatch: Array<any> = msg.channel.name.match(subteamMatch);
            if (channelMatch === null) {
              snipe = self.croupier.activeSnipes[JSON.stringify(msg.channel)];
              ourChannel = false;
            } else {
              console.log("channelMatch", channelMatch[1]);
              const originalChannel: ChatChannel = self.getChannelFromSnipeId(parseInt(channelMatch[1], 10));
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
              self.bot1.chat
                .getFlipData(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId)
                .then((getFlipDataRes) => {
                  console.log("getflipdata res!");
                  console.log(getFlipDataRes);
                  const stdout: string = getFlipDataRes[1];
                  console.log(stdout);

                  const result: any = JSON.parse(stdout.trim()).result;
                  const errorInfo: any = result.status.errorInfo;
                  console.log(errorInfo);

                  if (Object.keys(result.status).indexOf("errorInfo") !== -1 &&
                      errorInfo.dupreg && errorInfo.dupreg.user) {
                    self.bot1.team
                      .removeMember({
                        team: msg.channel.name,
                        username: errorInfo.dupreg.user,
                      })
                      .then((removeMemberRes) => {
                        snipe.chatSend(`We have punted ${errorInfo.dupreg.user} for duplicate registration issues`);
                        self.flip(msg.channel);
                      });
                  } else if (result.status.phase === 2) {
                    console.log("results are in");
                    console.log(result.status.resultInfo.number);
                    clearInterval(self.flipMonitorIntervals[msg.conversationId]);

                    self.resolveFlip(result.status.resultInfo.number).then((winner) => {
                      console.log("winner", winner);

                      self.clearSnipe(winner);
                    });
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
    }, 5000);
  }

  public adjustBlinds(): void {
    const now: number = +new Date();
    const secondsElapsed: number = Math.floor((now - this.bettingStarted) / 1000);
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
      this.chatSend(`Blinds are raised. Minimum bet to receive powerup: **${this.displayFixedNice(blinds)}XLM**`);
    }
  }

  public runClock(): void {
    const self: Snipe = this;
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

        let stopsWhen: string = moment().to(self.bettingStops);
        if (seconds < 55) {
          stopsWhen = `in ${seconds} seconds`;
        }

        const reminderMessage: string = `Reminder: rules are here, ${self.croupier.pathToRules()}`;
        const timeMessage: string = hourglass + ` betting stops ${stopsWhen}`;
        let freeBetReminder: string = `Reminder: bet for free by reacting to my messages with `;
        freeBetReminder += `any of these emojis: `;
        this.freeEntryReactions.forEach((reaction) => {
          freeBetReminder += reaction;
          freeBetReminder += " ";
        });
        let howToBetReminder: string = `Reminder: bet by typing \``;
        howToBetReminder += `+0.1XLM@${self.croupier.botUsername}\``;

        let display: string = `${reminderMessage}\n${howToBetReminder}\n${freeBetReminder}\n`;
        display += self.buildBettingTable();
        display += `\n${timeMessage}`;

        console.log(self.scrollCount);
        if (self.scrollCount >= 10) {

          try {
            self.bot1.chat.delete(self.channel, self.clock);
          } catch (e) {
            console.log("Ran into problems", e);
          }
          self.clock = null;
          self.scrollCount = 0;
        }

        if (self.clock === null || typeof self.clock === "undefined") {
          self
            .chatSend(display)
            .then((sentMessage) => {
              self.clock = sentMessage.id;
            })
            .catch((e) => {
              console.log(e);
            });
        } else {

            self.bot1.chat
            .edit(self.channel, self.clock, {
              message: {
                body: display,
              },
            })
            .then((res) => {
              console.log(res);
            })
            .catch((e) => {
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
    const self: Snipe = this;
    const powerupsCount: object = {};

    self.participants.forEach((bet: IParticipant) => {
      if (bet.powerup && bet.powerup.usedAt === null && bet.username === whose) {
        const awardJsonified: string = JSON.stringify(bet.powerup.award);
        if (typeof powerupsCount[awardJsonified] === "undefined") {
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
    const self: Snipe = this;
    // would be better to have the regexp match object type
    const powerupsQuery: Array<any> = msg.content.text.body.match(/(\.powerups|🐶|:dog:)\s?@?(\w+)?/);
    if (powerupsQuery !== null) {
      if (typeof powerupsQuery[2] !== "undefined") {
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
            if (
              msg.content.text.body.toLowerCase().indexOf(bet.powerup.award.reaction) !== -1 ||
              msg.content.text.body.indexOf(bet.powerup.award.emoji) !== -1
            ) {
              self.consumePowerup(bet.powerup);
            }
          }
        }
      });
    }
  }

  public countFreeBets(): number {
    const self: Snipe = this;
    let freeBets: number = 0;
    self.participants.forEach((participant) => {
      if (participant.transaction.freeBet) {
        freeBets++;
      }
    });
    return freeBets;
  }

  public checkForJoiningRoom(msg: MessageSummary): void {

    const self: Snipe = this;
    const reactionId: string = msg.id;
    const reactionContent: IReactionContent = msg.content;

    console.log(JSON.stringify(reactionContent));
    if (reactionContent.reaction.b === "Invite Me") {

      const usernamesToAdd: Array<object> = [{
         role: "writer", username: msg.sender.username,
      }];

      const newSubteam: ChatChannel = {
        membersType: "team",
        name: self.subteamName(),
      };

      self.bot1.team
        .addMembers({
          team: self.subteamName(),
          usernames: usernamesToAdd,
        });
    }

  }

  public checkForFreeEntry(msg: MessageSummary): void {
    const self: Snipe = this;

    console.log("-------------------------");

    console.log("Checking for free entry");

    let freeBet: boolean = false;

    if (msg.content.type === "reaction") {
      const reactionId: string = msg.id;
      const reactionContent: IReactionContent = msg.content;

      if (self.freeEntryReactions.includes(reactionContent.reaction.b)) {

        // Has croupier sent a message with messageId == what the reaction is pointing to?
        if (Object.keys(self.croupierMessages).includes(reactionContent.reaction.m.toString())) {

          // Have we already counted this reaction?
          if (!self.croupierMessages[reactionContent.reaction.m].includes(msg.sender.username)) {

            self.croupierMessages[reactionContent.reaction.m].push(msg.sender.username);
            freeBet = true;

          }
        }
      }

    } else if (msg.content.type === "text" && msg.sender.username !== self.croupier.botUsername) {

      self.freeEntryReactions.forEach((freeEntryReaction: string) => {

        if (msg.content.text.body.includes(freeEntryReaction)) {
          freeBet = true;
        }

      });
    }

    if (freeBet) {
      if (!self.bettingOpen) {
        return;
      }

      self.addSnipeParticipant(
        {
          amount: 0.01,
          freeBet: true,
          fromUsername: msg.sender.username,
        },
        msg.sender.username,
      );

      // Encourage other people to join in
      let positiveMessage: string = `Thanks to positive energy, ${msg.sender.username}`;
      positiveMessage += ` earned an extra point in the betting table!`;

      const freeBetsCount: number = self.countFreeBets();

      if (freeBetsCount === 1 || freeBetsCount % 10 === 0) {
        self.chatSend(positiveMessage);
      }

      self.resetSnipeClock();

    }

  }

  public checkReactionForPowerup(msg: MessageSummary): void {
    const reactionId: string = msg.id;
    const reactionContent: IReactionContent = msg.content;
    const self: Snipe = this;

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
    const self: Snipe = this;
    return _.maxBy(_.keys(this.positionSizes), (username: string) => {
      return self.positionSizes[username];
    });
  }

  public consumePowerup(powerup: IPowerup): void {
    const self: Snipe = this;
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
        sassyMessage += `Any action by anyone other than ${consumer} or @${self.croupier.botUsername}`;
        sassyMessage += ` during the next 10 seconds will be ignored and instead`;
        sassyMessage += ` increase ${consumer}'s position by 1.`;
        self.chatSend(sassyMessage);
        self.freeze = consumer;
        setTimeout(() => {
          self.chatSend(`@${consumer}'s freeze has expired!`);
          self.freeze = undefined;
        }, 1000 * 10);
        break;
      case "the-final-countdown":
        sassyMessage = `@${consumer} played The Final Countdown.  `;
        sassyMessage += `Will things ever be the same again?  60 seconds on the clock.  `;
        sassyMessage += `It's the final countdown.`;
        self.chatSend(sassyMessage).then(() => {
          self.bettingStops = moment().add(60, "seconds");
        });
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
      case "half-life": // Cut the remaining time in half
        const timeToSubtract: number = Math.floor(self.getTimeLeft() / 2.0);
        self.bettingStops = self.bettingStops.subtract(timeToSubtract, "seconds");
        self.chatSend(`@${consumer} chopped ${timeToSubtract} seconds off the clock.`);
        doNotResetClock = true;
        break;
      case "double-life": // Double the remaining time
        const timeToAdd: number = Math.floor(self.getTimeLeft());
        self.bettingStops = self.bettingStops.add(timeToAdd, "seconds");
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
          let pcFailMsg: string = `${consumer} played :dancers:, but you cannot challenge yourself in this game.`;
          pcFailMsg += ` ::powerup fizzles::`;
          self.chatSend(pcFailMsg);
          return;
        }

        sassyMessage = `@${consumer} called a popularity contest to challenge @${leader}'s throne!`;
        sassyMessage += `  Whom do you prefer?  `;
        sassyMessage += `First to 3 votes wins `;
        sassyMessage += `(4 votes including the initial reaction seeded by me the Croupier)!`;
        self.chatSend(sassyMessage).then((msgData) => {
          const challengerReaction: Promise<any> = self.bot2.chat.react(self.channel, msgData.id, `${consumer}`);
          const leaderReaction: Promise<any> = self.bot2.chat.react(self.channel, msgData.id, `${leader}`);
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
    if (typeof this.popularityContests === "undefined") {
      return;
    }
    const reactionId: string = msg.id;
    const reactionContent: IReactionContent = msg.content;
    const self: Snipe = this;
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

  private getChannelMembers(channel: ChatChannel): Promise<any> {

    const self: Snipe = this;

    return new Promise(async (resolve) => {

      if (channel.membersType === "impteamnative") {
        resolve(channel.name.split(","));
      } else {
        let allMembers: Array<string> = [];
        self.bot1.team
        .listTeamMemberships({
          team: channel.name,
        })
        .then((res) => {
          allMembers = allMembers.concat(res.members.owners.map((u) => u.username));
          allMembers = allMembers.concat(res.members.admins.map((u) => u.username));
          allMembers = allMembers.concat(res.members.writers.map((u) => u.username));
          allMembers = allMembers.concat(res.members.readers.map((u) => u.username));
          resolve(allMembers);
        });

      }

    });

  }

  private processNewBetForChannel(txn: Transaction, msg: MessageSummary, resolve: any): void {

    const channel: ChatChannel = msg.channel;
    const self: Snipe = this;

    self.bot2.chat.react(channel, msg.id, ":gift:", undefined);

    if (txn.amount < 2.01) {
      self.chatSend("Please send >=2.01XLM for an @here snipe - just adding you instead");
      self.addSnipeParticipant(txn);
      resolve(true);
      return;
    }

    self.bot1.chat.listHere(self.channel.topicName, self.channel.name)
    .then((allMembers) => {

      self.addSnipeParticipants(txn, allMembers).then((res2) => {

        resolve(true);

      });

    });
  }
}

export default Snipe;
