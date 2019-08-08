import axios, { AxiosPromise, AxiosRequestConfig } from "axios";
import * as _ from "lodash";
import * as moment from "moment";
import * as mongodb from "mongodb";
import * as os from "os";
import * as throttledQueue from "throttled-queue";
import * as Bot from "./keybase-bot";
import Snipe from "./snipe";

import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";
import { IBetData, IBetList, ICroupierBotConfig, ICroupierDbConfig, IParticipant,
         IPopularityContest, IPositionSize, IPowerup, IPowerupAward,
         IReactionContent } from "./types";

class Croupier {
  public activeSnipes: object;
  public bot1: Bot;
  public bot2: Bot;
  public botUsername: string;
  public paperKey1: string;
  public paperKey2: string;

  // Keeps track of all the channels that have had a Snipe running while the bot was running
  // i.e., whom to notify when the bot goes for shutdown or restarts
  public channelSet: Set<ChatChannel>;

  // Probably should be abstracted into another class
  // That would let us, e.g., replace mongodb with postgres more conveniently
  private mongoDbUri: string;
  private mongoDbUsername: string;
  private mongoDbPassword: string;
  private mongoDbHost: string;
  private mongoDbClient: mongodb.MongoClient;
  private mongoDbDatabaseName: string;
  private mongoDbDatabase: mongodb.Db;
  private mongoDbIsCluster: boolean;

  public constructor(botConfig: ICroupierBotConfig, dbConfig: ICroupierDbConfig) {

    Object.assign(this, botConfig);
    Object.assign(this, dbConfig);

    this.bot1 = new Bot(os.homedir());
    this.bot2 = new Bot(os.homedir());
    this.channelSet = new Set();
  }

  public async init(): Promise<any> {
    this.activeSnipes = {};
    await this.bot1.init(this.botUsername, this.paperKey1, null);
    // Second bot is to read exploding messages
    await this.bot2.initFromRunningService();
    console.log("both bots initialized");
    await this.connectToDatabase();
    console.log("connected to database");

  }

  public async run(loadActiveSnipes: boolean): Promise<any> {
    const self: Croupier = this;
    if (!this.bot1._service.initialized) {
      await this.init();
    }

    if (loadActiveSnipes) {
      this.activeSnipes = await this.loadActiveSnipes();

      console.log("1) loaded activeSnipes");
      console.log("2) ", this.activeSnipes);
      try {

        console.log("?");
        Object.keys(this.activeSnipes).forEach((stringifiedChannel: string) => {
          self.channelSet.add(stringifiedChannel);
        });
        console.log("x");
        console.log("channelSet", self.channelSet);
        self.channelSet.forEach((stringifiedChannel: ChatChannel) => {

          const ch: ChatChannel = JSON.parse(stringifiedChannel);
          self.bot1.chat.send(ch, {
            body: "Croupier was just restarted",
          }, undefined);
          console.log("Sent to channel", ch);

        });

      } catch (e3) {
        console.log("e3", e3);
      }

      console.log("active snipes loaded");
    }

    return this.bot2.chat.watchAllChannelsForNewMessages(
      this.routeIncomingMessage.bind(this), (e) => console.error(e), {
        hideExploding: false,
      });
  }

  public async shutdown(): Promise<any> {

    const self: Croupier = this;

    self.channelSet.forEach(async (stringifiedChannel: string) => {

      const channel: ChatChannel = JSON.parse(stringifiedChannel);
      try {

        await self.bot1.chat.send(channel, {
          body: "Bot is going for immediate shutdown",
        }, undefined);
        if (self.activeSnipes[channel]) {
          const snipe: Snipe = self.activeSnipes[channel];
          clearTimeout(snipe.timeout);
          snipe.runClock = () => {
            // empty
          };
        }
      } catch (e) {
        // empty
      }

    });

    this.activeSnipes = {};

    await this.bot1.deinit();
    await this.bot2.deinit();
  }

  public async checkWalletBalance(username: string): Promise<any> {
    const self: Croupier = this;
    console.log("checking wallet balance");

    return new Promise(async (resolve) => {

      console.log("inside promise");
      self.bot1.wallet
        .lookup(username)
        .then((acct) => {
          axios
            .get(`https://horizon.stellar.org/accounts/${acct.accountId}`)
            .then((res) => {
              let balance: number = 0;
              res.data.balances.forEach((eachAcct) => {
                balance += eachAcct.balance;
              });
              resolve(balance);
            })
            .catch((e) => {
              console.log("e2 error");
              resolve(0);
            });
        })
        .catch((e) => {

          console.log("...error");
          resolve(0);
        });
    });
  }

  public tabulateNetGains(winnerUsername: string, winnerTotal: number,
                          participants: Array<IParticipant>): Promise<number> {
    const self: Croupier = this;
    const netGains: object = {};
    for (const participant of participants) {
      if (typeof netGains[participant.username] === "undefined") {
        netGains[participant.username] = 0;
      }
      netGains[participant.username] -= participant.transaction.amount;
    }
    // Possible the winner was a free participant, someone contributed on their behalf, etc.
    if (typeof netGains[winnerUsername] === "undefined") {
      netGains[winnerUsername] = 0;
    }
    netGains[winnerUsername] += winnerTotal;

    console.log("netGains", netGains);

    return new Promise((resolve) => {

      const collection: mongodb.Collection = self.mongoDbDatabase.collection("netGains");
      collection.updateOne({}, { $inc: netGains }, (err, res) => {
        if (err) {
          console.log("updateOne err", err);
          throw err;
        }

        const projection: object = {};
        projection[winnerUsername] = 1;

        collection.findOne({}, projection).then((doc, err2) => {
          if (err2 || !doc) {
            console.log("findOne err", err2);
            throw err2;
          }

          console.log("findOne doc", doc);
          resolve(doc[winnerUsername]);

        });
      });

    });
  }

  public documentSnipe(snipe: Snipe, reason: string): void {
    const self: Croupier = this;
    let wasCancelled: number;
    let winner: string;
    let cancellationReason: string;

    if (reason === "lack-of-participants" || reason === "flip-error") {
      wasCancelled = 1;
      winner = null;
      cancellationReason = reason;
    } else {
      wasCancelled = 0;
      winner = reason;
      cancellationReason = null;
    }

    const myquery: object = { _id: mongodb.ObjectID(snipe.snipeId) };

    const newvalues: object = {
      $set: {
        cancellation_reason: cancellationReason,
        in_progress: 0,
        updatedAt: +new Date(),
        was_cancelled: wasCancelled,
        winner,
      },
    };

    const snipesCollection: mongodb.Collection = self.mongoDbDatabase.collection("snipes");
    snipesCollection.updateOne(myquery, newvalues, (err2, res) => {
      if (err2) {
        throw err2;
      }
    });

  }

  public async processRefund(txn: Transaction, channel: ChatChannel): Promise<any> {

    console.log("well we did call processRefund");

    const self: Croupier = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    let refund: number;

    console.log("refunding txn");

    return new Promise((resolve) => {

      console.log("inside refund promise");

      setTimeout(() => {

        console.log("inside refund timeout - at least 5s should have passed");

        this.calculateTransactionFees(txn)
          .then((transactionFees) => {
            console.log("not refunding txn fees", transactionFees);
            refund = _.round(txn.amount - transactionFees, 7);
            console.log("total refund is", refund);
            snipe.moneySend(refund, txn.fromUsername).then(() => {
              resolve();
            }).catch((e) => {

              console.log("there was an error with the refund", e);

              self.bot1.chat.send(
                {
                  name: `zackburt,${self.botUsername}`,
                  public: false,
                  topicType: "chat",
                },
                {
                  body: `There was an error processing a refund

              Snipe: ${snipe.snipeId}
              Channel topic: ${channel.topicName}
              Channel name: ${channel.name}
              Amount: ${refund.toString()}
              Recipient: ${txn.fromUsername}
              Initial Txn Id: ${txn.txId}

              ERRORS: ${e}`,
                },
                undefined,
              );
          });
        });

      }, self.MillisecondsToWaitForTransactionToSettle(txn));

    });

  }

  public MillisecondsToWaitForTransactionToSettle(txn: Transaction): number {
    const now: number = +new Date();
    const millisecondsElapsed: number = (now - txn.time);
    let timeToWait: number;
    if (millisecondsElapsed > 5000) {
      timeToWait = 0;
    } else {
      timeToWait = 5000 - millisecondsElapsed;
    }
    console.log("time to Wait before calculating transaction fees", timeToWait);
    return timeToWait;
  }

  public calculateTransactionFees(txn: Transaction): Promise<number> {
    const self: Croupier = this;

    return new Promise((resolve) => {

      // Temporary hack to always return 0.00001 for fees.
      resolve(0.00001);
      return;

      setTimeout(() => {

        self.bot1.wallet.details(txn.txId).then((details) => {
          const xlmFeeMatch: Array<any> = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
          if (xlmFeeMatch !== null) {
            const fee: number = parseFloat(xlmFeeMatch[1]);
            console.log("fee", fee);
            resolve(fee);
          }
        }).catch((e) => {
          console.log(e);
          resolve(0.00001);
        });

      }, self.MillisecondsToWaitForTransactionToSettle(txn));

    });
  }

  public deleteSnipeLog(channel: ChatChannel): void {
    const self: Croupier = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];

    const myquery: object = { _id: mongodb.ObjectID(snipe.snipeId) };

    const snipesCollection: mongodb.Collection = self.mongoDbDatabase.collection("snipes");
    snipesCollection.deleteOne(myquery, (err, res) => {
      if (err) {
        throw err;
      }
    });

  }

  public updateSnipeLog(channel: ChatChannel): void {
    const self: Croupier = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    const participants: string = JSON.stringify(snipe.participants);
    const positionSizes: string = JSON.stringify(snipe.positionSizes);
    const blinds: number = snipe.blinds;
    const snipeId: string = snipe.snipeId;

    const myquery: object = { _id: mongodb.ObjectID(snipe.snipeId) };
    console.log("myQuery", myquery);

    const newvalues: object = {
      $set: {
        blinds,
        clockRemaining: snipe.getTimeLeft(),
        participants,
        position_sizes: positionSizes,
        potSize: snipe.calculatePotSize(),
        updatedAt: +new Date(),
      },
    };

    const snipesCollection: mongodb.Collection = self.mongoDbDatabase.collection("snipes");
    snipesCollection.updateOne(myquery, newvalues, (err, res) => {
      if (err) {
        throw err;
      }
    });

  }

  private connectToDatabase(): Promise<any> {

    const self: Croupier = this;

    if (process.env.TEST) {
      this.mongoDbDatabaseName = "testcroupier";
    } else if (process.env.DEVELOPMENT) {
      this.mongoDbDatabaseName = "devcroupier";
    } else {
      this.mongoDbDatabaseName = "croupier";
    }

    console.log("Talking to db: ", this.mongoDbDatabaseName);
    let uri: string;
    if (this.mongoDbIsCluster) {
      uri = "mongodb+srv://";
    } else {
      uri = "mongodb://";
    }
    uri += `${this.mongoDbUsername}:${this.mongoDbPassword}@${this.mongoDbHost}`;
    uri += `/${this.mongoDbDatabaseName}?retryWrites=true&w=majority`;
    this.mongoDbUri = uri;

    console.log(uri);

    self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, {
      reconnectInterval: 1000,
      reconnectTries: Number.MAX_VALUE,
      useNewUrlParser: true,
    });

    return new Promise(async (resolve) => {

      try {
        await self.mongoDbClient.connect();
        self.mongoDbDatabase = self.mongoDbClient.db(self.mongoDbDatabaseName);

      } catch (err) {
        console.log("we were unable to connect to mongodb");
        throw err;
      }
      resolve();

    });

  }

  private logNewSnipe(snipe: Snipe): Promise<any> {
    const self: Croupier = this;
    return new Promise((resolve, reject) => {

      const snipesCollection: mongodb.Collection = self.mongoDbDatabase.collection("snipes");
      snipesCollection.insertOne(
        {
          bettingStarted: snipe.bettingStarted,
          channel: snipe.channel,
          countdown: snipe.countdown,
          in_progress: 1,
        },
        (err, res) => {
          if (err) {
            console.log(err);
            throw err;
          }
          resolve(res.insertedId.toString());
        },
      );

    });
  }

  private extractTxn(msg: MessageSummary): void {
    const txnId: string = msg.content.text.payments[0].result.sent;
    this.bot1.wallet.details(txnId).then((details) => this.processTxn(details, msg));
  }

  private processTxn(txn: Transaction, msg: MessageSummary): void {
    const channel: ChatChannel = msg.channel;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];

    // If the transaction was not sent to us, then ignore
    if (txn.toUsername !== this.botUsername) {
      return;
    }

    // If they aren't sending XLM but instead some other unexpected asset, then ignore
    const isNative: boolean = txn.asset.type === "native";
    if (!isNative) {
      return;
    }

    if (parseFloat(txn.amount) < 0.01) {
      this.bot1.chat.send(
        channel,
        {
          body: `Thanks for the tip, but bets should be >= 0.01XLM`,
        },
        undefined,
      );
      return;
    }

    if (typeof snipe === "undefined") {
      this.startNewSnipe(msg, txn);
    } else {
      const currentPotSize: number = snipe.calculatePotSize();
      const thisBetSize: number = txn.amount;
      if (currentPotSize + thisBetSize >= 20000) {
        snipe.chatSend(`In order to make Croupier available within as many international territories as possible,
          pot sizes are limited to 20,000 XLM`);
        this.processRefund(txn, channel);
        return;
      }

      if (snipe.bettingOpen === false) {
        snipe.chatSend(`Betting has closed - refunding`);
        // Ensure the transaction is Completed before refunding
        this.processRefund(txn, channel);
        return;
      }

      if (txn.amount < snipe.blinds) {
        snipe.chatSend(`Bet was below blinds - refunding`);
        this.processRefund(txn, channel);
        return;
      }

      snipe.processNewBet(txn, msg).then((betProcessed) => {
        if (betProcessed) {
          snipe.resetSnipeClock();
        }
      });
    }
  }

  private startNewSnipe(msg: MessageSummary, txn: Transaction): void {
    const self: Croupier = this;
    const channel: ChatChannel = msg.channel;
    let countdown: number = 60;
    const countdownMatch: Array<any> = msg.content.text.body.match(/countdown:\s?(\d+)/i);
    if (countdownMatch !== null) {
      countdown = parseInt(countdownMatch[1], 10);
      if (countdown < 5 || countdown > 60 * 60 * 24 * 7) {
        countdown = 60;
        this.bot1.chat.send(
          channel,
          {
            body: `Bad value of countdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
          },
          undefined,
        );
      }
    }

    const chatThrottle: any = throttledQueue(5, 5000);
    const moneyThrottle: any = throttledQueue(1, 1000);

    this.activeSnipes[JSON.stringify(channel)] = new Snipe(this, channel,
      { bot1: this.bot1, bot2: this.bot2 }, { countdown });

    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];

    this.logNewSnipe(snipe).then((snipeId) => {
      snipe.snipeId = snipeId;
      snipe.launchSnipe();
      snipe.processNewBet(txn, msg);
    });
  }

  private respondToDM(msg: MessageSummary): void {
    const channel: ChatChannel = msg.channel;
    const helpMsg: string = `These messages are not monitored.

    Have some feedback?  Message @zackburt here on Keybase.
    Filing a bug report or feature request?  Post on GitHub: https://github.com/codeforcash/croupier/issues/
    Want to read the rules or start a game?  /keybase/team/codeforcash/CROUPIER-RULES.md`;

    this.bot1.chat.send(channel, {
      body: helpMsg,
    });
  }

  private routeIncomingMessage(msg: MessageSummary): void {
    const self: Croupier = this;
    try {

      console.log(msg);

      let snipe: Snipe = this.activeSnipes[JSON.stringify(msg.channel)];

      if (msg.channel.membersType === "impteamnative") {
        if (msg.channel.name.match(/,/g).length === 1) {
          this.respondToDM(msg);
          return;
        }
      }

      if (typeof snipe !== "undefined" && snipe.freeze && msg.sender.username !== snipe.freeze) {
        snipe.freezeBet(msg);
        return;
      }
      if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
        this.extractTxn(msg);
      }

      if (typeof snipe === "undefined") {

        // Check whether we're in a subteam of an active snipe
        // Potential source of application slowdown?
        Object.keys(this.activeSnipes).forEach((stringifiedChannel: string) => {
          const potentialSnipe: Snipe = this.activeSnipes[stringifiedChannel];
          if (potentialSnipe && msg.channel.name === potentialSnipe.subteamName()) {
            snipe = potentialSnipe;
          }
        });

        if (typeof(snipe) === "undefined") {
          return;
        }
      }

      if (msg.content.type === "flip" && msg.sender.username === this.botUsername) {
        snipe.monitorFlipResults(msg);
        return;
      }
      if (msg.content.type === "text" && msg.content.text.body) {
        snipe.checkTextForPowerup(msg);
      }

      if (msg.content.type === "reaction") {
        snipe.checkForPopularityContestVote(msg);
        snipe.checkReactionForPowerup(msg);
        snipe.checkForFreeEntry(msg);
        snipe.checkForJoiningRoom(msg);
      }
      if (msg.content.type === "delete") {
        snipe.checkForPopularityContestVoteRemoval(msg);
      }
    } catch (err) {
      console.error(err);
    }
  }

  private loadActiveSnipes(): object {
    const self: Croupier = this;
    return new Promise((resolve) => {
      const snipes: object = {};
      const myquery: object = { in_progress: 1, blinds: { $exists: true } };

      const snipesCollection: mongodb.Collection = self.mongoDbDatabase.collection("snipes");
      snipesCollection.find(myquery).toArray((err, results) => {
        if (err) {
          throw err;
        }

        console.log(results);

        results.forEach((result) => {
          const channel: ChatChannel = result.channel;
          snipes[JSON.stringify(channel)] = new Snipe(
            self,
            channel,
            {
              bot1: self.bot1,
              bot2: self.bot2,
            },
            {
              bettingStarted: parseInt(result.bettingStarted, 10),
              blinds: parseFloat(result.blinds),
              clockRemaining: result.clockRemaining,
              countdown: result.countdown,
              participants: JSON.parse(result.participants),
              position_sizes: JSON.parse(result.position_sizes),
              potSize: parseInt(result.potSize, 10),
              snipeId: result._id.toString(),
            },
          );
        });

        Object.keys(snipes).forEach((chid) => {
          const snipeChannel: ChatChannel = JSON.parse(chid);
          const snipe: Snipe = snipes[chid];
          snipes[chid].chatSend("Previous bets are still valid!");
          snipes[chid].chatSend(snipe.buildBettingTable());
          snipe.launchSnipe();
        });

        resolve(snipes);
      });
    });

  }
}
export default Croupier;
