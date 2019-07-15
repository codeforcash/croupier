import * as _ from "lodash";
import * as moment from "moment";
import * as mysql from "mysql";
import * as os from "os";
import * as throttledQueue from "throttled-queue";
import * as Bot from "./keybase-bot";
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

  private mySqlCredentials: object;

  public constructor(botUsername,
                     paperKey1,
                     paperKey2,
                     mySqlUsername,
                     mySqlPassword,
                     mySqlDatabase,
                     mySqlHost) {

    this.mySqlCredentials = {
      database : mySqlDatabase,
      host     : mySqlHost,
      password : mySqlPassword,
      user     : mySqlUsername,
    };

    this.botUsername = botUsername;

    this.bot1 = new Bot(os.homedir());
    this.bot2 = new Bot(os.homedir());
    this.paperKey1 = paperKey1;
    this.paperKey2 = paperKey2;
  }

  public async run() {

    const self = this;

    await this.bot1.init(this.botUsername, this.paperKey1, null);
    await this.bot2.init(this.botUsername, this.paperKey2, null);

    console.log("both paper keys initialized");
    this.activeSnipes = await this.loadActiveSnipes();
    console.log("here, the active snipes we found: ");
    console.log(this.activeSnipes);

    Object.keys(this.activeSnipes).forEach((chid) => {
      const snipeChannel: ChatChannel = JSON.parse(chid);
      const snipe: Snipe = self.activeSnipes[chid];
      self.activeSnipes[chid].chatSend("Croupier was restarted... Previous bets are still valid!");
      self.activeSnipes[chid].chatSend(snipe.buildBettingTable());
      snipe.launchSnipe();
    });

    console.log("active snipes loaded");
    await this.bot1.chat.watchAllChannelsForNewMessages(this.routeIncomingMessage.bind(this),
      (e) => console.error(e), undefined);

  }

  public async shutdown() {
    await this.bot1.deinit();
    await this.bot2.deinit();
  }

  public documentSnipe(snipe: Snipe, reason: string): void {

    let wasCancelled: number;
    let winner: string;
    let cancellationReason: string;

    const connection: mysql.Connection = mysql.createConnection(this.mySqlCredentials);

    connection.connect();

    if (reason === "lack-of-participants" || reason === "flip-error") {
      wasCancelled = 1;
      winner = null;
      cancellationReason = reason;
    } else {
      wasCancelled = 0;
      winner = reason;
      cancellationReason = null;
    }

    connection.query(`UPDATE snipes
      SET
        winner=${connection.escape(winner)},
        was_cancelled=${connection.escape(wasCancelled)},
        cancellation_reason=${connection.escape(cancellationReason)},
        in_progress=0
      WHERE
        id=${connection.escape(snipe.snipeId)}
      `, (error, results, fields) => {
        if (error) {
          console.log(error);
        }
      });

    connection.end();
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

    const snipe: Snipe = this.activeSnipes[JSON.stringify(channel)];
    const participants: string = JSON.stringify(snipe.participants);
    const positionSizes: string = JSON.stringify(snipe.positionSizes);
    const blinds: number = snipe.blinds;
    const snipeId: number = snipe.snipeId;

    const connection: mysql.Connection = mysql.createConnection({
      database : process.env.MYSQL_DB,
      host     : process.env.MYSQL_HOST,
      password : process.env.MYSQL_PASSWORD,
      user     : process.env.MYSQL_USER,
    });

    connection.connect();

    console.log(snipe);

    const query: string = `UPDATE snipes SET
      participants=${connection.escape(participants)},
      position_sizes=${connection.escape(positionSizes)},
      blinds=${connection.escape(blinds)},
      pot_size=${connection.escape(snipe.calculatePotSize())},
      clock_remaining=${connection.escape(snipe.getTimeLeft())}
      WHERE
      id=${connection.escape(snipeId)}`;
    connection.query(query, (error, results, fields) => {
      if (error) {
        console.log(error);
      }
    });
    connection.end();
  }

  private logNewSnipe(snipe: Snipe): Promise<any> {

    return new Promise((resolve) => {

      const connection: mysql.Connection = mysql.createConnection(this.mySqlCredentials);

      connection.connect();

      connection.query(`INSERT INTO snipes
        (channel, countdown, betting_started)
        VALUES
        (${connection.escape(JSON.stringify(snipe.channel))},
        ${connection.escape(snipe.countdown)},
        ${connection.escape(snipe.betting_started)}
        )`, (error, results, fields) => {
        if (error) {
          console.log(error);
        }

        resolve(results.insertId);

      });
      connection.end();

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

    // Ignore all bets below the minimum
    let blinds: number;
    if (typeof(snipe) === "undefined") {
      blinds = 0.01;
    } else {
      blinds = snipe.blinds;
    }
    if (parseFloat(txn.amount) < blinds) {
      this.bot1.chat.send(channel, {
        body: `Thanks for the tip, but bets should be >= ${blinds}XLM`,
      }, undefined);
      return;
    }

    if (typeof(snipe) === "undefined") {
      this.startNewSnipe(msg, txn);
    } else {
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

      const connection: mysql.Connection = mysql.createConnection(this.mySqlCredentials);

      connection.connect();

      connection.query(`SELECT * FROM snipes WHERE in_progress=1`, (error, results, fields) => {
        if (error) {
          console.log(error);
        }

        results.forEach((result) => {

          const channel: ChatChannel = JSON.parse(result.channel);
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
            snipeId: parseInt(result.id, 10),
          });
        });

        resolve(snipes);
      });
      connection.end();
    });

  }

}

export default Croupier;
