import * as _ from "lodash";
import * as moment from "moment";
import * as os from "os";
import * as throttledQueue from "throttled-queue";
import * as Bot from "./keybase-bot";
import * as mongodb from "mongodb";
import Snipe from "./snipe";

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

class Croupier {

  public activeSnipes: object;
  public bot1: Bot;
  public bot2: Bot;
  public botUsername: string;
  public paperKey1: string;
  public paperKey2: string;

  private mongoDbUri: string;
  private mongoDbClient: mongodb.MongoClient;

  public constructor(botUsername,
                     paperKey1,
                     paperKey2,
                     mongoDbUsername,
                     mongoDbPassword,
                     mongoDbHost,
                     isCluster) {


    let mongoDbDatabase;
    if (process.env.TEST) {
      mongoDbDatabase = "testcroupier";
    } else if (process.env.DEVELOPMENT) {
      mongoDbDatabase = "devcroupier";
    } else {
      mongoDbDatabase = "croupier";
    }

    let uri;
    if (isCluster) {
      uri = "mongodb+srv://";
    } else {
      uri = "mongodb://";
    }
    uri += `${mongoDbUsername}:${mongoDbPassword}@${mongoDbHost}`;
    uri += `/${mongoDbDatabase}?retryWrites=true&w=majority`;
    this.mongoDbUri = uri;


    this.botUsername = botUsername;

    this.bot1 = new Bot(os.homedir());
    this.bot2 = new Bot(os.homedir());
    this.paperKey1 = paperKey1;
    this.paperKey2 = paperKey2;
  }

  public async init() {
    this.activeSnipes = {};
    await this.bot1.init(this.botUsername, this.paperKey1, null);
    await this.bot2.init(this.botUsername, this.paperKey2, null);
  }

  public async run(loadActiveSnipes) {



    this.init();
    console.log("both paper keys initialized");

    if(loadActiveSnipes) {
      this.activeSnipes = await this.loadActiveSnipes();
      console.log("active snipes loaded");
    }

    await this.bot1.chat.watchAllChannelsForNewMessages(this.routeIncomingMessage.bind(this),
      (e) => console.error(e), undefined);

  }

  public async shutdown() {
    await this.bot1.deinit();
    await this.bot2.deinit();
  }

  public documentSnipe(snipe: Snipe, reason: string): void {

    const self = this;
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

    const myquery = { _id: snipe.snipeId };

    const newvalues = {
      $set: {
        winner: winner,
        was_cancelled: wasCancelled,
        cancellation_reason: cancellationReason,
        in_progress: 0,
        updated_at: +new Date(),
      }
    };


    self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, { reconnectTries: Number.MAX_VALUE,
      reconnectInterval: 1000,
      useNewUrlParser: true });
    self.mongoDbClient.connect(err => {
      const collection = self.mongoDbClient.db("croupier").collection("snipes");
      collection.updateOne(myquery, newvalues, (err, res) => {
        if (err) {
          throw(err);
        }
        self.mongoDbClient.close();
      })
    });

  }

  public processRefund(txn: Transaction, channel: ChatChannel): void {

    const snipe = this.activeSnipes[JSON.stringify(channel)];

    console.log("refunding txn", txn);
    this.calculateTransactionFees(txn).then((transactionFees) => {
      console.log("not refunding txn fees", transactionFees);
      const refund: number = _.round(txn.amount - transactionFees, 7);
      console.log("total refund is", refund);
      snipe.moneySend(refund, txn.fromUsername);
    }).catch((e) => {
      console.log("there was an error with the refund", e);
    });
  }

  public calculateTransactionFees(txn: Transaction): Promise<number> {
    const self = this;
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

    const self = this;
    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    const participants: string = JSON.stringify(snipe.participants);
    const positionSizes: string = JSON.stringify(snipe.positionSizes);
    const blinds: number = snipe.blinds;
    const snipeId: string = snipe.snipeId;

    const myquery = { _id: snipe.snipeId };
    const newvalues = {
      $set: {
        participants: participants,
        position_sizes: positionSizes,
        blinds: blinds,
        pot_size: snipe.calculatePotSize(),
        clock_remaining: snipe.getTimeLeft(),
        updated_at: +new Date()
      }
    };

    self.mongoDbClient = new mongodb.MongoClient(this.mongoDbUri, { reconnectTries: Number.MAX_VALUE,
      reconnectInterval: 1000,
      useNewUrlParser: true });
    self.mongoDbClient.connect(err => {
      const collection = self.mongoDbClient.db("croupier").collection("snipes");
      collection.updateOne(myquery, newvalues, (err, res) => {
        if (err) {
          throw(err);
        }
        self.mongoDbClient.close();
      })
    });

  }

  private logNewSnipe(snipe: Snipe): Promise<any> {

    const self = this;
    return new Promise((resolve, reject) => {

      self.mongoDbClient = new mongodb.MongoClient(self.mongoDbUri, { reconnectTries: Number.MAX_VALUE,
      reconnectInterval: 1000,
      useNewUrlParser: true });
      self.mongoDbClient.connect(err => {
        const collection = self.mongoDbClient.db("croupier").collection("snipes");
        collection.insertOne({
          channel: snipe.channel,
          countdown: snipe.countdown,
          betting_started: snipe.betting_started,
          in_progress: 1
        }, (err, res) => {
          if (err) {
            console.log(err);
            reject(err);
          }
          self.mongoDbClient.close();
          resolve(res.insertedId);
        })
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
    if (txn.toUsername !== this.botUsername) {
      return;
    }

    // If they aren't sending XLM but instead some other unexpected asset, then ignore
    const isNative: boolean = txn.asset.type === "native";
    if (!isNative) {
      return;
    }


    if (parseFloat(txn.amount) < 0.01) {
      this.bot1.chat.send(channel, {
        body: `Thanks for the tip, but bets should be >= 0.01XLM`,
      }, undefined);
      return;
    }

    if (typeof(snipe) === "undefined") {
      this.startNewSnipe(msg, txn);
    } else {


      //  Calculate pot size.
      //  If pot size + this bet >= 2500 USD, refund the bet
      //  Say the maximum pot size is $2500 USD to comply
      //  with various legal ideas

      // Ignore all bets below the minimum



      if (snipe.betting_open === false) {
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

  private startNewSnipe(msg: MessageSummary, txn: Transaction) {
    const self = this;
    const channel: ChatChannel = msg.channel;
    let countdown: number = 60;
    const countdownMatch: Array<any> = msg.content.text.body.match(/countdown:\s?(\d+)/i);
    if (countdownMatch !== null) {
      countdown = parseInt(countdownMatch[1], 10);
      if (countdown < 5 || countdown > 60 * 60 * 24 * 7) {
        countdown = 60;
        this.bot1.chat.send(channel, {
          body: `Bad value of countdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
        }, undefined);
      }
    }

    const chatThrottle: any = throttledQueue(5, 5000);
    const moneyThrottle: any = throttledQueue(1, 1000);

    this.activeSnipes[JSON.stringify(channel)] = new Snipe(this,
      channel, { bot1: this.bot1, bot2: this.bot2 }, { countdown });

    const snipe = this.activeSnipes[JSON.stringify(channel)];

    this.logNewSnipe(snipe).then((snipeId) => {
      snipe.snipeId = snipeId;
      snipe.launchSnipe();
      snipe.processNewBet(txn, msg);
    });
  }

  private routeIncomingMessage(msg): void {

    try {
      const snipe: Snipe = this.activeSnipes[JSON.stringify(msg.channel)];
      if (typeof(snipe) !== "undefined" &&
        snipe.freeze &&
        msg.sender.username !== snipe.freeze) {
        snipe.freezeBet(msg);
        return;
      }
      if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
        this.extractTxn(msg);
      }
      if (typeof(snipe) === "undefined") {
        return;
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
      }
      if (msg.content.type === "delete") {
        snipe.checkForPopularityContestVoteRemoval(msg);
      }

    } catch (err) {
      console.error(err);
    }

  }

  private loadActiveSnipes(): object {
    const self = this;
    return new Promise((resolve) => {
      const snipes: object = {};
      const myquery = { in_progress: 1 };
      self.mongoDbClient = new mongodb.MongoClient(self.mongoDbUri, {
        reconnectTries: Number.MAX_VALUE,
        reconnectInterval: 1000,
        useNewUrlParser: true });

      self.mongoDbClient.connect(err => {
        if (err) {
          throw(err);
        }
        const collection = self.mongoDbClient.db("croupier").collection("snipes");
        collection.find(myquery).toArray((err, results) => {
          if (err) {
            throw(err);
          }

          results.forEach((result) => {

            const channel: ChatChannel = result.channel;
            snipes[JSON.stringify(channel)] = new Snipe(self, channel, {
              bot1: self.bot1,
              bot2: self.bot2,
            },
            {
              betting_started:  parseInt(result.betting_started, 10),
              clock_remaining: result.clock_remaining,
              countdown: result.countdown,
              blinds: parseFloat(result.blinds),
              participants: JSON.parse(result.participants),
              position_sizes: JSON.parse(result.position_sizes),
              potSize: parseInt(result.potSize, 10),
              snipeId: result._id
            });
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
