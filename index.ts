// tsc --lib es2015 index.ts

import * as _ from "lodash";
import * as mysql from "mysql";
import * as moment from "moment";
import * as os from "os";
import * as Bot from "./keybase-bot";
import * as throttledQueue from "throttled-queue";

import "source-map-support/register";

const bot: Bot = new Bot(os.homedir());
const bot2: Bot = new Bot(os.homedir());

const botUsername: string = "croupier";
const paperkey: string = process.env.CROUPIER_PAPERKEY_1;
const paperkey2: string = process.env.CROUPIER_PAPERKEY_2;

let activeSnipes: object;

import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";


interface IBetData {
  fees: Array<Promise<number>>;
  wagers: Array<number>;
}

interface IBetList {
  [key: string]: IBetData;
}

interface IParticipant {
  username: string;
  transaction: Transaction;
  onBehalfOf?: string;
}

type ThrottledChat = (message: string) => Promise<any>;
type ThrottledMoneyTransfer = (xlmAmount: number, recipient: string) => Promise<any>;

interface ISnipe {
  participants: Array<IParticipant>;
  betting_open: boolean;
  clock: string;
  timeout: NodeJS.Timeout;
  countdown: number;
  snipeId: number;
  betting_stops: moment.Moment;
  chatSend: ThrottledChat;
  moneySend: ThrottledMoneyTransfer;
  reFlips: number;
  reflipping: boolean;
}





function updateSnipeLog(channel: ChatChannel): void {

  const participants: string = JSON.stringify(activeSnipes[JSON.stringify(channel)].participants);
  let snipeId = activeSnipes[JSON.stringify(channel)].snipeId;

  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  connection.query(`UPDATE snipes SET participants=${connection.escape(participants)} WHERE id=${connection.escape(snipeId)}`, (error, results, fields) => {
    if (error) {
      console.log(error);
    }
  });
  connection.end();
}


function addSnipeParticipant(channel: ChatChannel, txn: Transaction, onBehalfOf?: string): void {

  let newParticipant;
  if(typeof(onBehalfOf) === 'undefined') {
    newParticipant = {
      transaction: txn,
      username: txn.fromUsername,
    };
  }
  else {
    newParticipant = {
      transaction: txn,
      username: txn.fromUsername,
      onBehalfOf: onBehalfOf
    };
  }

  activeSnipes[JSON.stringify(channel)].participants.push(newParticipant);
  updateSnipeLog(channel);
}

function logNewSnipe(channel: ChatChannel): Promise<any> {

  return new Promise((resolve) => {

    let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
    const connection: mysql.Connection = mysql.createConnection({
      database : process.env.MYSQL_DB,
      host     : process.env.MYSQL_HOST,
      password : process.env.MYSQL_PASSWORD,
      user     : process.env.MYSQL_USER,
    });

    connection.connect();

    connection.query(`INSERT INTO snipes
      (channel, countdown)
      VALUES
      (${connection.escape(JSON.stringify(channel))},
      ${connection.escape(snipe.countdown)}
      )`, (error, results, fields) => {
      if (error) {
        console.log(error);
      }

      resolve(results.insertId);

    });
    connection.end();

  });

}



function documentSnipe(channel: ChatChannel, reason: string): void {

  let snipeId = activeSnipes[JSON.stringify(channel)].snipeId;
  let was_cancelled, winner, cancellation_reason;

  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  if (reason === 'lack-of-participants' || reason === 'flip-error') {
    was_cancelled = 1;
    winner = null;
    cancellation_reason = reason;
  }
  else {
    was_cancelled = 0;
    winner = reason;
    cancellation_reason = null;
  }

  connection.query(`UPDATE snipes
    SET
      winner=${connection.escape(winner)},
      was_cancelled=${connection.escape(was_cancelled)},
      cancellation_reason=${connection.escape(cancellation_reason)},
      in_progress=0
    WHERE
      id=${connection.escape(snipeId)}
    `, (error, results, fields) => {
      if (error) {
        console.log(error);
      }
    });

  connection.end();
}

function calculateTransactionFees(txn: Transaction): Promise<number> {
  return new Promise(resolve => {
    bot.wallet.details(txn.txId).then(details => {
      const xlmFeeMatch = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
      if (xlmFeeMatch !== null) {
        const fee = parseFloat(xlmFeeMatch[1]);
        console.log('fee', fee);
        resolve(fee);
      }
    });
  });
}



function processRefund(txn: Transaction, channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  console.log("refunding txn", txn);
  calculateTransactionFees(txn).then(transactionFees => {
    console.log("not refunding txn fees", transactionFees);
    const refund: number = _.round(txn.amount - transactionFees, 7);
    console.log("total refund is", refund);
    snipe.moneySend(refund, txn.fromUsername);
  });
}


function clearSnipe(channel: ChatChannel, reason: string): void {
  documentSnipe(channel, reason);
  activeSnipes[JSON.stringify(channel)] = undefined;
}

function extractTxn(msg: MessageSummary): void {
  const txnId: string = msg.content.text.payments[0].result.sent;
  bot.wallet.details(txnId).then((details) => processTxnDetails(details, msg));
}

function sendAmountToWinner(winnerUsername: string, channel: ChatChannel): void {
  let bounty: number;
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  bounty = 0;

  let transactionFeePromises = [];

  snipe.participants.forEach((participant) => {
     bounty += parseFloat(participant.transaction.amount);
     transactionFeePromises.push(calculateTransactionFees(participant.transaction));
  });

  Promise.all(transactionFeePromises).then((values: Array<number>) => {
    values.forEach((val) => {
      bounty -= val;
    });
    bounty = _.round(bounty, 7);
    console.log("now rounded", bounty);


    //  If winnerUsername is a participant in this chat, moneySend
    //  Otherwise, use stellar.expert.xlm method
    bot.team.listTeamMemberships({
      team: channel.name
    }).then((res) => {


      let allMembers = [];
      allMembers = allMembers.concat(res.members.owners.map(u => u.username));
      allMembers = allMembers.concat(res.members.admins.map(u => u.username));
      allMembers = allMembers.concat(res.members.writers.map(u => u.username));
      allMembers = allMembers.concat(res.members.readers.map(u => u.username));

      // it's possible the winner is not in the chat, that they won through a onBehalfOf contribution of someone else
      if(allMembers.indexOf(winnerUsername) === -1) {
        bot.wallet.send(winnerUsername, bounty.toString()).then((txn) => {
          let bountyMsg = `\`+${bounty}XLM@${winnerUsername}\` `;
          bountyMsg += `:arrow_right: `;
          bountyMsg += `https://stellar.expert/explorer/public/tx/${txn.txId}`;
          snipe.chatSend(bountyMsg);
        });
      }
      else {
        snipe.moneySend(bounty, winnerUsername);
      }


    });


  });
}

function resolveFlip(channel: ChatChannel, winningNumber: number): string {

  let winnerUsername: string;
  const bettorRange: object = buildBettorRange(channel);
  Object.keys(bettorRange).forEach((username) => {
    if (bettorRange[username][0] <= winningNumber && bettorRange[username][1] >= winningNumber) {
      winnerUsername = username;
    }
  });

  sendAmountToWinner(winnerUsername, channel);

  let snipe = activeSnipes[JSON.stringify(channel)];
  snipe.chatSend(`Congrats to @${winnerUsername}`);

  return winnerUsername;
}

function buildBettorRange(channel: ChatChannel): any {
  const bettorMap: object = {};
  activeSnipes[JSON.stringify(channel)].participants.forEach((participant) => {

    console.log('participant', participant);

    let username;
    if(typeof(participant.onBehalfOf) === "undefined") {
      username = participant.username;
      console.log('onBehalfOf is undefined, so username is', username);
    }
    else {
      username = participant.onBehalfOf;
      console.log('onBehalfOf is defined, so username is', username);
    }

    console.log('username', username);

    if (typeof(bettorMap[username]) === "undefined") {
      bettorMap[username] = Math.floor(participant.transaction.amount / 0.01);
    } else {
      bettorMap[username] += Math.floor(participant.transaction.amount / 0.01);
    }
  });

  const bettorRange: object = {};
  let start: number = 0;
  Object.keys(bettorMap).forEach((key) => {

    console.log('bettorMap key', key);

    bettorRange[key] = [start + 1, start + bettorMap[key]];
    start += bettorMap[key];
  });

  return bettorRange;
}

function buildBettingTable(potSize: number, bettorRange: object): string {

  console.log('within BuildBettingTable, bettorRange:', bettorRange);

  let maxValue = Math.max(..._.flatten(Object.values(bettorRange)));

  let bettingTable = `Pot size: ${potSize.toString()}XLM\n`;
  Object.keys(bettorRange).forEach((username) => {

    let chancePct = 100 * ( (1+(bettorRange[username][1] - bettorRange[username][0])) / maxValue);
    bettingTable += `\n@${username}: \``;
    if(bettorRange[username][0] === bettorRange[username][1]) {
      bettingTable += `${bettorRange[username][0]}\``;
    }
    else {
      bettingTable += `${bettorRange[username][0].toLocaleString()} - ${bettorRange[username][1].toLocaleString()}\``
    }
    bettingTable += ` (${chancePct}% chance)`;
  });

  return bettingTable;


};


function flip(channel: ChatChannel): void {

  const bettorRange: object = buildBettorRange(channel);
  const bettingValues: Array<Array<number>> = Object.values(bettorRange);
  const flatBettingValues: Array<number> = _.flatten(bettingValues);
  const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
  const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

  let bettingTable: string = buildBettingTable(calculatePotSize(channel), bettorRange);

  bot2.chat.send(channel, {
    body: bettingTable,
  });
  bot2.chat.send(channel, {
    body: `/flip ${minBet}..${maxBet}`,
  });
}

function checkWalletBalance(username: string): Promise<any> {
  let balance = 0;
  return new Promise(resolve => {
    bot.wallet.lookup(username).then((acct) => {
      console.log(acct);
      bot.wallet.balances(acct.accountId).then((balances) => {
        console.log(balances);
        balances.forEach((acctDetail) => {
          console.log(acctDetail.balance[0].amount)
          balance += parseFloat(acctDetail.balance[0].amount);
        });
        resolve(balance);
      }).catch((e) => {
        console.log(e);
        resolve(null);
      })

    }).catch((e) => {
      console.log(e);
      resolve(null);
    })
  });
}

function processNewBet(txn: Transaction, msg: MessageSummary): void {

  const channel = msg.channel;
  const onBehalfOfMatch = msg.content.text.body.match(/(for|4):\s?@?(\w+)/i);
  const snipe = activeSnipes[JSON.stringify(channel)];
  if (onBehalfOfMatch !== null) {
    const onBehalfOfRecipient = onBehalfOfMatch[2];

    // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
    // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
    // new wallets
    checkWalletBalance(onBehalfOfRecipient).then((balance) => {
      if (balance === null || balance < 2.01) {
        snipe.chatSend('Betting on behalf of someone else?  Seems like they do not have a wallet yet, so your bet must be at least 2.01XLM');
        processRefund(txn, msg.channel);
      }
      else {
        addSnipeParticipant(channel, txn, onBehalfOfRecipient);
        snipe.chatSend(`@${onBehalfOfRecipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
        bot.chat.react(channel, msg.id, ':gift:');
      }
    });
  }
  else {
    addSnipeParticipant(channel, txn, undefined);
    snipe.chatSend(`@${txn.fromUsername} is locked into the snipe!`);
  }


}

function processTxnDetails(txn: Transaction, msg: MessageSummary): void {

  const channel: ChatChannel = msg.channel;

  if (txn.toUsername !== botUsername) {
    return;
  }
  const isNative: boolean = txn.asset.type === "native";
  if (!isNative) {
    return;
  }
  if (parseFloat(txn.amount) < 0.01) {
    bot.chat.send(channel, {
      body: "Thanks for the tip, but bets should be >= 0.01XLM",
    });
    return;
  }

  let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) === "undefined") {

    let countdown: number = 60;
    const countdownMatch = msg.content.text.body.match(/countdown:\s?(\d+)/i);
    if (countdownMatch !== null) {
      countdown = parseInt(countdownMatch[1], 10);
      if (countdown < 5 || countdown > 60 * 60 * 24 * 7) {
        countdown = 60;
        bot.chat.send(channel, {
          body: `Bad value of countdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
        });
      }
    }


    let chatThrottle = throttledQueue(5, 5000);
    let moneyThrottle = throttledQueue(5, 5000);

    activeSnipes[JSON.stringify(channel)] = {
      betting_open: true,
      clock: null,
      participants: [],
      timeout: null,
      countdown: countdown,
      reFlips: 3,
      chatSend: (message) => {
        return new Promise(resolve => {
          chatThrottle(function() {
            bot.chat.send(channel, {
              body: message
            }).then((messageId) => {
              resolve(messageId);
            });
          });
        });
      },
      moneySend: (amount, recipient) => {
        return new Promise(resolve => {
          moneyThrottle(function() {
            bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
            resolve(true);
          });
        });
      }
    };

    logNewSnipe(channel).then((snipeId) => {
      snipe = activeSnipes[JSON.stringify(channel)];
      snipe.snipeId = snipeId;
      launchSnipe(channel);
      processNewBet(txn, msg);
    });

  }
  else {

    if (snipe.betting_open === false) {

      snipe.chatSend(`Betting has closed - refunding`);

      // Ensure the transaction is Completed before refunding
      setTimeout(function() {
        processRefund(txn, channel);
      }, 1000 * 5);
      return;
    }


    processNewBet(txn, msg);
    resetSnipeClock(channel);

  }


}

function calculatePotSize(channel: ChatChannel): number {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  let sum = 0;
  snipe.participants.forEach(participant => {
    sum += parseFloat(participant.transaction.amount);
  });
  return sum;
}

function getTimeLeft(timeout: NodeJS.Timeout): number {
  return Math.ceil((timeout._idleStart + timeout._idleTimeout)/1000 - process.uptime());
}


function resetSnipeClock(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel)));

  let timeRemaining: number = getTimeLeft(snipe.timeout);
  clearTimeout(snipe.timeout);

  let boost = Math.floor(0.10 * snipe.countdown);
  let timerEndsInSeconds = timeRemaining + boost;

  snipe.betting_stops = moment().add(timerEndsInSeconds, 'seconds');

  bot.chat.delete(channel, snipe.clock, {});
  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    runClock(channel, sentMessage.id, timerEndsInSeconds);
    snipe.clock = sentMessage.id;
  });
  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, timerEndsInSeconds * 1000);
  snipe.timeout = finalizeBetsTimeout;

}

function loadActiveSnipes(): object {
  return new Promise(resolve => {
    let snipes = {};

    const connection: mysql.Connection = mysql.createConnection({
      database : process.env.MYSQL_DB,
      host     : process.env.MYSQL_HOST,
      password : process.env.MYSQL_PASSWORD,
      user     : process.env.MYSQL_USER,
    });

    connection.connect();

    connection.query(`SELECT * FROM snipes WHERE in_progress=1`, (error, results, fields) => {
      if (error) {
        console.log(error);
      }

      results.forEach((result) => {

        let chatThrottle = throttledQueue(5, 5000);
        let moneyThrottle = throttledQueue(5, 5000);

        let channel = JSON.parse(result.channel);

        snipes[JSON.stringify(channel)] = {
          snipeId: result.id,
          betting_open: true,
          clock: null,
          participants: JSON.parse(result.participants),
          timeout: null,
          countdown: result.countdown,
          reFlips: 3,
          chatSend: (message) => {
            return new Promise(resolve => {
              chatThrottle(function() {
                bot.chat.send(channel, {
                  body: message
                }).then((messageId) => {
                  resolve(messageId);
                });
              });
            });
          },
          moneySend: (amount, recipient) => {
            return new Promise(resolve => {
              moneyThrottle(function() {
                bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
              });
            });
          }
        };

      });

      resolve(snipes);

    });
    connection.end();
  });
}



function launchSnipe(channel: ChatChannel): void {
  // Tell the channel: OK, your snipe has been accepted for routing.

  let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];


  let message: string = `The snipe is on (**#${activeSnipes[JSON.stringify(channel)].snipeId}**).  Bet in multiples of 0.01XLM.  Betting format:`;
  message += `\`\`\`+0.01XLM@${botUsername}\`\`\``;


  snipe.chatSend(message);


  snipe.betting_stops = moment().add(snipe.countdown, 'seconds');

  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    runClock(channel, sentMessage.id, snipe.countdown);
    snipe.clock = sentMessage.id;
  });

  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, snipe.countdown * 1000);
  activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;

}

function finalizeBets(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.chatSend("No more bets!");

  snipe.betting_open = false;
   // Give 5 seconds to finalize transactions + 1 extra.
  setTimeout(() => {
    executeFlipOrCancel(channel);
  }, 6 * 1000);
}





function refundAllParticipants(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const bets: IBetList = {};
  snipe.participants.forEach((participant) => {
    if(typeof(bets[participant.transaction.fromUsername]) === 'undefined') {

      let b: IBetData = {
        fees: [],
        wagers: [],
      };
      bets[participant.transaction.fromUsername] = b;

    }
    bets[participant.transaction.fromUsername].fees.push(calculateTransactionFees(participant.transaction));
    bets[participant.transaction.fromUsername].wagers.push(participant.transaction.amount);
  });

  const participantList = Object.keys(bets);

  participantList.forEach((participant) => {
    Promise.all(bets[participant].fees).then((fees) => {
      console.log('fees', fees);
      let feeSum: number = fees.reduce((a: number, b: number) => parseFloat(a) + parseFloat(b));
      console.log('feeSum', feeSum);
      let wagerSum: number = bets[participant].wagers.reduce((a: number, b:number) => parseFloat(a) + parseFloat(b));
      console.log('wagerSum', wagerSum);
      let refund: number = _.round(wagerSum - feeSum, 7);
      console.log('refund', refund);
      snipe.moneySend(refund, participant);
    });
  });
}


function executeFlipOrCancel(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) !== "undefined") {
    const participantUsernames: Array<string> = snipe.participants.map((participant) => participant.onBehalfOf || participant.username);
    const uniqParticipants: Array<string> = _.union(participantUsernames);
    if (uniqParticipants.length > 1) {
      flip(channel);
    }
    else {
      refundAllParticipants(channel);
      snipe.chatSend("The snipe has been canceled due to a lack of participants.");
      clearSnipe(channel, 'lack-of-participants');
    }
  }
}

function cancelFlip(conversationId: string, channel: ChatChannel, err: Error): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  clearInterval(flipMonitorIntervals[conversationId]);
  if (typeof(activeSnipes[JSON.stringify(channel)]) !== "undefined") {
    snipe.chatSend(`The flip has been cancelled due to error, and everyone is getting a refund`);
    refundAllParticipants(channel);
    clearSnipe(channel, 'flip-error');
  }
}

const flipMonitorIntervals: object = {};

function monitorFlipResults(msg: MessageSummary): void {

  const snipe = activeSnipes[JSON.stringify(msg.channel)];

  flipMonitorIntervals[msg.conversationId] = setInterval((() => {
    try {
      bot.chat.loadFlip(
        msg.conversationId,
        msg.content.flip.flipConvId,
        msg.id,
        msg.content.flip.gameId,
      ).then((flipDetails) => {
        if (flipDetails.phase === 2) {
          console.log("results are in");
          let winner = resolveFlip(msg.channel, flipDetails.resultInfo.number);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
          clearSnipe(msg.channel, winner);
        } else {
          console.log("results are NOT in", flipDetails);
        }
      }).catch((err) => {
        if (snipe.reFlips > 0 && !snipe.reflipping) {
          snipe.chatSend('Due to error, we are going to re-flip in 60 seconds');
          snipe.reFlips--;
          snipe.reflipping = true;
          setTimeout(() => {
            snipe.reflipping = false;
            flip(msg.channel);
          }, 60 *1000);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
        }
        else {
          cancelFlip(msg.conversationId, msg.channel, err);
        }
      });
    } catch (err) {
      cancelFlip(msg.conversationId, msg.channel, err);
    }
  }), 1000);
}

const runningClocks: object = {};

function runClock(channel: ChatChannel, messageId: string, seconds: number): void {

  let snipe = activeSnipes[JSON.stringify(channel)];
  try {

    // :hourglass: :hourglass_flowing_sand:
    if(seconds % 5 === 0) {

      let hourglass;
      let lastDigit = JSON.stringify(seconds).slice(-1);
      if (lastDigit === "5") {
        hourglass = ":hourglass:";
      }
      else {
        hourglass = ":hourglass_flowing_sand:";
      }

      let stops_when = moment().to(snipe.betting_stops);
      if(seconds < 55) {
        stops_when = `in ${seconds} seconds`;
      }

      bot.chat.edit(channel, messageId, {
        message: {
          body: hourglass + ` betting stops ${stops_when}`,
        },
      }).then((res) => {
        console.log(res);
      }).catch((e) => {
        console.log(e);
      });

    }

  } catch (e) {
    return;
  }

  if (seconds > 1) {
    setTimeout(() => {
      runClock(channel, messageId, seconds - 1);
    }, 1000);
  } else {
    setTimeout(() => {
      bot.chat.delete(channel, messageId, {});
    }, 1000);
  }
}

async function main(): Promise<any> {
  try {
    await bot.init(botUsername, paperkey);
    console.log(`Bot initialized with username ${botUsername}.`);
    await bot2.init(botUsername, paperkey2);
    console.log("Second key initialized");
    console.log("Listening for all messages...");

    const channel: object = {
       membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat",
    };
    const message: object = {
      body: `${botUsername} was just restarted...[development mode] [use at own risk] [not functional]`,
    };

    bot.chat.send(channel, message);

    activeSnipes = await loadActiveSnipes();


    console.log('here, the active snipes we found: ');
    console.log(activeSnipes);

    Object.keys(activeSnipes).forEach((chid) => {

      let channel = JSON.parse(chid);
      activeSnipes[chid].chatSend('Croupier was restarted... Previous bets are still valid!');
      activeSnipes[chid].chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel)));
      launchSnipe(channel);

    });




    await bot.chat.watchAllChannelsForNewMessages(
      async (msg) => {

        if(msg.channel.topicName !== "test3") {
          return;
        }

        try {
          if (msg.content.type === "flip" && msg.sender.username === botUsername) {
            monitorFlipResults(msg);
            return;
          }
          if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
            extractTxn(msg);
          }
        } catch (err) {
          console.error(err);
        }
      },
      (e) => console.error(e),
    );
  } catch (error) {
    console.error(error);
  }
}

async function shutDown(): Promise<any> {
  await bot.deinit();
  await bot2.deinit();
  process.exit();
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

main();
