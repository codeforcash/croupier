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

const powerups = [
  {
    name: 'nuke',
    description: `Go nuclear and play everyone's powerups in the order they were received`,
    reaction: ':radioactive_sign:',
    emoji: '☢️'
  },
  {
    name: 'freeze',
    description: 'For the next 10 seconds, powerups and bets are worthless and increase your position by 1',
    reaction: ':shaved_ice:',
    emoji: '🍧'
  },
  {
    name: 'the-final-countdown',
    description: `o/\` It's the final countdown!  Reset the clock to 1 minute`,
    reaction: ':man_dancing:',
    emoji: '🕺'
  },
  {
    name: 'level-the-playing-field',
    description: `Level the playing field and reset everybody's positions to 1`,
    reaction: ':rainbow-flag:',
    emoji: '🏳️‍🌈'
  },
  {
    name: 'popularity-contest',
    description: 'Put it to a vote: who does the group like more, you or the pot leader?  If the pot leader wins, your position is reduced to 1.  If you win, you and the pot leader swap position sizes!',
    reaction: ':dancers:',
    emoji: '👯'
  },
  {
    name: 'half-life',
    description: 'Cut the remaining time in half',
    reaction: ':hourglass:',
    emoji: '⌛'
  },
  {
    name: 'double-life',
    description: 'Double the remaining time',
    reaction: ':hourglass_flowing_sand:',
    emoji: '⏳'
  },
  {
    name: 'assassin',
    description: `Reduce the pot leader's position size to 1`,
    reaction: ':gun:',
    emoji: '🔫'
  },
  {
    name: 'double-edged-sword',
    description: 'Your position size has an even chance of doubling/halving',
    reaction: ':dagger_knife:',
    emoji: '🗡'
  }
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
  challenger: string,
  leader: string,
  pollMessageId: string,
  votesForChallenger: Array<string>,
  votesForLeader: Array<string>
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
}

interface IPositionSize {
  [key: string]: number;
}

function updateSnipeLog(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];
  const participants: string = JSON.stringify(snipe.participants);
  const positionSizes: string = JSON.stringify(snipe.positionSizes);
  const blinds: number = snipe.blinds;
  let snipeId = activeSnipes[JSON.stringify(channel)].snipeId;

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
    blinds=${connection.escape(blinds)};
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
function shouldIssuePowerup(channel: ChatChannel) {
  const snipe = activeSnipes[JSON.stringify(channel)];
  let count = snipe.participants.length;
  if (count>=3
      && snipe.participants[count-1].username === snipe.participants[count-2].username
      && snipe.participants[count-2].username === snipe.participants[count-3].username
    ) {


    let lastPowerupIndex = 0;
    snipe.participants.forEach((participant, idx) => {
      if(participant.powerup) {
        lastPowerupIndex = idx;
      }
    });
    if(((count-1) - lastPowerupIndex) >= 3) {
      return true;
    }
    else {
      return false;
    }
  }
  else {
    return false;
  }
}

function issuePowerup(channel: ChatChannel, participantIndex: number) {
  // let award = _.sample(powerups);
  let award = powerups[0];

  const snipe = activeSnipes[JSON.stringify(channel)];
  snipe.participants[participantIndex].powerup = {
    award: award,
    awardedAt: +new Date,
    usedAt: null,
    participantIndex: participantIndex,
    reactionId: null
  };


  let awardee = snipe.participants[participantIndex].username;
  snipe.chatSend(`Congrats @${awardee}, you won the **${award.name}** powerup.
    *${award.description}*
    Click the emoji to consume the powerup.`).then((msg) => {
      bot.chat.react(channel, msg.id, award.reaction);
      snipe.participants[participantIndex].powerup.reactionId = msg.id;
    });

}

function addSnipeParticipant(channel: ChatChannel, txn: Transaction, onBehalfOf?: string): void {

  const snipe = activeSnipes[JSON.stringify(channel)];
  let newParticipant;

  let betBeneficiary;

  if(typeof(onBehalfOf) === 'undefined') {
    newParticipant = {
      transaction: txn,
      username: txn.fromUsername,
    };
    betBeneficiary = txn.fromUsername;
  }
  else {
    newParticipant = {
      transaction: txn,
      username: txn.fromUsername,
      onBehalfOf: onBehalfOf
    };
    betBeneficiary = onBehalfOf;
  }

  snipe.participants.push(newParticipant);
  if(typeof(snipe.positionSizes[betBeneficiary]) === 'undefined') {
    snipe.positionSizes[betBeneficiary] = Math.floor(txn.amount / 0.01);
  } else {
    snipe.positionSizes[betBeneficiary] += Math.floor(txn.amount / 0.01);
  }


  if(shouldIssuePowerup(channel)) {
    issuePowerup(channel, snipe.participants.length - 1);
  }

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
  const snipe = activeSnipes[JSON.stringify(channel)];
  const bettorRange: object = {};
  let start: number = 0;

  Object.keys(snipe.positionSizes).sort((a,b) => {
    return snipe.positionSizes[a] > snipe.positionSizes[b] ? -1 : 1;
  }).forEach((username) => {
    bettorRange[username] = [start + 1, start + snipe.positionSizes[username]];
    start += snipe.positionSizes[username];
  });
  return bettorRange;
}

function displayFixedNice(a: number): string {
  let aFormatted = a.toFixed(2).toString();
  if(aFormatted.slice(-2,aFormatted.length) === "00") {
    aFormatted = parseInt(aFormatted,10).toString();
  }
  return aFormatted;
}

function buildBettingTable(potSize: number, bettorRange: object): string {

  console.log('within BuildBettingTable, bettorRange:', bettorRange);

  let maxValue = Math.max(..._.flatten(Object.values(bettorRange)));

  let bettingTable = `Pot size: ${displayFixedNice(potSize)}XLM\n`;

  let bettorRank = 1;

  Object.keys(bettorRange).forEach((username) => {

    let chancePct = 100 * ( (1+(bettorRange[username][1] - bettorRange[username][0])) / maxValue);

    bettingTable += `\n${bettorRank}. @${username}: \``;
    bettorRank += 1;
    if(bettorRange[username][0] === bettorRange[username][1]) {
      bettingTable += `${bettorRange[username][0]}\``;
    }
    else {
      bettingTable += `${bettorRange[username][0].toLocaleString()} - ${bettorRange[username][1].toLocaleString()}\``
    }
    bettingTable += ` (${displayFixedNice(chancePct)}% chance)`;
  });

  return bettingTable;

};

function makeSubteamForFlip(channel: ChatChannel) {

  const snipe = activeSnipes[JSON.stringify(channel)];
  const subteamName = `croupierflips.snipe${snipe.snipeId}`;

  let usernamesToAdd = [{"username": "croupier", "role": "admin"}];
  Object.keys(snipe.positionSizes).forEach(username => {
    usernamesToAdd.push({
      "username": username,
      "role": "reader"
    });
  });
  bot.team.createSubteam(subteamName).then(res => {
    bot.team.addMembers({
      "team": subteamName,
      "usernames": usernamesToAdd
    }).then(res => {
      const newSubteam: ChatChannel = {
        membersType: "team", name: subteamName,
      };
      flip(channel, newSubteam);
    });
  });

}


function flip(channel: ChatChannel, whereToFlip: ChatChannel): void {

  if(typeof(whereToFlip) === 'undefined') {
    whereToFlip = channel;
  }

  const bettorRange: object = buildBettorRange(channel);
  const bettingValues: Array<Array<number>> = Object.values(bettorRange);
  const flatBettingValues: Array<number> = _.flatten(bettingValues);
  const minBet: number = flatBettingValues.reduce((a, b) => Math.min(a, b));
  const maxBet: number = flatBettingValues.reduce((a, b) => Math.max(a, b));

  let bettingTable: string = buildBettingTable(calculatePotSize(channel), bettorRange);

  bot2.chat.send(whereToFlip, {
    body: '**Final betting table...**'
  });
  bot2.chat.send(whereToFlip, {
    body: bettingTable,
  });
  bot2.chat.send(whereToFlip, {
    body: `/flip ${minBet}..${maxBet}`,
  }).then((res) => {
    const snipe = activeSnipes[JSON.stringify(channel)];
    snipe.reflipping = false;
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

function processNewBet(txn: Transaction, msg: MessageSummary): Promise<boolean> {

  const channel = msg.channel;
  const onBehalfOfMatch = msg.content.text.body.match(/(for|4):\s?@?(\w+)/i);
  const snipe = activeSnipes[JSON.stringify(channel)];

  return new Promise(resolve => {

    if (onBehalfOfMatch !== null) {
      const onBehalfOfRecipient = onBehalfOfMatch[2];

      // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
      // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
      // new wallets
      checkWalletBalance(onBehalfOfRecipient).then((balance) => {
        if (balance === null || balance < 2.01) {
          snipe.chatSend('Betting on behalf of someone else?  Seems like they do not have a wallet yet, so your bet must be at least 2.01XLM');
          processRefund(txn, msg.channel);
          resolve(false);
        }
        else if (typeof(snipe.positionSizes[txn.fromUsername]) === 'undefined') {
          snipe.chatSend('You cannot bet on behalf of someone else unless you are participating as well');
          resolve(false);
        }
        else {
          addSnipeParticipant(channel, txn, onBehalfOfRecipient);
          snipe.chatSend(`@${onBehalfOfRecipient} is locked into the snipe, thanks to @${txn.fromUsername}!`);
          bot.chat.react(channel, msg.id, ':gift:');
          resolve(true);
        }
      });
    }
    else {
      addSnipeParticipant(channel, txn, undefined);
      snipe.chatSend(`@${txn.fromUsername} is locked into the snipe!`);
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

  let blinds;
  if(typeof(snipe)==="undefined") {
    blinds = 0.01;
  }
  else {
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
      betting_started: +new Date,
      clock: null,
      participants: [],
      timeout: null,
      countdown: countdown,
      reFlips: 3,
      positionSizes: {},
      blinds: 0.01,
      popularityContests: [],
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

    processNewBet(txn, msg).then((betProcessed) => {
      if(betProcessed) {
        resetSnipeClock(channel);
      }
    });

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


function getTimeLeft(snipe: ISnipe): number {
  return Math.ceil(Math.abs(moment.duration(snipe.betting_stops.diff(moment())).asSeconds()));
}


function resetSnipeClock(channel: ChatChannel): void {

  const snipe: ISnipe = activeSnipes[JSON.stringify(channel)];

  if(snipe.bettingTable) {
    bot.chat.delete(channel, snipe.bettingTable, {}).then(() => {
      snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then((msg) => {
        snipe.bettingTable = msg.id;
      });
    });
  }
  else {
    snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then((msg) => {
      snipe.bettingTable = msg.id;
    });
  }


  let timeRemaining: number = Math.ceil(getTimeLeft(snipe));

  console.log('time remaining', timeRemaining);
  clearTimeout(snipe.timeout);

  let boost, timerEndsInSeconds;
  if (timeRemaining <= 30) {
    timerEndsInSeconds = 60;
  } else {
    boost = 10;
    timerEndsInSeconds = timeRemaining + boost;
  }

  snipe.betting_stops = moment().add(timerEndsInSeconds, 'seconds');

  bot.chat.delete(channel, snipe.clock, {});
  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
    console.log('just sent the parent betting stops message in resetSnipeClock');
    console.log('sentMessage', sentMessage);
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
          betting_started: result.betting_started,
          betting_open: true,
          clock: null,
          participants: JSON.parse(result.participants),
          timeout: null,
          countdown: result.countdown,
          positionSizes: JSON.parse(result.position_sizes),
          blinds: result.blinds,
          popularityContests: [],
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
  message += `Minimum bet: ${snipe.blinds}XLM`;


  snipe.chatSend(message);

  snipe.betting_stops = moment().add(snipe.countdown, 'seconds');

  snipe.chatSend(`Betting stops ${moment().to(snipe.betting_stops)}`).then((sentMessage) => {
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
      let feeSum: number = fees.reduce((a, b) => parseFloat(a.toString()) + parseFloat(b.toString()));
      console.log('feeSum', feeSum);
      let wagerSum: number = bets[participant].wagers.reduce((a, b) => parseFloat(a.toString()) + parseFloat(b.toString()));
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
      flip(channel, channel);
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

function getChannelFromSnipeId(snipeId: number): ChatChannel {
  Object.keys(activeSnipes).forEach((stringifiedChannel) => {
    if(activeSnipes[stringifiedChannel].snipeId === snipeId) {
      return JSON.parse(stringifiedChannel);
    }
  });
}

function flipInOurTeam(channel: ChatChannel) {

  const snipe = activeSnipes[JSON.stringify(channel)];
  const teamName = `croupierflips.snipe${snipe.snipeId}`;
  const subChannel: object = {
    membersType: "team", name: teamName, public: false, topicType: "chat",
  };
  bot.team.createSubteam(teamName).then((result) => {


    console.log('result for creating subteam', result);
    // invite all the participants - should probably throttle this.
    let usernamesToInvite = Object.keys(snipe.positionSizes).map((username) => {
      return {
        "username": username,
        "role": "reader"
      }
    });
    usernamesToInvite = usernamesToInvite.concat({
      "username": "croupier",
      "role": "admin"
    });
    bot.team.addMembers({
      "team": teamName,
      "usernames": usernamesToInvite
    }).then((res) => {
      console.log('result for adding members', res);
        bot.chat.send(subChannel, {
          body: '/flip'
        });
    });

  });

  return snipe;

}


function getOriginChannel(channelName): ChatChannel {
  let channelMatch = channelName.match(/croupierflips.snipe(\d+)/);
  let snipeId = channelMatch[1];
  return getChannelFromSnipeId(snipeId);
}

const flipMonitorIntervals: object = {};

function monitorFlipResults(msg: MessageSummary): void {

  let snipe, ourChannel;
  let channelMatch = msg.channel.name.match(/croupierflips.snipe(\d+)/);
  if(channelMatch === null) {
    snipe = activeSnipes[JSON.stringify(msg.channel)];
    ourChannel = false;
  }
  else {
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
          let winner = resolveFlip(msg.channel, flipDetails.resultInfo.number);
          clearInterval(flipMonitorIntervals[msg.conversationId]);
          clearSnipe(msg.channel, winner);
          if(ourChannel) {
            // WISHLIST?: set Timeout to remove the team in ~15 minutes
          }
        } else {
          console.log("results are NOT in", flipDetails);
        }
      }).catch((err) => {

        if(snipe.reflipping) {
          return false;
        }

        snipe.reflipping = true;

        if(ourChannel) {
          // extract the name of the offender
          // remove the offender from the team
          // clear the interval
          // run the flip again
          bot.chat.getFlipData(msg.conversationId,
            msg.content.flip.flipConvId,
            msg.id,
            msg.content.flip.gameId).then((res, stdout, stderr) => {
            console.log('getflipdata res!');
            console.log(res);
            let errorInfo = JSON.parse(stdout).result.status.errorInfo;
            if (errorInfo.dupreg && errorInfo.dupreg.user) {
              bot.team.removeMember({
                team: msg.channel.name,
                username: errorInfo.dupreg.user
              }).then(res => {
                snipe.chatSend(`We have punted ${errorInfo.dupreg.user} for duplicate registration issues`);
                flip(getOriginChannel(msg.channel.name), msg.channel)
                clearInterval(flipMonitorIntervals[msg.conversationId]);
              });
            } else {
              flip(getOriginChannel(msg.channel.name), msg.channel)
              clearInterval(flipMonitorIntervals[msg.conversationId]);
            }
          });
        } else {
          snipe.chatSend('Due to error, we are going to re-cast the flip in a separate subteam over which we have governance and can kick anyone with a duplicate registration.');
          let teamName = `croupierflips.snipe${snipe.snipeId}`;
          let subChannel: object = {
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


function adjustBlinds(channel: ChatChannel) {
  let now = +new Date;
  const snipe = activeSnipes[JSON.stringify(channel)];
  let secondsElapsed = Math.floor((now - snipe.betting_started)/1000);
  let minutesElapsed = Math.floor(secondsElapsed / 60.0);
  let blinds;
  if(minutesElapsed < 10) {
    blinds = 0.01;
  } else {
    blinds = 0.01 * Math.pow(2, Math.floor((minutesElapsed - 10) / 5));
  }
  if(blinds !== snipe.blinds) {
    snipe.blinds = blinds;
    updateSnipeLog(channel);
    snipe.chatSend(`Blinds are raised to **${blinds}**`);
  }

}



const runningClocks: object = {};

function runClock(channel: ChatChannel): void {

  const snipe = activeSnipes[JSON.stringify(channel)];
  const seconds = getTimeLeft(snipe);
  console.log(`according to runClock, the timeLeft is ${seconds}`);

  try {

    adjustBlinds(channel);

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


      console.log(`attempting to edit message ${snipe.clock} in channel ${channel}`);
      bot.chat.edit(channel, snipe.clock, {
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

    console.log('ran into error in runClock fxn, ', e);
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

  let table = '';
  const snipe = activeSnipes[JSON.stringify(channel)];

  let powerupsCount = {};

  snipe.participants.forEach((bet: IParticipant) => {
    if (bet.powerup && bet.powerup.usedAt === null && bet.username === whose) {
      let award = JSON.stringify(bet.powerup.award);
      if(typeof(powerupsCount[award]) === 'undefined') {
        powerupsCount[award] = 0;
      }
      powerupsCount[award] += 1;
    }
  });

  Object.keys(powerupsCount).forEach((awardJsonified) => {
    let award = JSON.parse(awardJsonified);
    table += `${powerupsCount[awardJsonified]}x ${award.emoji} **${award.name}**: ${award.description}\n`;
  });
  return table;
}


function checkTextForPowerup(msg: MessageSummary) {
  const snipe = activeSnipes[JSON.stringify(msg.channel)];
  if(typeof(snipe) === 'undefined') {
    return;
  }

  let powerupsQuery = msg.content.text.body.match(/(.powerups|🐶)\s?@?(\w+)?/);
  if (powerupsQuery!==null) {
    if (typeof(powerupsQuery[2]) !== 'undefined') {
      let whose = powerupsQuery[1];
      if (snipe.positionSizes[whose] > 10) {
        snipe.positionSizes[whose] -= 10;
        let str = buildPowerupsTable(msg.channel, whose);
        snipe.sendChat(`${str}\nIt cost @${msg.sender.username} 10 position to scope @${whose} powerups`);
      }
    }
    else {
      let whose = msg.sender.username;
      if (snipe.positionSizes[whose] > 1) {
        snipe.positionSizes[whose] -= 1;
        let str = buildPowerupsTable(msg.channel, whose);
        snipe.sendChat(`${str}\nIt cost @${whose} 1 position to check their own powerups`);
      }
    }
    return;
  }
  else {
    snipe.participants.forEach((bet: IParticipant) => {
      if (msg.sender.username === bet.username) {
        if (bet.powerup && bet.powerup.usedAt===null) {
          if (msg.content.text.body.toLowerCase().indexOf(bet.powerup.award.reaction) !==-1
                || msg.content.text.body.indexOf(bet.powerup.award.emoji) !== -1) {
            consumePowerup(msg.channel, bet.powerup);
          }
        }
      }
    });
  }
};


function checkReactionForPowerup(msg: MessageSummary) {
  const snipe = activeSnipes[JSON.stringify(msg.channel)];
  if(typeof(snipe) === 'undefined') {
    return;
  }
  const reactionId = msg.id;
  const reaction = msg.content.reaction;

  console.log('Checking for powerup');
  console.log('msg.sender.username', msg.sender.username);

  snipe.participants.forEach((bet: IParticipant) => {
    if(msg.sender.username === bet.username) {
      if(bet.powerup && bet.powerup.usedAt===null) {
        console.log('reaction.b', reaction.b);
        console.log('bet powerup award reaction', bet.powerup.award.reaction);
        console.log('reaction.m', reaction.m);
        console.log('bet powerup reactionId', bet.powerup.reactionId);
        if(reaction.b === bet.powerup.award.reaction && reaction.m === bet.powerup.reactionId)  {
          consumePowerup(msg.channel, bet.powerup);
        }
      }
    }
  });
}


function findPotLead(channel: ChatChannel) {
  const snipe = activeSnipes[JSON.stringify(channel)];
  let obj = snipe.positionSizes;
  return _.maxBy(_.keys(obj), function (o) { return obj[o]; });
}


function consumePowerup(channel: ChatChannel, powerup: IPowerup) {
  const snipe = activeSnipes[JSON.stringify(channel)];
  let consumer: string = snipe.participants[powerup.participantIndex].username;
  let leader = findPotLead(channel);
  powerup.usedAt = +new Date;
  switch(powerup.award.name) {
    case 'nuke':

      let unusedPowerups = snipe.participants.filter((p) => p.powerup && typeof(p.powerup.usedAt)==='undefined');

      snipe.sendChat(`@${consumer} went nuclear.  Enjoy the show :fireworks:.`);
      if(unusedPowerups.length === 0) {
        snipe.sendChat(`...well, that was awkward. All that nuclear FUD, and for what?`);
      }
      snipe.participants.forEach((participant) => {
        if(participant.powerup) {
          let powerup = participant.powerup;
          if(typeof(powerup.usedAt)==='undefined') {
            consumePowerup(getChannelFromSnipeId(snipe.snipeId), powerup);
          }
        }
      });
      break;
    case 'freeze':
      snipe.sendChat(`@${consumer} played Freeze.  Any action by anyone other than ${consumer} or @croupier during the next 10 seconds will be ignored and instead increase ${consumer}'s position by 1.`);
      snipe.freeze = consumer;
      setTimeout(() => {
        snipe.sendChat(`@${consumer}'s freeze has expired!`);
        snipe.freeze = undefined;
      }, 1000 * 10);
      break;
    case 'the-final-countdown':
      snipe.betting_stops = moment().add(60, 'seconds');
      snipe.sendChat(`@${consumer} played The Final Countdown.  Will things ever be the same again?  60 seconds on the clock.   It's the final countdown.`);
      break;
    case 'level-the-playing-field':
      Object.keys(snipe.positionSizes).forEach((username) => {
        snipe.positionSizes[username] = 1;
      });
      snipe.sendChat(`@${consumer} leveled the playing field in a big way.  Everyone's positions are now equal.  One love.`);
      break;
    case 'half-life':  // Cut the remaining time in half
      let timeToSubtract: number = Math.floor(getTimeLeft(snipe) / 2.0);
      snipe.betting_stops = snipe.betting_stops.subtract(timeToSubtract, 'seconds');
      snipe.sendChat(`@${consumer} chopped ${timeToSubtract} seconds off the clock.`);
      break;
    case 'double-life': // Double the remaining time
      let timeToAdd: number = Math.floor(getTimeLeft(snipe));
      snipe.betting_stops = snipe.betting_stops.add(timeToAdd, 'seconds');
      snipe.sendChat(`@${consumer} added ${timeToAdd} seconds to the clock.`);
      break;
    case 'assassin': // Reduce the pot leader's position size to 1
      snipe.positionSizes[leader] = 1;
      snipe.chatSend(`@${consumer}'s :gun: seriously injured @${leader} and their position size is now 1.`)
      break;
    case 'popularity-contest': // Put it to a vote: who does the group like more, you or the pot leader?  If the pot leader wins, your position is reduced to 1.  If you win, you and the pot leader swap position sizes!
      if(consumer === leader) {
        snipe.chatSend(`You cannot challenge yourself in this game. ::powerup fizzles::`);
        return;
      }
      bot.chat.send(channel, {
        body: `@${consumer} called a popularity contest to challenge @${leader}'s throne!  Whom do you prefer?  First to 3 votes wins (4 votes including the initial reaction seeded by me the Croupier)!`
      }).then((msgData) => {
        let challengerReaction = bot.chat.react(channel, msgData.id, `${consumer}`);
        let leaderReaction = bot.chat.react(channel, msgData.id, `${leader}`);
        Promise.all([challengerReaction, leaderReaction]).then((values) => {
          snipe.popularityContests.push({
            challenger: consumer,
            leader: leader,
            pollMessageId: msgData.id,
            votesForChallenger: [],
            votesForLeader: []
          });
        });
      });
      break;
    case 'double-edged-sword': // Even chance of halving or doubling one's position size
      if(Math.random() >= 0.5) {
        snipe.positionSizes[consumer] = 2 * snipe.positionSizes[consumer];
        snipe.chatSend(`A favorable day!  @${consumer}'s position size has doubled to ${snipe.positionSizes[consumer]}`);
      }
      else {
        snipe.positionSizes[consumer] = Math.ceil(snipe.positionSizes[consumer] / 2);
        snipe.chatSend(`Ouch! @${consumer} cut their hand on the double edged sword and is now dealing with ${snipe.positionSizes[consumer]}.`);
      }
      break;
    default:
      // nothing.
      break;
  }
  updateSnipeLog(channel);
  resetSnipeClock(channel);
}

function checkForPopularityContestVote(msg: MessageSummary) {
  const snipe = activeSnipes[JSON.stringify(msg.channel)];
  if(typeof(snipe) === 'undefined' || typeof(snipe.popularityContests) === 'undefined')  {
    return;
  }
  const reactionId = msg.id;
  const reaction = msg.content.reaction;
  snipe.popularityContests.forEach((contest) => {
    if(contest.pollMessageId === reaction.m) {
      if(reaction.b === contest.leader) {
        contest.votesForLeader.push(reactionId);
        checkForPopularityContestEnd(msg.channel, reaction.m);
      }
      else if(reaction.b === contest.challenger) {
        contest.votesForChallenger.push(reactionId);
        checkForPopularityContestEnd(msg.channel, reaction.m);
      }
    }
  });
}

function checkForPopularityContestVoteRemoval(msg: MessageSummary) {
  let getIdx;
  let deleteReactionIds = msg.content.delete.messageIDs;
  // check for open popularity contests.
  const snipe = activeSnipes[JSON.stringify(msg.channel)];
  snipe.popularityContests.forEach((contest, contestIdx) => {
    deleteReactionIds.forEach(reactionToDeleteId => {
      getIdx = contest.votesForLeader.indexOf(reactionToDeleteId);
      if(getIdx !== -1) {
        contest.votesForLeader.splice(getIdx, 1);
      }
      getIdx = contest.votesForChallenger.indexOf(reactionToDeleteId);
      if(getIdx !== -1) {
        contest.votesForChallenger.splice(getIdx, 1);
      }
    });

  });

};

function checkForPopularityContestEnd(channel: ChatChannel, pollMessageId: string) {
  const snipe = activeSnipes[JSON.stringify(channel)];
  snipe.popularityContests.forEach((contest, contestIdx) => {

    if (contest.votesForChallenger.length >= 3) {
      let leaderPositionSize = snipe.positionSizes[contest.leader];
      let challengerPositionSize = snipe.positionSizes[contest.challenger];
      snipe.positionSizes[contest.leader] = challengerPositionSize;
      snipe.positionSizes[contest.challenger] = leaderPositionSize;
      snipe.sendChat(`${contest.challenger} and ${contest.leader} have swapped position sizes! You can't buy your way to the top in this game!`)

      // TODO: could be dangerous to modify an array while looping over it?
      // mark the contest closed ...
      snipe.popularityContests.splice(contestIdx, 1);
    }
    else if(contest.votesForLeader.length >= 3) {
      snipe.positionSizes[contest.challenger] = 1;
      snipe.sendChat(`${contest.challenger} lost the popular vote and is punished.  Position size = 1.`)
      // mark the contest closed
      snipe.popularityContests.splice(contestIdx, 1);
    }

  });
}

function freeze(msg: MessageSummary): void {
  const snipe = activeSnipes[JSON.stringify(msg.channel)];
  snipe.sendChat(`@${msg.sender.username}'s attempt was frozen and instead @${snipe.freeze}'s position increased +1`);
  snipe.positionSizes[snipe.freeze] += 1;
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

          let snipe = activeSnipes[JSON.stringify(msg.channel)];
          if (typeof(snipe)!=='undefined' && snipe.freeze && msg.sender.username !== snipe.freeze) {
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
