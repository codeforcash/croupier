// tsc --lib es2015 index.ts

import * as _ from "lodash";
import * as mysql from "mysql";
import * as os from "os";
import * as Bot from "./keybase-bot";

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
}

interface ISnipe {
  participants: Array<IParticipant>;
  betting_open: boolean;
  clock: string;
  timeout: string;
}

function documentSnipe(channel: ChatChannel, winner: string, wasCancelled: boolean): void {
  const participants: string = JSON.stringify(activeSnipes[JSON.stringify(channel)].participants);
  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  if (winner !== null) {
    winner = `'${winner}'`;
  }

  connection.query(`INSERT INTO snipes
    (participants, winner, was_cancelled)
    VALUES
    ('${participants}', ${winner}, ${wasCancelled})`, (error, results, fields) => {
      if (error) {
        console.log(error);
      }
    });

  connection.end();
}

function processRefund(txn: Transaction, channel: ChatChannel): void {
  console.log("refunding txn", txn);
  // API returns a response, number of stroops
  const transactionFees: number = 300 * 0.0000001;
  console.log("refunding txn fees", transactionFees);
  const refund: number = _.round(txn.amount - transactionFees, 7);
  console.log("total refund is", refund);
  bot.chat.sendMoneyInChat(channel.topicName, channel.name, refund.toString(), txn.fromUsername);
}

function extractTxn(msg: MessageSummary): void {
  const txnId: string = msg.content.text.payments[0].result.sent;
  bot.wallet.details(txnId).then((details) => processTxnDetails(details, msg.channel));
}

function sendAmountToWinner(winnerUsername: string, channel: ChatChannel): void {

  let bounty: number;
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  bounty = 0;

  snipe.participants.forEach((participant) => {
     bounty += parseFloat(participant.transaction.amount);
     bounty -= (300 * 0.0000001); // transaction fees for receiving the transaction
  });

  bounty = _.round(bounty, 7);
  console.log("now rounded", bounty);

  bot.chat.sendMoneyInChat(channel.topicName, channel.name, bounty.toString(), winnerUsername);

}

function resolveFlip(channel: ChatChannel, winningNumber: number): void {

  let winnerUsername: string;
  const bettorRange: object = buildBettorRange(channel);
  Object.keys(bettorRange).forEach((username) => {
    if (bettorRange[username][0] <= winningNumber && bettorRange[username][1] >= winningNumber) {
      winnerUsername = username;
    }
  });

  sendAmountToWinner(winnerUsername, channel);
  bot.chat.send(channel, {
    body: `Congrats to @${winnerUsername}`,
  });

  documentSnipe(channel, winnerUsername, false);
}

function buildBettorRange(channel: ChatChannel): any {
  const bettorMap: object = {};
  activeSnipes[JSON.stringify(channel)].participants.forEach((participant) => {
    if (typeof(bettorMap[participant.username]) === "undefined") {
      bettorMap[participant.username] = Math.floor(participant.transaction.amount / 0.01);
    } else {
      bettorMap[participant.username] += Math.floor(participant.transaction.amount / 0.01);
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

function flip(channel: ChatChannel): void {

  const bettorRange: object = buildBettorRange(channel);
  const bettingValues: Array<Array<number>> = Object.values(bettorRange);
  const flatBettingValues: Array<number> = _.flatten(bettingValues);

  const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
  const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

  let bettingTable: string = "Betting table\n";

  Object.keys(bettorRange).forEach((username) => {
    bettingTable += `\n@${username}: \`${bettorRange[username][0]} - ${bettorRange[username][1]}\``;
  });

  bot2.chat.send(channel, {
    body: bettingTable,
  });
  bot2.chat.send(channel, {
    body: `/flip ${minBet}..${maxBet}`,
  });
}

function processTxnDetails(txn: Transaction, channel: ChatChannel): void {
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
    launchSnipe(channel);
    activeSnipes[JSON.stringify(channel)].participants.push({
      transaction: txn,
      username: txn.fromUsername,
    });
  }

  console.log("betting_open 178");
  if (snipe.betting_open === false) {
    bot.chat.send(channel, {
      body: `Betting has closed - refunding`,
    });
    processRefund(txn, channel);
    return;
  }

  activeSnipes[JSON.stringify(channel)].participants.push({
    transaction: txn,
    username: txn.fromUsername,
  });
  bot.chat.send(channel, {
    body: `@${txn.fromUsername} is locked into the snipe!`,
  });
  resetSnipeClock(channel);
}

function resetSnipeClock(channel: ChatChannel): void {

  const snipeTimeout: number = 60;
  clearTimeout(activeSnipes[JSON.stringify(channel)].timeout);
  bot.chat.delete(channel, activeSnipes[JSON.stringify(channel)].clock, {});
  bot.chat.send(channel, {
    body: `Betting stops in ${snipeTimeout} seconds`,
  }).then((sentMessage) => {
    runClock(channel, sentMessage.id, snipeTimeout);
    activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
  });
  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, snipeTimeout * 1000);
  activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;

}

const activeSnipes: object = {};

function launchSnipe(channel: ChatChannel): void {
  // Tell the channel: OK, your snipe has been accepted for routing.

  const snipeTimeout: number = 60;
  let message: string = "The snipe is on.  Bet in multiples of 0.01XLM.  Betting format:";
  message += `\`\`\`+0.01XLM@${botUsername}\`\`\``;

  activeSnipes[JSON.stringify(channel)] = {
    betting_open: true,
    clock: null,
    participants: [],
    timeout: null,
  };

  bot.chat.send(channel, { body: message });

  bot.chat.send(channel, {
    body: `Betting stops in ${snipeTimeout} seconds`,
  }).then((sentMessage) => {
    runClock(channel, sentMessage.id, snipeTimeout);
    activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
  });

  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, snipeTimeout * 1000);
  activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;

}

function finalizeBets(channel: ChatChannel): void {
  bot.chat.send(channel, {
    body: "No more bets!",
  });

  console.log("betting_open 255");
  activeSnipes[JSON.stringify(channel)].betting_open = false;
   // Give 5 seconds to finalize transactions + 1 extra.
  setTimeout(() => {
    executeFlipOrCancel(channel);
  }, 6 * 1000);
}

/* TODO: check that there are _different_ participants not someone betting against themself multiple times */
function executeFlipOrCancel(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) !== "undefined") {
    const participantUsernames: Array<string> = snipe.participants.map((participant) => participant.username);
    const uniqParticipants: Array<string> = _.union(participantUsernames);
    if (uniqParticipants.length > 1) {
      flip(channel);
    } else if (uniqParticipants.length === 1) {
      snipe.participants.forEach((participant) => {
        processRefund(participant.transaction, channel);
      });
      bot.chat.send(channel, {
        body: "The snipe has been cancelled due to a lack of participants.",
      });
      documentSnipe(channel, null, true);
      activeSnipes[JSON.stringify(channel)] = undefined;
    } else {
      bot.chat.send(channel, {
        body: "The snipe has been cancelled due to a lack of participants.",
      });
      documentSnipe(channel, null, true);
      activeSnipes[JSON.stringify(channel)] = undefined;
    }
  }
}

function cancelFlip(conversationId: string, channel: ChatChannel, err: Error): void {
  clearInterval(flipMonitorIntervals[conversationId]);
  if (typeof(activeSnipes[JSON.stringify(channel)]) !== "undefined") {
    bot.chat.send(channel, {
      body: `The flip has been cancelled due to error, and everyone is getting a refund`,
    });
    activeSnipes[JSON.stringify(channel)].participants.forEach((participant) => {
      processRefund(participant.transaction, channel);
    });
    documentSnipe(channel, null, true);
    activeSnipes[JSON.stringify(channel)] = undefined;
  }
}

const flipMonitorIntervals: object = {};

function monitorFlipResults(msg: MessageSummary): void {

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
          resolveFlip(msg.channel, flipDetails.resultInfo.number);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
          activeSnipes[JSON.stringify(msg.channel)] = undefined;
        } else {
          console.log("results are NOT in", flipDetails);
        }
      }).catch((err) => {

        cancelFlip(msg.conversationId, msg.channel, err);

      });
    } catch (err) {
      cancelFlip(msg.conversationId, msg.channel, err);
    }
  }), 1000);
}

const allClocks: Array<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reverse();
const runningClocks: object = {};

function runClock(channel: ChatChannel, messageId: string, seconds: number): void {
  try {
    bot.chat.edit(channel, messageId, {
      message: {
        body: ":clock" + allClocks[seconds % 12].toString() + ":" + ` betting stops in ${seconds}s`,
      },
    });
  } catch (e) {
    return;
  }

  if (seconds > 1) {
    setTimeout(() => {
      runClock(channel, messageId, seconds - 1);
    }, 1000);
  } else {
    setTimeout(() => {
      bot.chat.edit(channel, messageId, {
        message: {
          body: "~:clock" + allClocks[seconds % 12].toString() + ":" + ` betting stops in 1s~ no longer accepting bets`,
        },
      });
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
