// tsc --lib es2015 index.ts

import axios, { AxiosResponse } from "axios";

import * as _ from "lodash";
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
  wager: number;
  participants: Array<IParticipant>;
  betting_open: boolean;
}

function processRefund(txn: Transaction, channel: ChatChannel): void {

  console.log("refunding txn", txn);

  const txnDetailsApi: string = `https://horizon.stellar.org/transactions/${txn.txId}`;
  axios.get(txnDetailsApi).then((response: AxiosResponse<any>) => {

    // API returns a response, number of stroops
    let transactionFees: number = parseFloat(response.data.fee_paid) * 0.0000001;
    if (isNaN(transactionFees)) {
      transactionFees = 300 * 0.0000001;
    }

    console.log("refunding txn fees", transactionFees);

    const refund: number = _.round(txn.amount - transactionFees, 7);

    console.log("total refund is", refund);

    bot.wallet.send(txn.fromUsername, refund.toString()).then((refundTxn: Transaction) => {
      let refundMsg: string = `\`\`\`+${refund}XLM@${txn.fromUsername}\`\`\` `;
      refundMsg += ` :arrow_right: `;
      refundMsg += `https://stellar.expert/explorer/public/tx/${refundTxn.txId}`;
      bot.chat.send(channel, {
        body: refundMsg,
      });
    }).catch((err) => {
      console.log(err);
    });

  });

}

function extractTxn(msg: MessageSummary): void {
  const txnId: string = msg.content.text.payments[0].result.sent;
  bot.wallet.details(txnId).then((details) => processTxnDetails(details, msg.channel));
}

function sendAmountToWinner(winnerUsername: string, wager: number, channel: ChatChannel): void {

  let txnDetailsApi: string;
  let transactionFees: number;
  let bounty: number;
  let thisTxnFee: number;
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  Promise.all(snipe.participants.map((participant) => {
    txnDetailsApi = `https://horizon.stellar.org/transactions/${participant.transaction.txId}`;
    return axios.get(txnDetailsApi);
  })).then((apiResponses) => {
     transactionFees = 0;
     bounty = 0;
     apiResponses.forEach((apiResponse: AxiosResponse) => {
       thisTxnFee = (parseFloat(apiResponse.data.fee_paid) * 0.0000001);
       if (isNaN(thisTxnFee)) {
         thisTxnFee = 300 * 0.0000001;
       }
       transactionFees += thisTxnFee;
       bounty += snipe.wager;
     });
     bounty = _.round(bounty - transactionFees, 7);
     bot.wallet.send(winnerUsername, bounty.toString()).then((txn) => {
       let bountyMsg: string = `\`\`\`+${bounty}XLM@${winnerUsername}\`\`\` `;
       bountyMsg += `:arrow_right: `;
       bountyMsg += `https://stellar.expert/explorer/public/tx/${txn.txId}`,
       bot.chat.send(channel, {
        body: bountyMsg,
      });
    });
  });
}

function resolveFlip(channel: ChatChannel, results: Array<string>): void {
  const winnerUsername: string = results[0];
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  sendAmountToWinner(winnerUsername, snipe.wager, channel);
  bot.chat.send(channel, {
    body: `Congrats to @${winnerUsername}`,
  });
}

function flip(channel: ChatChannel): void {
  const flipParticipants: Array<string> = activeSnipes[JSON.stringify(channel)].participants.map((el) => {
    return el.username;
  }).join(", ");

  bot2.chat.send(channel, {
    body: `/flip ${flipParticipants}`,
  });
}

function processTxnDetails(txn: Transaction, channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) === "undefined") {
    processRefund(txn, channel);
  }
  const isNative: boolean = txn.asset.type === "native";
  if (!isNative) {
    processRefund(txn, channel);
  }
  if (txn.toUsername !== botUsername) {
    processRefund(txn, channel);
  }
  if (snipe.betting_open === false) {
    processRefund(txn, channel);
  } else {
    activeSnipes[JSON.stringify(channel)].participants.push({
      transaction: txn,
      username: txn.fromUsername,
    });
    bot.chat.send(channel, {
      body: `@${txn.fromUsername} is locked into the snipe!`,
    });
  }

}

const activeSnipes: object = {};

function launchSnipe(wager: number, channel: ChatChannel): void {
  // Tell the channel: OK, your snipe has been accepted for routing.
  let message: string = "The snipe is on.  ";
  message += `Anybody is free to send me _exactly_ ${wager}XLM within 30 seconds: `;
  message += `\`\`\`+${wager}XLM@${botUsername}\`\`\``;
  message += `If there are not at >= 2 confirmed participants, the snipe is going `;
  message += `to be cancelled with deposits refunded, less transaction fess.`;
  bot.chat.send(channel, { body: message });

  bot.chat.send(channel, {
    body: "Betting stops in 30 seconds",
  }).then((sentMessage) => {
    runClock(channel, sentMessage.id, 30);
  });

  setTimeout(() => {
    finalizeBets(channel);
  }, 30 * 1000);

  activeSnipes[JSON.stringify(channel)] = {
    betting_open: true,
    participants: [],
    wager: {},
  };
}

function finalizeBets(channel: ChatChannel): void {
  bot.chat.send(channel, {
    body: "No more bets!",
  });
  activeSnipes[JSON.stringify(channel)].betting_open = false;
   // Give 5 seconds to finalize transactions + 1 extra.
  setTimeout(() => {
    executeFlipOrCancel(channel);
  }, 6 * 1000);
}

function executeFlipOrCancel(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) !== "undefined") {
    if (snipe.participants.length > 1) {
      flip(channel);
    } else if (snipe.participants.length === 1) {
      processRefund(snipe.participants[0].transaction, channel);
      bot.chat.send(channel, {
        body: "The snipe has been cancelled due to a lack of participants.",
      });
      activeSnipes[JSON.stringify(channel)] = undefined;
    } else {
      bot.chat.send(channel, {
        body: "The snipe has been cancelled due to a lack of participants.",
      });
      activeSnipes[JSON.stringify(channel)] = undefined;
    }
  }
}

function checkForSnipe(msg: MessageSummary): void {
  if (msg.channel.public || msg.channel.membersType !== "team" || msg.channel.topicType !== "chat") {
    // Croupier only listens to public conversations.
    return;
  }

  if (typeof activeSnipes[JSON.stringify(msg.channel)] !== "undefined") {
    bot.chat.send(msg.channel, {
      body: "Please!  Just one active snipe per channel at any given moment",
    });
    return;
  }

  const msgText: string = msg.content.text.body;

  const wagerRegexString: string = "([0-9]+(?:[\\.][0-9]*)?|\\.[0-9]+)";
  const cryptosnipeRegex: RegExp = new RegExp(`^\\/cryptosnipe\\s+\\+${wagerRegexString}XLM@${botUsername}`);

  const matchResults: RegExpMatchArray = msgText.match(cryptosnipeRegex);
  if (matchResults === null) {
    bot.chat.send(msg.channel, {
      body: `Format is: \`\`\`/cryptosnipe +0.005XLM@${botUsername}\`\`\``,
    });
    return;
  }
  const wager: number = parseFloat(matchResults[1]);
  if (Number.isNaN(wager)) {
    bot.chat.send(msg.channel, {
      body: "Wager must be in decimal format",
    });
    return;
  }
  if (wager < 0.0001) {
    bot.chat.send(msg.channel, {
      body: "Wager must >= 0.0001XLM",
    });
    return;
  }
  if (wager > 0.01) {
    // throw error, amount must be less than threshold
    bot.chat.send(msg.channel, {
      body: `${botUsername} is prototype stage software.  Please do not wager more than 0.01XLM`,
    });
    return;
  }
  launchSnipe(wager, msg.channel);
}

function cancelFlip(conversationId: string, channel: ChatChannel, err: Error): void {
  clearInterval(flipMonitorIntervals[conversationId]);
  bot.chat.send(channel, {
    body: `The flip has been cancelled due to error,
     \`${err}\`,
    and everyone is getting a refund`,
  });
  activeSnipes[JSON.stringify(channel)].participants.forEach((participant) => {
    processRefund(participant.transaction, channel);
  });
  activeSnipes[JSON.stringify(channel)] = undefined;
}

// Something to consider paging to disk or network
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
          resolveFlip(msg.channel, flipDetails.resultInfo.shuffle);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
          activeSnipes[JSON.stringify(msg.channel)] = undefined;
        }
      });
    } catch (err) {
      cancelFlip(msg.conversationId, msg.channel, err);
    }
  }), 1000);
}

const allClocks: Array<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reverse();
const runningClocks: object = {};

function runClock(channel: ChatChannel, messageId: string, seconds: number): void {
  bot.chat.edit(channel, messageId, {
    message: {
      body: ":clock" + allClocks[seconds % 12].toString() + ":" + ` betting stops in ${seconds}s`,
    },
  });

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
      body: `${botUsername} was just restarted...[development mode] [use at own risk].  Now in TypeScript!`,
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
          if (msg.content.text && /^\/cryptosnipe/.test(msg.content.text.body)) {
            checkForSnipe(msg);
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
