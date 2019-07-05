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

import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";

interface IParticipant {
  username: string;
  transaction: Transaction;
  onBehalfOf?: string;
}

type ThrottledChat = (channel: ChatChannel, message: string) => Promise<any>;
type ThrottledMoneyTransfer = (xlmAmount: number, recipient: string) => Promise<any>;

interface ISnipe {
  participants: Array<IParticipant>;
  betting_open: boolean;
  clock: string;
  timeout: NodeJS.Timeout;
  followupCountdown: number;
  snipeId: number;
  betting_stops: Moment;
  chatSend: ThrottledChat;
  moneySend: ThrottledMoneyTransfer;
  reFlips: number;
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

async function logNewSnipe(channel: ChatChannel): void {

  let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  connection.query(`INSERT INTO snipes
    (channel, initial_countdown, followup_countdown)
    VALUES
    (${connection.escape(JSON.stringify(channel))},
    ${connection.escape(snipe.initialCountdown)},
    ${connection.escape(snipe.followupCountdown)}
    )`, (error, results, fields) => {
    if (error) {
      console.log(error);
    }

    snipe.snipeId = results.insertId;

  });
  connection.end();
}



function documentSnipe(channel: ChatChannel, reason: string): void {

  let snipeId = activeSnipes[JSON.stringify(channel)].snipeId;

  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  if (reason !== 'lack-of-participants' && reason !== 'flip-error') {
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

function calculateTransactionFees(txn: Transaction): Promise<any> {
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

  const snipe: ISnipe = activeSnipes(JSON.stringify(channel));

  console.log("refunding txn", txn);
  calculateTransactionFees(txn).then(transactionFees => {
    console.log("not refunding txn fees", transactionFees);
    const refund: number = _.round(txn.amount - transactionFees, 7);
    console.log("total refund is", refund);
    snipe.moneySend(refund, txn.fromUsername);
  });
}


function clearSnipe(channel: ChatChannel, reason: string): void {
  activeSnipes[JSON.stringify(channel)] = undefined;
  documentSnipe(channel, reason);
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

  Promise.all(transactionFeePromises).then((values) => {
    values.forEach((val) => {
      bounty -= val;
    });
    bounty = _.round(bounty, 7);
    console.log("now rounded", bounty);


    //  If winnerUsername is a participant in this chat, moneySend
    //  Otherwise, use stellar.expert.xlm method
    let res = await bot.team.listTeamMemberships({
      team: channel.name
    });

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
    else {
      snipe.moneySend(bounty, winnerUsername);
    }


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


    let username;
    if(typeof(participant.onBehalfOf) === "undefined") {
      let username = participant.username;
    }
    else {
      let username = participant.onBehalfOf;
    }

    if (typeof(bettorMap[username]) === "undefined") {
      bettorMap[username] = Math.floor(participant.transaction.amount / 0.01);
    } else {
      bettorMap[username] += Math.floor(participant.transaction.amount / 0.01);
    }
  });

  const bettorRange: object = {};
  let start: number = 0;
  Object.keys(bettorMap).forEach((key) => {
    bettorRange[key] = [start + 1, start + bettorMap[key]];
    start += bettorMap[key];
  });

  return bettorRange;
}

function buildBettingTable(potSize: number, bettorRange: object): string {


  let maxValue = Math.max(..._.flatten(Object.values(bettorRange)));

  let bettingTable = "Pot size: ${potSize}XLM\n";
  Object.keys(bettorRange).forEach((username) => {
    let chancePct = 100 * ( (1+(bettorRange[username][1] - bettorRange[username][0])) / maxValue);
    bettingTable += `\n@${username}: \`${bettorRange[username][0].toLocaleString()} - ${bettorRange[username][1].toLocaleString()}\` (${chancePct}% to win)`;
  });

};

function flip(channel: ChatChannel): void {

  const bettorRange: object = buildBettorRange(channel);
  const bettingValues: Array<Array<number>> = Object.values(bettorRange);
  const flatBettingValues: Array<number> = _.flatten(bettingValues);
  const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
  const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

  let bettingTable: string = buildBettingTable(bettorRange);

  bot2.chat.send(channel, {
    body: bettingTable,
  });
  bot2.chat.send(channel, {
    body: `/flip ${minBet}..${maxBet}`,
  });
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

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) === "undefined") {


    let initialCountdown: number = 60;
    const initialCountdownMatch = msg.content.text.body.match(/initialCountdown:\s?(\d+)/);
    if (initialCountdownMatch !== null) {
      initialCountdown = parseInt(initialCountdownMatch[1], 10);
      if (initialCountdown < 5 || initialCountdown > 60 * 60 * 24 * 7) {
        initialCountdown = 60;
        bot.chat.send(channel, {
          body: `Bad value of initialCountdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
        });
      }
    }

    let followupCountdown: number = 60;
    const followupCountdownMatch = msg.content.text.body.match(/followupCountdown:\s?(\d+)/);
    if (followupCountdownMatch !== null) {
      followupCountdown = parseInt(followupCountdownMatch[1], 10);
      if (followupCountdown < 5 || followupCountdown > 60 * 60 * 24 * 7) {
        followupCountdown = 60;
        bot.chat.send(channel, {
          body: `Bad value of followupCountdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
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
      initialCountdown: initialCountdown,
      followupCountdown: followupCountdown,
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
            bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient).then((res) => {
              resolve(res);
            });
          });
        });
      }
    };

    await logNewSnipe(channel);
    launchSnipe(channel);

  }



  if (snipe.betting_open === false) {

    snipe.chatSend(`Betting has closed - refunding`);

    // Ensure the transaction is Completed before refunding
    setTimeout(function() {
      processRefund(txn, channel);
    }, 1000 * 5);
    return;
  }

  const onBehalfOfMatch = msg.content.text.body.match(/onBehalfOf:\s?(\d+)/);
  if (onBehalfOfMatch !== null) {
    onBehalfOfRecipient = onBehalfOfMatch[1];

    addSnipeParticipant(channel, txn, onBehalfOfRecipient);

    snipe.chatSend(`@${onBehalfOfRecipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
  }
  else {
    addSnipeParticipant(channel, txn, undefined);
    snipe.chatSend(`@${txn.fromUsername} is locked into the snipe!`);
  }

  resetSnipeClock(channel);
}

function calculatePotSize(channel: ChatChannel): number {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  let sum = 0;
  snipe.participants.forEach(participant => {
    sum += participant.txn.amount;
  });
  return sum;
}

function resetSnipeClock(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.chatSend(buildBettingTable(buildBettorRange(channel)));

  const snipeTimeout: number = snipe.followupCountdown;

  clearTimeout(snipe.timeout);
  snipe.betting_stops = moment().add(snipeTimeout, 'seconds');

  bot.chat.delete(channel, snipe.clock, {});
  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    runClock(channel, sentMessage.id, snipeTimeout);
    activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
  });
  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, snipeTimeout * 1000);
  activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;

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

    connection.query(`SELECT * FROM snipes WHERE in_progress=1`), (error, results, fields) => {
      if (error) {
        console.log(error);
      }

      results.forEach((result) => {

        let chatThrottle = throttledQueue(5, 5000);
        let moneyThrottle = throttledQueue(5, 5000);

        snipes[JSON.stringify(result.channel)] = {
          betting_open: true,
          clock: null,
          participants: result.participants,
          timeout: null,
          initialCountdown: result.initial_countdown,
          followupCountdown: result.followup_countdown,
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
                bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient).then((res) => {
                  resolve(res);
                });
              });
            });
          }
        };

        snipes[JSON.stringify(result.channel)].chatSend('Croupier was restarted... Previous bets are still valid!');
        snipes[JSON.stringify(result.channel)].chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange()));

        // TODO: this might be a good time to re communicate the snipe table + odds to everyone.
        launchSnipe(result.channel);

      });

      resolve(snipes);

    });
    connection.end();
  });
}

const activeSnipes: object = await loadActiveSnipes();

function launchSnipe(channel: ChatChannel): void {
  // Tell the channel: OK, your snipe has been accepted for routing.

  let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];


  let message: string = "The snipe is on (**#${activeSnipes[JSON.stringify(channel)].snipeId}**).  Bet in multiples of 0.01XLM.  Betting format:";
  message += `\`\`\`+0.01XLM@${botUsername}\`\`\``;


  snipe.chatSend(message);


  snipe.betting_stops = moment().add(snipe.initialCountdown, 'seconds');

  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    runClock(channel, sentMessage.id, snipe.initialCountdown);
    snipe.clock = sentMessage.id;
  });

  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, snipe.initialCountdown * 1000);
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
  const bets = {};
  snipe.participants.forEach((participant) => {
    if(typeof(bets[participant.txn.fromUsername]) === 'undefined') {
      bets[participant.txn.fromUsername] = {
        fees: [],
        wagers: [],
      };
    }
    bets[participant.txn.fromUsername].fees.push(calculateTransactionFees(txn));
    bets[participant.txn.fromUsername].wagers.push(txn.amount);
  });


  const participantList = Object.keys(transactionFees);

  participantList.forEach((participant) => {
    Promise.all(bets[participant].fees).then(fees => {
      feeSum = fees.reduce((a,b) => a+b);
      wagerSum = bets[participant].wagers.reduce((a,b) => a+b);
      let refund: number = _.round(wagerSum - feeSum, 7);
      snipe.moneySend(refund, participant);
    });
  });
}


function executeFlipOrCancel(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) !== "undefined") {
    const participantUsernames: Array<string> = snipe.participants.map((participant) => participant.username);
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
        if(snipe.reFlips > 0) {
          snipe.chatSend('Due to error, we are going to re-flip in 60 seconds');
          snipe.reFlips--;
          setTimeout(() => {
            flip(msg.channel);
          }, 60 *1000);
          clearInterval(flipMonitorIntervals[conversationId]);
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

      bot.chat.edit(channel, messageId, {
        message: {
          body: hourglass + ` betting stops ${moment().to(snipe.betting_stops)}`,
        },
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

    await bot.chat.watchAllChannelsForNewMessages(
      async (msg) => {
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
