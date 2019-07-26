import axios, { AxiosPromise, AxiosRequestConfig } from "axios";
import * as _ from "lodash";
import * as moment from "moment";
import * as mongodb from "mongodb";
import * as os from "os";
import * as throttledQueue from "throttled-queue";
// @ts-ignore
import * as Bot from "./keybase-bot";
import Snipe from "./snipe";

// @ts-ignore
import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";
import { IBetData, IBetList, IParticipant, IPopularityContest, IPositionSize, IPowerup, IPowerupAward, IReactionContent } from "./types";

class Croupier {
  public activeSnipes: object;
  public bot1: Bot;
  public bot2: Bot;
  public botUsername1: string;
  public botUsername2: string;
  public paperKey1: string;
  public paperKey2: string;

  private mongoDbUri: string;
  private mongoDbClient: mongodb.MongoClient;

  public constructor(
    botUsername1: string,
    botUsername2: string,
    paperKey1: string,
    paperKey2: string,
    mongoDbUsername: string,
    mongoDbPassword: string,
    mongoDbHost: string,
    isCluster: boolean,
  ) {
    let mongoDbDatabase: string;
    if (process.env.TEST) {
      mongoDbDatabase = "testcroupier";
    } else if (process.env.DEVELOPMENT) {
      mongoDbDatabase = "devcroupier";
    } else {
      mongoDbDatabase = "croupier";
    }

    let uri: string;
    if (isCluster) {
      uri = "mongodb+srv://";
    } else {
      uri = "mongodb://";
    }
    if (mongoDbUsername === "" && mongoDbPassword === "") {
      uri += `${mongoDbHost}`;
    } else {
      uri += `${mongoDbUsername}:${mongoDbPassword}@${mongoDbHost}`
    }
    uri += `/${mongoDbDatabase}?retryWrites=true&w=majority`;

    this.mongoDbUri = uri;

    this.botUsername1 = botUsername1;
    this.botUsername2 = botUsername2;

    // @ts-ignore
    this.bot1 = new Bot(os.homedir());
    // @ts-ignore
    this.bot2 = new Bot(os.homedir());
    this.paperKey1 = paperKey1;
    this.paperKey2 = paperKey2;
  }

  public async init(): Promise<any> {
    this.activeSnipes = {};
    await this.bot1.init(this.botUsername1, this.paperKey1, null);
    await this.bot2.init(this.botUsername2, this.paperKey2, null);
    console.log("both paper keys initialized");
  }

  public async run(loadActiveSnipes: boolean): Promise<any> {
    if (!this.bot1._service.initialized) {
      await this.init();
    }

    if (loadActiveSnipes) {
      this.activeSnipes = await this.loadActiveSnipes();
      console.log("active snipes loaded");
    }

    return this.bot1.chat.watchAllChannelsForNewMessages(
      this.routeIncomingMessage.bind(this), (e) => console.error(e), undefined);
  }

  public async shutdown(): Promise<any> {
    for (const snipe of Object.values(this.activeSnipes)) {
      try {
        clearTimeout(snipe.timeout);
        snipe.runClock = () => {
          // empty
        };
      } catch (e) {
        // empty
      }
    }
    this.activeSnipes = {};

    await this.bot1.deinit();
    await this.bot2.deinit();
  }

  public async checkWalletBalance(username: string): Promise<any> {
    const self: Croupier = this;
    return new Promise(async (resolve) => {
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
              console.log(e);
              throw e;
            });
        })
        .catch((e) => {
          console.log(e);
          throw e;
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
      self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, {
        reconnectInterval: 1000,
        reconnectTries: Number.MAX_VALUE,
        useNewUrlParser: true,
      });
      self.mongoDbClient.connect((err) => {
        const collection: any = self.mongoDbClient.db("croupier").collection("netGains");
        collection.updateOne({}, { $inc: netGains }, (err2, res) => {
          if (err2) {
            console.log("updateOne err", err2);
            throw err2;
          }

          console.log("updateOne res", res);

          const projection: object = {};
          projection[winnerUsername] = 1;

          collection.findOne({}, projection).then((doc, err3) => {
            if (err3 || !doc) {
              console.log("findOne err", err3);
              throw err3;
            }

            console.log("findOne doc", doc);

            resolve(doc[winnerUsername]);
            self.mongoDbClient.close();
          });
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

    const myquery: object = { _id: snipe.snipeId };

    const newvalues: object = {
      $set: {
        cancellation_reason: cancellationReason,
        in_progress: 0,
        updatedAt: +new Date(),
        was_cancelled: wasCancelled,
        winner,
      },
    };

    self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, {
      reconnectInterval: 1000,
      reconnectTries: Number.MAX_VALUE,
      useNewUrlParser: true,
    });
    self.mongoDbClient.connect((err) => {
      const collection: any = self.mongoDbClient.db("croupier").collection("snipes");
      collection.updateOne(myquery, newvalues, (err2, res) => {
        if (err2) {
          throw err2;
        }
        self.mongoDbClient.close();
      });
    });
  }

  public processRefund(txn: Transaction, channel: ChatChannel): void {
    const self: Croupier = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    let refund: number;

    console.log("refunding txn", txn);
    this.calculateTransactionFees(txn)
      .then((transactionFees) => {
        console.log("not refunding txn fees", transactionFees);
        refund = _.round(txn.amount - transactionFees, 7);
        console.log("total refund is", refund);
        snipe.moneySend(refund, txn.fromUsername);
      })
      .catch((e) => {
        console.log("there was an error with the refund", e);

        self.bot1.chat.send(
          {
            name: `zackburt,${self.botUsername1}`,
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
  }

  public calculateTransactionFees(txn: Transaction): Promise<number> {
    const self: Croupier = this;
    return new Promise((resolve) => {
      self.bot1.wallet.details(txn.txId).then((details) => {
        const xlmFeeMatch: Array<any> = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
        if (xlmFeeMatch !== null) {
          const fee: number = parseFloat(xlmFeeMatch[1]);
          console.log("fee", fee);
          resolve(fee);
        }
      });
    });
  }

  public updateSnipeLog(channel: ChatChannel): void {
    const self: Croupier = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    const participants: string = JSON.stringify(snipe.participants);
    const positionSizes: string = JSON.stringify(snipe.positionSizes);
    const blinds: number = snipe.blinds;
    const snipeId: string = snipe.snipeId;

    const myquery: object = { _id: snipe.snipeId };
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

    self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, {
      reconnectInterval: 1000,
      reconnectTries: Number.MAX_VALUE,
      useNewUrlParser: true,
    });
    self.mongoDbClient.connect((err) => {
      const collection: any = self.mongoDbClient.db("croupier").collection("snipes");
      collection.updateOne(myquery, newvalues, (err2, res) => {
        if (err2) {
          throw err2;
        }
        self.mongoDbClient.close();
      });
    });
  }

  private logNewSnipe(snipe: Snipe): Promise<any> {
    const self: Croupier = this;
    return new Promise((resolve, reject) => {
      self.mongoDbClient = new mongodb.MongoClient(self.mongoDbUri, {
        reconnectInterval: 1000,
        reconnectTries: Number.MAX_VALUE,
        useNewUrlParser: true,
      });
      self.mongoDbClient.connect((err) => {
        const collection: any = self.mongoDbClient.db("croupier").collection("snipes");
        collection.insertOne(
          {
            bettingStarted: snipe.bettingStarted,
            channel: snipe.channel,
            countdown: snipe.countdown,
            in_progress: 1,
          },
          (err2, res) => {
            if (err2) {
              console.log(err2);
              reject(err2);
            }
            self.mongoDbClient.close();
            resolve(res.insertedId);
          },
        );
      });
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
    if (txn.toUsername !== this.botUsername1) {
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
        setTimeout(() => {
          this.processRefund(txn, channel);
        }, 1000 * 5);
        return;
      }

      if (snipe.bettingOpen === false) {
        snipe.chatSend(`Betting has closed - refunding`);
        // Ensure the transaction is Completed before refunding
        setTimeout(() => {
          this.processRefund(txn, channel);
        }, 1000 * 5);
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
    Want to read the rules or start a game?  https://github.com/codeforcash/croupier/blob/master/RULES.md`;

    this.bot1.chat.send(channel, {
      body: helpMsg,
    }, {});
  }

  private routeIncomingMessage(msg: MessageSummary): void {
    const self: Croupier = this;
    try {
      const snipe: Snipe = this.activeSnipes[JSON.stringify(msg.channel)];

      if (msg.channel.membersType === "impteamnative") {
        this.respondToDM(msg);
        return;
      }

      if (typeof snipe !== "undefined" && snipe.freeze && msg.sender.username !== snipe.freeze) {
        snipe.freezeBet(msg);
        return;
      }
      if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
        this.extractTxn(msg);
      }
      if (typeof snipe === "undefined") {
        return;
      }
      if (msg.content.type === "flip" && msg.sender.username === this.botUsername1) {
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
      const myquery: object = { in_progress: 1 };
      self.mongoDbClient = new mongodb.MongoClient(self.mongoDbUri, {
        reconnectInterval: 1000,
        reconnectTries: Number.MAX_VALUE,
        useNewUrlParser: true,
      });

      self.mongoDbClient.connect((err) => {
        if (err) {
          throw err;
        }
        const collection: any = self.mongoDbClient.db("croupier").collection("snipes");
        collection.find(myquery).toArray((err2, results) => {
          if (err2) {
            throw err2;
          }

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
                snipeId: result._id,
              },
            );
          });

          self.mongoDbClient.close();

          Object.keys(snipes).forEach((chid) => {
            const snipeChannel: ChatChannel = JSON.parse(chid);
            const snipe: Snipe = snipes[chid];
            snipes[chid].chatSend("Croupier was restarted... Previous bets are still valid!");
            snipes[chid].chatSend(snipe.buildBettingTable());
            snipe.launchSnipe();
          });

          resolve(snipes);
        });
      });
    });
  }
}
export default Croupier;
