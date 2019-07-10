// tsc --lib es2015 index.ts

import * as _ from "lodash";
import * as moment from "moment";
import * as mysql from "mysql";
import * as os from "os";
import * as sourceMapSupport from "source-map-support";
import * as throttledQueue from "throttled-queue";
import * as Bot from "./keybase-bot";

// import "source-map-support/register";

sourceMapSupport.install({
  environment: "node",
});

const bot: Bot = new Bot(os.homedir());
const bot2: Bot = new Bot(os.homedir());

const botUsername: string = "croupier";
const paperkey: string = process.env.CROUPIER_PAPERKEY_1;
const paperkey2: string = process.env.CROUPIER_PAPERKEY_2;

let activeSnipes: object;

let sassyPopularityContestDescription: string = "Put it to a vote: who does the group like more, ";
sassyPopularityContestDescription += "you or the pot leader?  If the pot leader wins, your ";
sassyPopularityContestDescription += "position is reduced to 1.  If you win, you and the pot ";
sassyPopularityContestDescription += "leader swap position sizes!";

const powerups: Array<IPowerup> = [
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
  powerup: IPowerup;
}

interface IPowerup {
  award: IPowerupAward;
  awardedAt: number;
  usedAt: number;
  participantIndex: number;
  reactionId: string;
}

interface IPowerupAward {
  name: string;
  description: string;
  reaction: string;
  emoji: string;
}

type ThrottledChat = (message: string) => Promise<any>;
type ThrottledMoneyTransfer = (xlmAmount: number, recipient: string) => Promise<any>;

interface IPopularityContest {
  challenger: string;
  leader: string;
  pollMessageId: string;
  votesForChallenger: Array<string>;
  votesForLeader: Array<string>;
}

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
  positionSizes: Array<IPositionSize>;
  reflipping: boolean;
  bettingTable: string;
  blinds: number;
  betting_started: number;
  popularityContests: Array<IPopularityContest>;
  potSizeStored: number;
  clockRemaining: number;
}

interface IPositionSize {
  [key: string]: number;
}

function updateSnipeLog(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const participants: string = JSON.stringify(snipe.participants);
  const positionSizes: string = JSON.stringify(snipe.positionSizes);
  const blinds: number = snipe.blinds;
  const snipeId: number = activeSnipes[JSON.stringify(channel)].snipeId;

  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

  connection.connect();

  connection.query(`
    UPDATE snipes SET
    participants=${connection.escape(participants)},
    position_sizes=${connection.escape(positionSizes)},
    blinds=${connection.escape(blinds)},
    pot_size=${connection.escape(calculatePotSize(channel))},
    clock_remaining=${connection.escape(getTimeLeft(snipe))}
    WHERE
    id=${connection.escape(snipeId)}`, (error, results, fields) => {
    if (error) {
      console.log(error);
    }
  });
  connection.end();
}

// If the same person made 3 bets in a row, issue a powerup
// but not if they have recently been issued a powerup
function shouldIssuePowerup(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const count: number = snipe.participants.length;
  if (count >= 3
      && snipe.participants[count - 1].username === snipe.participants[count - 2].username
      && snipe.participants[count - 2].username === snipe.participants[count - 3].username
    ) {

    let lastPowerupIndex: number = 0;
    snipe.participants.forEach((participant, idx) => {
      if (participant.powerup) {
        lastPowerupIndex = idx;
      }
    });
    if (((count - 1) - lastPowerupIndex) >= 3) {
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function issuePowerup(channel: ChatChannel, participantIndex: number): void {
  const award: IPowerupAward = _.sample(powerups);
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.participants[participantIndex].powerup = {
    award,
    awardedAt: +new Date(),
    participantIndex,
    reactionId: null,
    usedAt: null,
  };

  const awardee: string = snipe.participants[participantIndex].username;
  snipe.chatSend(`Congrats @${awardee}, you won the **${award.name}** powerup.
    *${award.description}*
    Click the emoji to consume the powerup.`).then((msg) => {
      bot.chat.react(channel, msg.id, award.reaction);
      snipe.participants[participantIndex].powerup.reactionId = msg.id;
    });

}

function addSnipeParticipant(channel: ChatChannel, txn: Transaction, onBehalfOf?: string): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  let newParticipant: object;
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

  snipe.participants.push(newParticipant);
  if (typeof(snipe.positionSizes[betBeneficiary]) === "undefined") {
    snipe.positionSizes[betBeneficiary] = Math.floor(txn.amount / 0.01);
  } else {
    snipe.positionSizes[betBeneficiary] += Math.floor(txn.amount / 0.01);
  }

  if (shouldIssuePowerup(channel)) {
    issuePowerup(channel, snipe.participants.length - 1);
  }

  updateSnipeLog(channel);
}

function logNewSnipe(channel: ChatChannel): Promise<any> {

  return new Promise((resolve) => {

    const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
    const connection: mysql.Connection = mysql.createConnection({
      database : process.env.MYSQL_DB,
      host     : process.env.MYSQL_HOST,
      password : process.env.MYSQL_PASSWORD,
      user     : process.env.MYSQL_USER,
    });

    connection.connect();

    connection.query(`INSERT INTO snipes
      (channel, countdown, betting_started)
      VALUES
      (${connection.escape(JSON.stringify(channel))},
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

function documentSnipe(channel: ChatChannel, reason: string): void {

  const snipeId: number = activeSnipes[JSON.stringify(channel)].snipeId;
  let wasCancelled: number;
  let winner: string;
  let cancellationReason: string;

  const connection: mysql.Connection = mysql.createConnection({
    database : process.env.MYSQL_DB,
    host     : process.env.MYSQL_HOST,
    password : process.env.MYSQL_PASSWORD,
    user     : process.env.MYSQL_USER,
  });

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
      id=${connection.escape(snipeId)}
    `, (error, results, fields) => {
      if (error) {
        console.log(error);
      }
    });

  connection.end();
}

function calculateTransactionFees(txn: Transaction): Promise<number> {
  return new Promise((resolve) => {
    bot.wallet.details(txn.txId).then((details) => {
      const xlmFeeMatch: Array<any> = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
      if (xlmFeeMatch !== null) {
        const fee: number = parseFloat(xlmFeeMatch[1]);
        console.log("fee", fee);
        resolve(fee);
      }
    });
  });
}

function processRefund(txn: Transaction, channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  console.log("refunding txn", txn);
  calculateTransactionFees(txn).then((transactionFees) => {
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

  const transactionFeePromises: Array<Promise<any>> = [];

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
      team: channel.name,
    }).then((res) => {

      let allMembers: Array<string> = [];
      allMembers = allMembers.concat(res.members.owners.map((u) => u.username));
      allMembers = allMembers.concat(res.members.admins.map((u) => u.username));
      allMembers = allMembers.concat(res.members.writers.map((u) => u.username));
      allMembers = allMembers.concat(res.members.readers.map((u) => u.username));

      // it's possible the winner is not in the chat, that they won through a onBehalfOf contribution of someone else
      if (allMembers.indexOf(winnerUsername) === -1) {
        bot.wallet.send(winnerUsername, bounty.toString()).then((txn) => {
          let bountyMsg: string = `\`+${bounty}XLM@${winnerUsername}\` `;
          bountyMsg += `:arrow_right: `;
          bountyMsg += `https://stellar.expert/explorer/public/tx/${txn.txId}`;
          snipe.chatSend(bountyMsg);
        });
      } else {
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
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.chatSend(`Congrats to @${winnerUsername}`);

  return winnerUsername;
}

function buildBettorRange(channel: ChatChannel): any {
  const bettorMap: object = {};
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const bettorRange: object = {};
  let start: number = 0;

  Object.keys(snipe.positionSizes).sort((a, b) => {
    return snipe.positionSizes[a] > snipe.positionSizes[b] ? -1 : 1;
  }).forEach((username) => {
    bettorRange[username] = [start + 1, start + snipe.positionSizes[username]];
    start += snipe.positionSizes[username];
  });
  return bettorRange;
}

function displayFixedNice(a: number): string {
  let aFormatted: string = a.toFixed(2).toString();
  if (aFormatted.slice(-2, aFormatted.length) === "00") {
    aFormatted = parseInt(aFormatted, 10).toString();
  }
  return aFormatted;
}

function buildBettingTable(potSize: number, bettorRange: object): string {

  console.log("within BuildBettingTable, bettorRange:", bettorRange);

  const maxValue: number = Math.max(..._.flatten(Object.values(bettorRange)));
  let bettingTable: string = `Pot size: ${displayFixedNice(potSize)}XLM\n`;
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
    bettingTable += ` (${displayFixedNice(chancePct)}% chance)`;
  });

  return bettingTable;

}

function makeSubteamForFlip(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const subteamName: string = `croupierflips.snipe${snipe.snipeId}`;

  const usernamesToAdd: Array<object> = [{username: "croupier", role: "admin"}];
  Object.keys(snipe.positionSizes).forEach((username) => {
    usernamesToAdd.push({
      role: "reader",
      username,
    });
  });
  bot.team.createSubteam(subteamName).then((res) => {
    bot.team.addMembers({
      team: subteamName,
      usernames: usernamesToAdd,
    }).then((addMembersRes) => {
      const newSubteam: ChatChannel = {
        membersType: "team", name: subteamName,
      };
      flip(channel, newSubteam);
    });
  });

}

function flip(channel: ChatChannel, whereToFlip: ChatChannel): void {

  if (typeof(whereToFlip) === "undefined") {
    whereToFlip = channel;
  }

  const bettorRange: object = buildBettorRange(channel);
  const bettingValues: Array<Array<number>> = Object.values(bettorRange);
  const flatBettingValues: Array<number> = _.flatten(bettingValues);
  const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
  const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

  const bettingTable: string = buildBettingTable(calculatePotSize(channel), bettorRange);

  bot2.chat.send(whereToFlip, {
    body: "**Final betting table...**",
  });
  bot2.chat.send(whereToFlip, {
    body: bettingTable,
  });
  bot2.chat.send(whereToFlip, {
    body: `/flip ${minBet}..${maxBet}`,
  }).then((res) => {
    const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
    snipe.reflipping = false;
  });
}

function checkWalletBalance(username: string): Promise<any> {
  let balance: number = 0;
  return new Promise((resolve) => {
    bot.wallet.lookup(username).then((acct) => {
      console.log(acct);
      bot.wallet.balances(acct.accountId).then((balances) => {
        console.log(balances);
        balances.forEach((acctDetail) => {
          console.log(acctDetail.balance[0].amount);
          balance += parseFloat(acctDetail.balance[0].amount);
        });
        resolve(balance);
      }).catch((e) => {
        console.log(e);
        resolve(null);
      });
    }).catch((e) => {
      console.log(e);
      resolve(null);
    });
  });
}

function processNewBet(txn: Transaction, msg: MessageSummary): Promise<boolean> {

  const channel: ChatChannel = msg.channel;
  const onBehalfOfMatch: Array<any> = msg.content.text.body.match(/(for|4):\s?@?(\w+)/i);
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  return new Promise((resolve) => {

    if (onBehalfOfMatch !== null) {
      const onBehalfOfRecipient: string = onBehalfOfMatch[2];

      // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
      // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
      // new wallets
      checkWalletBalance(onBehalfOfRecipient).then((balance) => {
        if (balance === null || balance < 2.01) {
          let sassyMessage: string = "Betting on behalf of someone else?  ";
          sassyMessage += "Seems like they do not have a wallet yet, ";
          sassyMessage += "so your bet must be at least 2.01XLM";
          snipe.chatSend(sassyMessage);
          processRefund(txn, msg.channel);
          resolve(false);
        } else if (typeof(snipe.positionSizes[txn.fromUsername]) === "undefined") {
          snipe.chatSend("You cannot bet on behalf of someone else unless you are participating as well");
          resolve(false);
        } else {
          addSnipeParticipant(channel, txn, onBehalfOfRecipient);
          snipe.chatSend(`@${onBehalfOfRecipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
          bot.chat.react(channel, msg.id, ":gift:");
          resolve(true);
        }
      });
    } else {
      addSnipeParticipant(channel, txn, undefined);
      bot.chat.react(channel, msg.id, ":heavy_check_mark:");
      resolve(true);
    }
  });
}

function processTxnDetails(txn: Transaction, msg: MessageSummary): void {

  const channel: ChatChannel = msg.channel;
  let snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  if (txn.toUsername !== botUsername) {
    return;
  }
  const isNative: boolean = txn.asset.type === "native";
  if (!isNative) {
    return;
  }

  let blinds: number;
  if (typeof(snipe) === "undefined") {
    blinds = 0.01;
  } else {
    blinds = snipe.blinds;
  }
  if (parseFloat(txn.amount) < blinds) {
    bot.chat.send(channel, {
      body: `Thanks for the tip, but bets should be >= ${blinds}XLM`,
    });
    return;
  }

  if (typeof(snipe) === "undefined") {

    let countdown: number = 60;
    const countdownMatch: Array<any> = msg.content.text.body.match(/countdown:\s?(\d+)/i);
    if (countdownMatch !== null) {
      countdown = parseInt(countdownMatch[1], 10);
      if (countdown < 5 || countdown > 60 * 60 * 24 * 7) {
        countdown = 60;
        bot.chat.send(channel, {
          body: `Bad value of countdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)`,
        });
      }
    }

    const chatThrottle: any = throttledQueue(5, 5000);
    const moneyThrottle: any = throttledQueue(5, 5000);

    activeSnipes[JSON.stringify(channel)] = {
      betting_open: true,
      betting_started: +new Date(),
      betting_stops: moment().add(countdown, "seconds"),
      blinds: 0.01,
      chatSend: (message) => {
        return new Promise((resolve) => {
          chatThrottle(() => {
            bot.chat.send(channel, {
              body: message,
            }).then((messageId) => {
              resolve(messageId);
            });
          });
        });
      },
      clock: null,
      countdown,
      moneySend: (amount, recipient) => {
        return new Promise((resolve) => {
          moneyThrottle(() => {
            bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
            resolve(true);
          });
        });
      },
      participants: [],
      popularityContests: [],
      positionSizes: {},
      reFlips: 3,
      timeout: null,
    };

    logNewSnipe(channel).then((snipeId) => {
      snipe = activeSnipes[JSON.stringify(channel)];
      snipe.snipeId = snipeId;
      launchSnipe(channel);
      processNewBet(txn, msg);
    });
  } else {
    if (snipe.betting_open === false) {
      snipe.chatSend(`Betting has closed - refunding`);
      // Ensure the transaction is Completed before refunding
      setTimeout(() => {
        processRefund(txn, channel);
      }, 1000 * 5);
      return;
    }

    processNewBet(txn, msg).then((betProcessed) => {
      if (betProcessed) {
        resetSnipeClock(channel);
      }
    });
  }
}

function calculatePotSize(channel: ChatChannel): number {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  let sum: number;
  if (snipe.potSizeStored) { // temp solution while we build a server solution robust enough to hold big data
    sum = snipe.potSizeStored;
  } else {
    sum = 0;
  }

  snipe.participants.forEach((participant) => {
    sum += parseFloat(participant.transaction.amount);
  });
  return sum;
}

function getTimeLeft(snipe: ISnipe): number {
  return Math.ceil(Math.abs(moment.duration(snipe.betting_stops.diff(moment())).asSeconds()));
}

function resetSnipeClock(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (snipe.bettingTable) {
    bot.chat.delete(channel, snipe.bettingTable, {}).then(() => {
      snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then((msg) => {
        snipe.bettingTable = msg.id;
      });
    });
  } else {
    snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then((msg) => {
      snipe.bettingTable = msg.id;
    });
  }
  const timeRemaining: number = Math.ceil(getTimeLeft(snipe));
  console.log("time remaining", timeRemaining);
  clearTimeout(snipe.timeout);

  let boost: number;
  let timerEndsInSeconds: number;
  if (timeRemaining <= 30) {
    timerEndsInSeconds = 60;
  } else {
    boost = 10;
    timerEndsInSeconds = timeRemaining + boost;
  }

  snipe.betting_stops = moment().add(timerEndsInSeconds, "seconds");

  bot.chat.delete(channel, snipe.clock, {});
  snipe.chatSend(`+Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    console.log("just sent the parent betting stops message in resetSnipeClock");
    console.log("sentMessage", sentMessage);
    snipe.clock = sentMessage.id;
  });
  const finalizeBetsTimeout: NodeJS.Timeout = setTimeout(() => {
    finalizeBets(channel);
  }, timerEndsInSeconds * 1000);
  snipe.timeout = finalizeBetsTimeout;

}

function loadActiveSnipes(): object {
  return new Promise((resolve) => {
    const snipes: object = {};

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
        const chatThrottle: any = throttledQueue(5, 5000);
        const moneyThrottle: any = throttledQueue(5, 5000);
        const channel: ChatChannel = JSON.parse(result.channel);
        snipes[JSON.stringify(channel)] = {
          betting_open: true,
          betting_started: parseInt(result.betting_started, 10),
          blinds: parseFloat(result.blinds),
          chatSend: (message) => {
            return new Promise((resolveChatThrottle) => {
              chatThrottle(() => {
                bot.chat.send(channel, {
                  body: message,
                }).then((messageId) => {
                  resolveChatThrottle(messageId);
                });
              });
            });
          },
          clock: null,
          clockRemaining: result.clock_remaining,
          countdown: result.countdown,
          moneySend: (amount, recipient) => {
            return new Promise((resolveMoneyThrottle) => {
              moneyThrottle(() => {
                bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
                resolveMoneyThrottle();
              });
            });
          },
          participants: JSON.parse(result.participants),
          popularityContests: [],
          positionSizes: JSON.parse(result.position_sizes),
          potSizeStored: parseInt(result.potSize, 10),
          snipeId: parseInt(result.id, 10),
          timeout: null,
        };
      });
      resolve(snipes);
    });
    connection.end();
  });
}

function launchSnipe(channel: ChatChannel): void {
  // Tell the channel: OK, your snipe has been accepted for routing.
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  let message: string = `The snipe is on (**#${activeSnipes[JSON.stringify(channel)].snipeId}**).  `;
  message += `Bet in multiples of 0.01XLM.  Betting format:`;
  message += `\`\`\`+0.01XLM@${botUsername}\`\`\``;
  message += `Minimum bet: ${displayFixedNice(snipe.blinds)}XLM`;

  snipe.chatSend(message);

  if (snipe.clockRemaining === null) {
    snipe.betting_stops = moment().add(snipe.countdown, "seconds");
  } else {
    snipe.betting_stops = moment().add(snipe.clockRemaining, "seconds");
  }

  snipe.chatSend(`-Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    snipe.clock = sentMessage.id;
    runClock(channel);
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
    if (typeof(bets[participant.transaction.fromUsername]) === "undefined") {
      const betData: IBetData = {
        fees: [],
        wagers: [],
      };
      bets[participant.transaction.fromUsername] = betData;

    }
    bets[participant.transaction.fromUsername].fees.push(calculateTransactionFees(participant.transaction));
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
      snipe.moneySend(refund, participant);
    });
  });
}

function executeFlipOrCancel(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  if (typeof(snipe) !== "undefined") {
    const participantUsernames: Array<string> = snipe.participants.map((participant) => {
        return participant.onBehalfOf || participant.username;
    });
    const uniqParticipants: Array<string> = _.union(participantUsernames);
    if (uniqParticipants.length > 1) {
      flip(channel, channel);
    } else {
      refundAllParticipants(channel);
      snipe.chatSend("The snipe has been canceled due to a lack of participants.");
      clearSnipe(channel, "lack-of-participants");
    }
  }
}

function cancelFlip(conversationId: string, channel: ChatChannel, err: Error): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  clearInterval(flipMonitorIntervals[conversationId]);
  if (typeof(activeSnipes[JSON.stringify(channel)]) !== "undefined") {
    snipe.chatSend(`The flip has been cancelled due to error, and everyone is getting a refund`);
    refundAllParticipants(channel);
    clearSnipe(channel, "flip-error");
  }
}

function getChannelFromSnipeId(snipeId: number): ChatChannel {
  Object.keys(activeSnipes).forEach((stringifiedChannel) => {
    if (activeSnipes[stringifiedChannel].snipeId === snipeId) {
      return JSON.parse(stringifiedChannel);
    }
  });
}

function flipInOurTeam(channel: ChatChannel): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const teamName: string = `croupierflips.snipe${snipe.snipeId}`;
  const subChannel: object = {
    membersType: "team", name: teamName, public: false, topicType: "chat",
  };
  bot.team.createSubteam(teamName).then((result) => {

    console.log("result for creating subteam", result);
    // invite all the participants - should probably throttle this.
    let usernamesToInvite: Array<object> = Object.keys(snipe.positionSizes).map((username) => {
      return {
        role: "reader",
        username,
      };
    });
    usernamesToInvite = usernamesToInvite.concat({
      role: "admin",
      username: "croupier",
    });
    bot.team.addMembers({
      team: teamName,
      usernames: usernamesToInvite,
    }).then((res) => {
      console.log("result for adding members", res);
      bot.chat.send(subChannel, {
        body: "/flip",
      });
    });
  });
  return snipe;
}

function getOriginChannel(channelName: string): ChatChannel {
  const channelMatch: Array<any> = channelName.match(/croupierflips.snipe(\d+)/);
  const snipeId: number = channelMatch[1];
  return getChannelFromSnipeId(snipeId);
}

const flipMonitorIntervals: object = {};

function monitorFlipResults(msg: MessageSummary): void {

  let snipe: ISnipe;
  let ourChannel: boolean;
  const channelMatch: Array<any> = msg.channel.name.match(/croupierflips.snipe(\d+)/);
  if (channelMatch === null) {
    snipe = activeSnipes[JSON.stringify(msg.channel)];
    ourChannel = false;
  } else {
    snipe = activeSnipes[JSON.stringify(getChannelFromSnipeId(channelMatch[1]))];
    ourChannel = true;
  }

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
          const winner: string = resolveFlip(msg.channel, flipDetails.resultInfo.number);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
          clearSnipe(msg.channel, winner);
          if (ourChannel) {
            // WISHLIST?: set Timeout to remove the team in ~15 minutes
          }
        } else {
          console.log("results are NOT in", flipDetails);
        }
      }).catch((err) => {
        if (snipe.reflipping) {
          return false;
        }

        snipe.reflipping = true;

        if (ourChannel) {
          // extract the name of the offender
          // remove the offender from the team
          // clear the interval
          // run the flip again
          bot.chat.getFlipData(msg.conversationId,
            msg.content.flip.flipConvId,
            msg.id,
            msg.content.flip.gameId).then((getFlipDataRes, stdout, stderr) => {
            console.log("getflipdata res!");
            console.log(getFlipDataRes);
            const errorInfo: object = JSON.parse(stdout).result.status.errorInfo;
            if (errorInfo.dupreg && errorInfo.dupreg.user) {
              bot.team.removeMember({
                team: msg.channel.name,
                username: errorInfo.dupreg.user,
              }).then((removeMemberRes) => {
                snipe.chatSend(`We have punted ${errorInfo.dupreg.user} for duplicate registration issues`);
                flip(getOriginChannel(msg.channel.name), msg.channel);
                clearInterval(flipMonitorIntervals[msg.conversationId]);
              });
            } else {
              flip(getOriginChannel(msg.channel.name), msg.channel);
              clearInterval(flipMonitorIntervals[msg.conversationId]);
            }
          });
        } else {
          let flipErrorMessage: string = "Due to error, we are going to re-cast the flip in a ";
          flipErrorMessage += "separate subteam over which we have governance and can kick anyone ";
          flipErrorMessage += "with a duplicate registration.";
          snipe.chatSend(flipErrorMessage);
          const teamName: string = `croupierflips.snipe${snipe.snipeId}`;
          const subChannel: object = {
            membersType: "team", name: teamName, public: false, topicType: "chat",
          };
          flip(msg.channel, subChannel);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
        }
      });
    } catch (err) {
      cancelFlip(msg.conversationId, msg.channel, err);
    }
  }), 1000);
}

function adjustBlinds(channel: ChatChannel): void {
  const now: number = +new Date();
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const secondsElapsed: number = Math.floor((now - snipe.betting_started) / 1000);
  const minutesElapsed: number = Math.floor(secondsElapsed / 60.0);
  let blinds: number;
  if (minutesElapsed < 10) {
    blinds = 0.01;
  } else {
    blinds = 0.01 * Math.pow(2, Math.floor((minutesElapsed - 10) / 5));
    // c.f. https://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-only-if-necessary
    blinds = Math.round((blinds + 0.00001) * 100) / 100; // scale to 2 dp
  }
  if (blinds !== snipe.blinds) {
    snipe.blinds = blinds;
    updateSnipeLog(channel);
    snipe.chatSend(`Blinds are raised to **${displayFixedNice(blinds)}XLM**`);
  }
}

const runningClocks: object = {};

function runClock(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const seconds: number = getTimeLeft(snipe);

  try {
    adjustBlinds(channel);
    // :hourglass: :hourglass_flowing_sand:
    if (seconds % 5 === 0) {

      let hourglass: string;
      const lastDigit: string = JSON.stringify(seconds).slice(-1);
      if (lastDigit === "5") {
        hourglass = ":hourglass:";
      } else {
        hourglass = ":hourglass_flowing_sand:";
      }

      let stopsWhen: string = moment().to(snipe.betting_stops);
      if (seconds < 55) {
        stopsWhen = `in ${seconds} seconds`;
      }
      console.log(`attempting to edit message ${snipe.clock} in channel ${channel}`);
      bot.chat.edit(channel, snipe.clock, {
        message: {
          body: hourglass + ` betting stops ${stopsWhen}`,
        },
      }).then((res) => {
        console.log(res);
      }).catch((e) => {
        console.log(e);
      });
    }
  } catch (e) {
    console.log("ran into error in runClock fxn, ", e);
    return;
  }

  if (seconds > 1) {
    setTimeout(() => {
      runClock(channel);
    }, 1000);
  } else {
    setTimeout(() => {
      bot.chat.delete(channel, snipe.clock, {});
    }, 1000);
  }
}

function buildPowerupsTable(channel: ChatChannel, whose: string): string {

  let table: string = "";
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  const powerupsCount: object = {};

  snipe.participants.forEach((bet: IParticipant) => {
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
  return table;
}

function checkTextForPowerup(msg: MessageSummary): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
  if (typeof(snipe) === "undefined") {
    return;
  }
  // would be better to have the regexp match object type
  const powerupsQuery: Array<any> = msg.content.text.body.match(/(.powerups|🐶|:dog:)\s?@?(\w+)?/);
  if (powerupsQuery !== null) {
    if (typeof(powerupsQuery[2]) !== "undefined") {
      const whose: string = powerupsQuery[1];
      if (snipe.positionSizes[whose] > 10) {
        snipe.positionSizes[whose] -= 10;
        const powerupsTable: string = buildPowerupsTable(msg.channel, whose);
        snipe.chatSend(`${powerupsTable}\nIt cost @${msg.sender.username} 10 position to scope @${whose} powerups`);
      }
    } else {
      const whose: string = msg.sender.username;
      if (snipe.positionSizes[whose] > 1) {
        snipe.positionSizes[whose] -= 1;
        const powerupsTable: string = buildPowerupsTable(msg.channel, whose);
        snipe.chatSend(`${powerupsTable}\nIt cost @${whose} 1 position to check their own powerups`);
      }
    }
    return;
  } else {
    snipe.participants.forEach((bet: IParticipant) => {
      if (msg.sender.username === bet.username) {
        if (bet.powerup && bet.powerup.usedAt === null) {
          if (msg.content.text.body.toLowerCase().indexOf(bet.powerup.award.reaction) !== -1
                || msg.content.text.body.indexOf(bet.powerup.award.emoji) !== -1) {
            consumePowerup(msg.channel, bet.powerup);
          }
        }
      }
    });
  }
}

function checkReactionForPowerup(msg: MessageSummary): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
  if (typeof(snipe) === "undefined") {
    return;
  }
  const reactionId: string = msg.id;
  const reaction: object = msg.content.reaction;

  console.log("Checking for powerup");
  console.log("msg.sender.username", msg.sender.username);

  snipe.participants.forEach((bet: IParticipant) => {
    if (msg.sender.username === bet.username) {
      if (bet.powerup && bet.powerup.usedAt === null) {
        console.log("reaction.b", reaction.b);
        console.log("bet powerup award reaction", bet.powerup.award.reaction);
        console.log("reaction.m", reaction.m);
        console.log("bet powerup reactionId", bet.powerup.reactionId);
        if (reaction.b === bet.powerup.award.reaction && reaction.m === bet.powerup.reactionId) {
          consumePowerup(msg.channel, bet.powerup);
        }
      }
    }
  });
}

function findPotLead(channel: ChatChannel): string {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const positionSizes: Array<IPositionSize> = snipe.positionSizes;
  return _.maxBy(_.keys(positionSizes), (username: string) => {
    return positionSizes[username];
  });
}

function consumePowerup(channel: ChatChannel, powerup: IPowerup): void {

  let sassyMessage: string;
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const consumer: string = snipe.participants[powerup.participantIndex].username;
  const leader: string = findPotLead(channel);
  powerup.usedAt = +new Date();
  let doNotResetClock: boolean = false;
  switch (powerup.award.name) {
    case "nuke":
      const unusedPowerupsLength: number = snipe.participants.filter((p) => {
        return p.powerup && typeof(p.powerup.usedAt) === "undefined";
      }).length;

      snipe.chatSend(`@${consumer} went nuclear.  Enjoy the show :fireworks:.`).then(() => {
        if (unusedPowerupsLength === 0) {
          snipe.chatSend(`...well, that was awkward. All that nuclear FUD, and for what?`);
        }
      });

      snipe.participants.forEach((participant) => {
        if (participant.powerup) {
          if (participant.powerup.usedAt === null) {
            consumePowerup(getChannelFromSnipeId(snipe.snipeId), participant.powerup);
          }
        }
      });
      break;
    case "freeze":

      sassyMessage = `@${consumer} played Freeze.  `;
      sassyMessage += `Any action by anyone other than ${consumer} or @croupier during `;
      sassyMessage += `the next 10 seconds will be ignored and instead increase ${consumer}'s `;
      sassyMessage += `position by 1.`;
      snipe.chatSend(sassyMessage);
      snipe.freeze = consumer;
      setTimeout(() => {
        snipe.chatSend(`@${consumer}'s freeze has expired!`);
        snipe.freeze = undefined;
      }, 1000 * 10);
      break;
    case "the-final-countdown":
      snipe.betting_stops = moment().add(60, "seconds");
      sassyMessage = `@${consumer} played The Final Countdown.  `;
      sassyMessage += `Will things ever be the same again?  60 seconds on the clock.  `;
      sassyMessage += `It's the final countdown.`;
      snipe.chatSend(sassyMessage);
      doNotResetClock = true;
      break;
    case "level-the-playing-field":
      Object.keys(snipe.positionSizes).forEach((username) => {
        snipe.positionSizes[username] = 1;
      });
      sassyMessage = `@${consumer} leveled the playing field in a big way.`;
      sassyMessage += `  Everyone's positions are now equal.  One love.`;
      snipe.chatSend(sassyMessage);
      break;
    case "half-life":  // Cut the remaining time in half
      const timeToSubtract: number = Math.floor(getTimeLeft(snipe) / 2.0);
      snipe.betting_stops = snipe.betting_stops.subtract(timeToSubtract, "seconds");
      snipe.chatSend(`@${consumer} chopped ${timeToSubtract} seconds off the clock.`);
      doNotResetClock = true;
      break;
    case "double-life": // Double the remaining time
      const timeToAdd: number = Math.floor(getTimeLeft(snipe));
      snipe.betting_stops = snipe.betting_stops.add(timeToAdd, "seconds");
      snipe.chatSend(`@${consumer} added ${timeToAdd} seconds to the clock.`);
      doNotResetClock = true;
      break;
    case "assassin": // Reduce the pot leader's position size to 1
      snipe.positionSizes[leader] = 1;
      sassyMessage = `@${consumer}'s :gun: seriously injured @${leader} and their position size is now 1.`;
      snipe.chatSend(sassyMessage);
      break;
    case "popularity-contest":
      if (consumer === leader) {
        snipe.chatSend(`You cannot challenge yourself in this game. ::powerup fizzles::`);
        return;
      }

      sassyMessage = `@${consumer} called a popularity contest to challenge @${leader}'s throne!`;
      sassyMessage +=  `  Whom do you prefer?  `;
      sassyMessage += `First to 3 votes wins `;
      sassyMessage += `(4 votes including the initial reaction seeded by me the Croupier)!`;
      bot.chat.send(channel, {
        body: sassyMessage,
      }).then((msgData) => {
        const challengerReaction: Promise<SendResult> = bot.chat.react(channel, msgData.id, `${consumer}`);
        const leaderReaction: Promise<SendResult> = bot.chat.react(channel, msgData.id, `${leader}`);
        Promise.all([challengerReaction, leaderReaction]).then((values) => {
          snipe.popularityContests.push({
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
        snipe.positionSizes[consumer] = 2 * snipe.positionSizes[consumer];
        sassyMessage = `A favorable day!  @${consumer}'s position size has doubled`;
        sassyMessage += ` to ${snipe.positionSizes[consumer]}`;
        snipe.chatSend(sassyMessage);
      } else {
        snipe.positionSizes[consumer] = Math.ceil(snipe.positionSizes[consumer] / 2);
        sassyMessage = `Ouch! @${consumer} cut their hand on the double edged sword`;
        sassyMessage += ` and is now dealing with ${snipe.positionSizes[consumer]}.`;
        snipe.chatSend(sassyMessage);
      }
      break;
    default:
      // nothing.
      break;
  }
  updateSnipeLog(channel);
  if (!doNotResetClock) {
    resetSnipeClock(channel);
  }
}

function checkForPopularityContestVote(msg: MessageSummary): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
  if (typeof(snipe) === "undefined" || typeof(snipe.popularityContests) === "undefined")  {
    return;
  }
  const reactionId: string = msg.id;
  const reaction: object = msg.content.reaction;
  snipe.popularityContests.forEach((contest) => {
    if (contest.pollMessageId === reaction.m) {
      if (reaction.b === contest.leader) {
        contest.votesForLeader.push(reactionId);
        checkForPopularityContestEnd(msg.channel, reaction.m);
      } else if (reaction.b === contest.challenger) {
        contest.votesForChallenger.push(reactionId);
        checkForPopularityContestEnd(msg.channel, reaction.m);
      }
    }
  });
}

function checkForPopularityContestVoteRemoval(msg: MessageSummary): void {
  let getIdx: number;
  const deleteReactionIds: Array<string> = msg.content.delete.messageIDs;
  // check for open popularity contests.
  const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
  if (typeof(snipe) === "undefined") {
    return;
  }
  snipe.popularityContests.forEach((contest, contestIdx) => {
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

function checkForPopularityContestEnd(channel: ChatChannel, pollMessageId: string): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  snipe.popularityContests.forEach((contest, contestIdx) => {

    if (contest.votesForChallenger.length >= 3) {
      const leaderPositionSize: number = snipe.positionSizes[contest.leader];
      const challengerPositionSize: number = snipe.positionSizes[contest.challenger];
      snipe.positionSizes[contest.leader] = challengerPositionSize;
      snipe.positionSizes[contest.challenger] = leaderPositionSize;
      const sassySwapMsg: string = `${contest.challenger} and ${contest.leader} have swapped position sizes!`;
      sassySwapMsg += `You can't buy your way to the top in this game!`;
      snipe.chatSend(sassySwapMsg);

      // TODO: could be dangerous to modify an array while looping over it?
      // mark the contest closed ...
      snipe.popularityContests.splice(contestIdx, 1);
    } else if (contest.votesForLeader.length >= 3) {
      snipe.positionSizes[contest.challenger] = 1;
      snipe.chatSend(`${contest.challenger} lost the popular vote and is punished.  Position size = 1.`);
      // mark the contest closed
      snipe.popularityContests.splice(contestIdx, 1);
    }

  });
}

function freeze(msg: MessageSummary): void {
  const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
  snipe.chatSend(`@${msg.sender.username}'s attempt was frozen and instead @${snipe.freeze}'s position increased +1`);
  snipe.positionSizes[snipe.freeze] += 1;
}

async function main(): Promise<any> {
  try {
    await bot.init(botUsername, paperkey);
    console.log(`Bot initialized with username ${botUsername}.`);
    await bot2.init(botUsername, paperkey2);
    console.log("Second key initialized");
    console.log("Listening for all messages...");

    const mkbotChannel: object = {
       membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat",
    };
    const message: object = {
      body: `${botUsername} was just restarted...[development mode] [use at own risk] [not functional]`,
    };

    bot.chat.send(mkbotChannel, message);

    activeSnipes = await loadActiveSnipes();

    console.log("here, the active snipes we found: ");
    console.log(activeSnipes);

    Object.keys(activeSnipes).forEach((chid) => {

      const snipeChannel: ChatChannel = JSON.parse(chid);
      activeSnipes[chid].chatSend("Croupier was restarted... Previous bets are still valid!");
      activeSnipes[chid].chatSend(buildBettingTable(calculatePotSize(snipeChannel), buildBettorRange(snipeChannel)));
      launchSnipe(snipeChannel);
    });

    await bot.chat.watchAllChannelsForNewMessages(
      async (msg) => {
        if (msg.channel.topicName !== "test3") {
          return;
        }
        try {
          const snipe: ISnipe = activeSnipes[JSON.stringify(msg.channel)];
          if (typeof(snipe) !== "undefined" &&
            snipe.freeze &&
            msg.sender.username !== snipe.freeze) {
            freeze(msg);
            return;
          }

          if (msg.content.type === "flip" && msg.sender.username === botUsername) {
            monitorFlipResults(msg);
            return;
          }
          if (msg.content.type === "text" && msg.content.text.body) {
            checkTextForPowerup(msg);
          }
          if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
            extractTxn(msg);
          }
          if (msg.content.type === "reaction") {
            checkForPopularityContestVote(msg);
            checkReactionForPowerup(msg);
          }
          if (msg.content.type === "delete") {
            checkForPopularityContestVoteRemoval(msg);
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
