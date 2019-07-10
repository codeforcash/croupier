"use strict";
// tsc --lib es2015 index.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
var _ = require("lodash");
var mysql = require("mysql");
var moment = require("moment");
var os = require("os");
var Bot = require("./keybase-bot");
var throttledQueue = require("throttled-queue");
require("source-map-support/register");
var bot = new Bot(os.homedir());
var bot2 = new Bot(os.homedir());
var botUsername = "croupier";
var paperkey = process.env.CROUPIER_PAPERKEY_1;
var paperkey2 = process.env.CROUPIER_PAPERKEY_2;
var activeSnipes;
var powerups = [
    {
        name: 'nuke',
        description: "Go nuclear and play everyone's powerups in the order they were received",
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
        description: "o/` It's the final countdown!  Reset the clock to 1 minute",
        reaction: ':man_dancing:',
        emoji: '🕺'
    },
    {
        name: 'level-the-playing-field',
        description: "Level the playing field and reset everybody's positions to 1",
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
        description: "Reduce the pot leader's position size to 1",
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
function updateSnipeLog(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var participants = JSON.stringify(snipe.participants);
    var positionSizes = JSON.stringify(snipe.positionSizes);
    var blinds = snipe.blinds;
    var snipeId = activeSnipes[JSON.stringify(channel)].snipeId;
    var connection = mysql.createConnection({
        database: process.env.MYSQL_DB,
        host: process.env.MYSQL_HOST,
        password: process.env.MYSQL_PASSWORD,
        user: process.env.MYSQL_USER
    });
    connection.connect();
    connection.query("\n    UPDATE snipes SET\n    participants=" + connection.escape(participants) + ",\n    position_sizes=" + connection.escape(positionSizes) + ",\n    blinds=" + connection.escape(blinds) + ";\n    WHERE\n    id=" + connection.escape(snipeId), function (error, results, fields) {
        if (error) {
            console.log(error);
        }
    });
    connection.end();
}
// If the same person made 3 bets in a row, issue a powerup
// but not if they have recently been issued a powerup
function shouldIssuePowerup(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var count = snipe.participants.length;
    if (count >= 3
        && snipe.participants[count - 1].username === snipe.participants[count - 2].username
        && snipe.participants[count - 2].username === snipe.participants[count - 3].username) {
        var lastPowerupIndex_1 = 0;
        snipe.participants.forEach(function (participant, idx) {
            if (participant.powerup) {
                lastPowerupIndex_1 = idx;
            }
        });
        if (((count - 1) - lastPowerupIndex_1) >= 3) {
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
function issuePowerup(channel, participantIndex) {
    // let award = _.sample(powerups);
    var award = powerups[0];
    var snipe = activeSnipes[JSON.stringify(channel)];
    snipe.participants[participantIndex].powerup = {
        award: award,
        awardedAt: +new Date,
        usedAt: null,
        participantIndex: participantIndex,
        reactionId: null
    };
    var awardee = snipe.participants[participantIndex].username;
    snipe.chatSend("Congrats @" + awardee + ", you won the **" + award.name + "** powerup.\n    *" + award.description + "*\n    Click the emoji to consume the powerup.").then(function (msg) {
        bot.chat.react(channel, msg.id, award.reaction);
        snipe.participants[participantIndex].powerup.reactionId = msg.id;
    });
}
function addSnipeParticipant(channel, txn, onBehalfOf) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var newParticipant;
    var betBeneficiary;
    if (typeof (onBehalfOf) === 'undefined') {
        newParticipant = {
            transaction: txn,
            username: txn.fromUsername
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
    if (typeof (snipe.positionSizes[betBeneficiary]) === 'undefined') {
        snipe.positionSizes[betBeneficiary] = Math.floor(txn.amount / 0.01);
    }
    else {
        snipe.positionSizes[betBeneficiary] += Math.floor(txn.amount / 0.01);
    }
    if (shouldIssuePowerup(channel)) {
        issuePowerup(channel, snipe.participants.length - 1);
    }
    updateSnipeLog(channel);
}
function logNewSnipe(channel) {
    return new Promise(function (resolve) {
        var snipe = activeSnipes[JSON.stringify(channel)];
        var connection = mysql.createConnection({
            database: process.env.MYSQL_DB,
            host: process.env.MYSQL_HOST,
            password: process.env.MYSQL_PASSWORD,
            user: process.env.MYSQL_USER
        });
        connection.connect();
        connection.query("INSERT INTO snipes\n      (channel, countdown, betting_started)\n      VALUES\n      (" + connection.escape(JSON.stringify(channel)) + ",\n      " + connection.escape(snipe.countdown) + ",\n      " + connection.escape(snipe.betting_started) + "\n      )", function (error, results, fields) {
            if (error) {
                console.log(error);
            }
            resolve(results.insertId);
        });
        connection.end();
    });
}
function documentSnipe(channel, reason) {
    var snipeId = activeSnipes[JSON.stringify(channel)].snipeId;
    var was_cancelled, winner, cancellation_reason;
    var connection = mysql.createConnection({
        database: process.env.MYSQL_DB,
        host: process.env.MYSQL_HOST,
        password: process.env.MYSQL_PASSWORD,
        user: process.env.MYSQL_USER
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
    connection.query("UPDATE snipes\n    SET\n      winner=" + connection.escape(winner) + ",\n      was_cancelled=" + connection.escape(was_cancelled) + ",\n      cancellation_reason=" + connection.escape(cancellation_reason) + ",\n      in_progress=0\n    WHERE\n      id=" + connection.escape(snipeId) + "\n    ", function (error, results, fields) {
        if (error) {
            console.log(error);
        }
    });
    connection.end();
}
function calculateTransactionFees(txn) {
    return new Promise(function (resolve) {
        bot.wallet.details(txn.txId).then(function (details) {
            var xlmFeeMatch = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
            if (xlmFeeMatch !== null) {
                var fee = parseFloat(xlmFeeMatch[1]);
                console.log('fee', fee);
                resolve(fee);
            }
        });
    });
}
function processRefund(txn, channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    console.log("refunding txn", txn);
    calculateTransactionFees(txn).then(function (transactionFees) {
        console.log("not refunding txn fees", transactionFees);
        var refund = _.round(txn.amount - transactionFees, 7);
        console.log("total refund is", refund);
        snipe.moneySend(refund, txn.fromUsername);
    });
}
function clearSnipe(channel, reason) {
    documentSnipe(channel, reason);
    activeSnipes[JSON.stringify(channel)] = undefined;
}
function extractTxn(msg) {
    var txnId = msg.content.text.payments[0].result.sent;
    bot.wallet.details(txnId).then(function (details) { return processTxnDetails(details, msg); });
}
function sendAmountToWinner(winnerUsername, channel) {
    var bounty;
    var snipe = activeSnipes[JSON.stringify(channel)];
    bounty = 0;
    var transactionFeePromises = [];
    snipe.participants.forEach(function (participant) {
        bounty += parseFloat(participant.transaction.amount);
        transactionFeePromises.push(calculateTransactionFees(participant.transaction));
    });
    Promise.all(transactionFeePromises).then(function (values) {
        values.forEach(function (val) {
            bounty -= val;
        });
        bounty = _.round(bounty, 7);
        console.log("now rounded", bounty);
        //  If winnerUsername is a participant in this chat, moneySend
        //  Otherwise, use stellar.expert.xlm method
        bot.team.listTeamMemberships({
            team: channel.name
        }).then(function (res) {
            var allMembers = [];
            allMembers = allMembers.concat(res.members.owners.map(function (u) { return u.username; }));
            allMembers = allMembers.concat(res.members.admins.map(function (u) { return u.username; }));
            allMembers = allMembers.concat(res.members.writers.map(function (u) { return u.username; }));
            allMembers = allMembers.concat(res.members.readers.map(function (u) { return u.username; }));
            // it's possible the winner is not in the chat, that they won through a onBehalfOf contribution of someone else
            if (allMembers.indexOf(winnerUsername) === -1) {
                bot.wallet.send(winnerUsername, bounty.toString()).then(function (txn) {
                    var bountyMsg = "`+" + bounty + "XLM@" + winnerUsername + "` ";
                    bountyMsg += ":arrow_right: ";
                    bountyMsg += "https://stellar.expert/explorer/public/tx/" + txn.txId;
                    snipe.chatSend(bountyMsg);
                });
            }
            else {
                snipe.moneySend(bounty, winnerUsername);
            }
        });
    });
}
function resolveFlip(channel, winningNumber) {
    var winnerUsername;
    var bettorRange = buildBettorRange(channel);
    Object.keys(bettorRange).forEach(function (username) {
        if (bettorRange[username][0] <= winningNumber && bettorRange[username][1] >= winningNumber) {
            winnerUsername = username;
        }
    });
    sendAmountToWinner(winnerUsername, channel);
    var snipe = activeSnipes[JSON.stringify(channel)];
    snipe.chatSend("Congrats to @" + winnerUsername);
    return winnerUsername;
}
function buildBettorRange(channel) {
    var bettorMap = {};
    var snipe = activeSnipes[JSON.stringify(channel)];
    var bettorRange = {};
    var start = 0;
    Object.keys(snipe.positionSizes).sort(function (a, b) {
        return snipe.positionSizes[a] > snipe.positionSizes[b] ? -1 : 1;
    }).forEach(function (username) {
        bettorRange[username] = [start + 1, start + snipe.positionSizes[username]];
        start += snipe.positionSizes[username];
    });
    return bettorRange;
}
function displayFixedNice(a) {
    var aFormatted = a.toFixed(2).toString();
    if (aFormatted.slice(-2, aFormatted.length) === "00") {
        aFormatted = parseInt(aFormatted, 10).toString();
    }
    return aFormatted;
}
function buildBettingTable(potSize, bettorRange) {
    console.log('within BuildBettingTable, bettorRange:', bettorRange);
    var maxValue = Math.max.apply(Math, _.flatten(Object.values(bettorRange)));
    var bettingTable = "Pot size: " + displayFixedNice(potSize) + "XLM\n";
    var bettorRank = 1;
    Object.keys(bettorRange).forEach(function (username) {
        var chancePct = 100 * ((1 + (bettorRange[username][1] - bettorRange[username][0])) / maxValue);
        bettingTable += "\n" + bettorRank + ". @" + username + ": `";
        bettorRank += 1;
        if (bettorRange[username][0] === bettorRange[username][1]) {
            bettingTable += bettorRange[username][0] + "`";
        }
        else {
            bettingTable += bettorRange[username][0].toLocaleString() + " - " + bettorRange[username][1].toLocaleString() + "`";
        }
        bettingTable += " (" + displayFixedNice(chancePct) + "% chance)";
    });
    return bettingTable;
}
;
function makeSubteamForFlip(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var subteamName = "croupierflips.snipe" + snipe.snipeId;
    var usernamesToAdd = [{ "username": "croupier", "role": "admin" }];
    Object.keys(snipe.positionSizes).forEach(function (username) {
        usernamesToAdd.push({
            "username": username,
            "role": "reader"
        });
    });
    bot.team.createSubteam(subteamName).then(function (res) {
        bot.team.addMembers({
            "team": subteamName,
            "usernames": usernamesToAdd
        }).then(function (res) {
            var newSubteam = {
                membersType: "team", name: subteamName
            };
            flip(channel, newSubteam);
        });
    });
}
function flip(channel, whereToFlip) {
    if (typeof (whereToFlip) === 'undefined') {
        whereToFlip = channel;
    }
    var bettorRange = buildBettorRange(channel);
    var bettingValues = Object.values(bettorRange);
    var flatBettingValues = _.flatten(bettingValues);
    var minBet = flatBettingValues.reduce(function (a, b) { return Math.min(a, b); });
    var maxBet = flatBettingValues.reduce(function (a, b) { return Math.max(a, b); });
    var bettingTable = buildBettingTable(calculatePotSize(channel), bettorRange);
    bot2.chat.send(whereToFlip, {
        body: '**Final betting table...**'
    });
    bot2.chat.send(whereToFlip, {
        body: bettingTable
    });
    bot2.chat.send(whereToFlip, {
        body: "/flip " + minBet + ".." + maxBet
    }).then(function (res) {
        var snipe = activeSnipes[JSON.stringify(channel)];
        snipe.reflipping = false;
    });
}
function checkWalletBalance(username) {
    var balance = 0;
    return new Promise(function (resolve) {
        bot.wallet.lookup(username).then(function (acct) {
            console.log(acct);
            bot.wallet.balances(acct.accountId).then(function (balances) {
                console.log(balances);
                balances.forEach(function (acctDetail) {
                    console.log(acctDetail.balance[0].amount);
                    balance += parseFloat(acctDetail.balance[0].amount);
                });
                resolve(balance);
            })["catch"](function (e) {
                console.log(e);
                resolve(null);
            });
        })["catch"](function (e) {
            console.log(e);
            resolve(null);
        });
    });
}
function processNewBet(txn, msg) {
    var channel = msg.channel;
    var onBehalfOfMatch = msg.content.text.body.match(/(for|4):\s?@?(\w+)/i);
    var snipe = activeSnipes[JSON.stringify(channel)];
    return new Promise(function (resolve) {
        if (onBehalfOfMatch !== null) {
            var onBehalfOfRecipient_1 = onBehalfOfMatch[2];
            // check if the onBehalfOf user already has a wallet with bot.wallet.lookup(username);
            // if not, restrict the onBehalfOf wager to >= 2.01XLM, Keybase's minimum xfer for
            // new wallets
            checkWalletBalance(onBehalfOfRecipient_1).then(function (balance) {
                if (balance === null || balance < 2.01) {
                    snipe.chatSend('Betting on behalf of someone else?  Seems like they do not have a wallet yet, so your bet must be at least 2.01XLM');
                    processRefund(txn, msg.channel);
                    resolve(false);
                }
                else if (typeof (snipe.positionSizes[txn.fromUsername]) === 'undefined') {
                    snipe.chatSend('You cannot bet on behalf of someone else unless you are participating as well');
                    resolve(false);
                }
                else {
                    addSnipeParticipant(channel, txn, onBehalfOfRecipient_1);
                    snipe.chatSend("@" + onBehalfOfRecipient_1 + " is locked into the snipe, thanks to @" + txn.fromUsername + "!");
                    bot.chat.react(channel, msg.id, ':gift:');
                    resolve(true);
                }
            });
        }
        else {
            addSnipeParticipant(channel, txn, undefined);
            snipe.chatSend("@" + txn.fromUsername + " is locked into the snipe!");
            resolve(true);
        }
    });
}
function processTxnDetails(txn, msg) {
    var channel = msg.channel;
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (txn.toUsername !== botUsername) {
        return;
    }
    var isNative = txn.asset.type === "native";
    if (!isNative) {
        return;
    }
    var blinds;
    if (typeof (snipe) === "undefined") {
        blinds = 0.01;
    }
    else {
        blinds = snipe.blinds;
    }
    if (parseFloat(txn.amount) < blinds) {
        bot.chat.send(channel, {
            body: "Thanks for the tip, but bets should be >= " + blinds + "XLM"
        });
        return;
    }
    if (typeof (snipe) === "undefined") {
        var countdown = 60;
        var countdownMatch = msg.content.text.body.match(/countdown:\s?(\d+)/i);
        if (countdownMatch !== null) {
            countdown = parseInt(countdownMatch[1], 10);
            if (countdown < 5 || countdown > 60 * 60 * 24 * 7) {
                countdown = 60;
                bot.chat.send(channel, {
                    body: "Bad value of countdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)"
                });
            }
        }
        var chatThrottle_1 = throttledQueue(5, 5000);
        var moneyThrottle_1 = throttledQueue(5, 5000);
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
            chatSend: function (message) {
                return new Promise(function (resolve) {
                    chatThrottle_1(function () {
                        bot.chat.send(channel, {
                            body: message
                        }).then(function (messageId) {
                            resolve(messageId);
                        });
                    });
                });
            },
            moneySend: function (amount, recipient) {
                return new Promise(function (resolve) {
                    moneyThrottle_1(function () {
                        bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient);
                        resolve(true);
                    });
                });
            }
        };
        logNewSnipe(channel).then(function (snipeId) {
            snipe = activeSnipes[JSON.stringify(channel)];
            snipe.snipeId = snipeId;
            launchSnipe(channel);
            processNewBet(txn, msg);
        });
    }
    else {
        if (snipe.betting_open === false) {
            snipe.chatSend("Betting has closed - refunding");
            // Ensure the transaction is Completed before refunding
            setTimeout(function () {
                processRefund(txn, channel);
            }, 1000 * 5);
            return;
        }
        processNewBet(txn, msg).then(function (betProcessed) {
            if (betProcessed) {
                resetSnipeClock(channel);
            }
        });
    }
}
function calculatePotSize(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var sum = 0;
    snipe.participants.forEach(function (participant) {
        sum += parseFloat(participant.transaction.amount);
    });
    return sum;
}
function getTimeLeft(snipe) {
    return Math.ceil(Math.abs(moment.duration(snipe.betting_stops.diff(moment())).asSeconds()));
}
function resetSnipeClock(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (snipe.bettingTable) {
        bot.chat["delete"](channel, snipe.bettingTable, {}).then(function () {
            snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then(function (msg) {
                snipe.bettingTable = msg.id;
            });
        });
    }
    else {
        snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel))).then(function (msg) {
            snipe.bettingTable = msg.id;
        });
    }
    var timeRemaining = Math.ceil(getTimeLeft(snipe));
    console.log('time remaining', timeRemaining);
    clearTimeout(snipe.timeout);
    var boost, timerEndsInSeconds;
    if (timeRemaining <= 30) {
        timerEndsInSeconds = 60;
    }
    else {
        boost = 10;
        timerEndsInSeconds = timeRemaining + boost;
    }
    snipe.betting_stops = moment().add(timerEndsInSeconds, 'seconds');
    bot.chat["delete"](channel, snipe.clock, {});
    snipe.chatSend("Betting stops " + moment().to(snipe.betting_stops)).then(function (sentMessage) {
        console.log('just sent the parent betting stops message in resetSnipeClock');
        console.log('sentMessage', sentMessage);
        snipe.clock = sentMessage.id;
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, timerEndsInSeconds * 1000);
    snipe.timeout = finalizeBetsTimeout;
}
function loadActiveSnipes() {
    return new Promise(function (resolve) {
        var snipes = {};
        var connection = mysql.createConnection({
            database: process.env.MYSQL_DB,
            host: process.env.MYSQL_HOST,
            password: process.env.MYSQL_PASSWORD,
            user: process.env.MYSQL_USER
        });
        connection.connect();
        connection.query("SELECT * FROM snipes WHERE in_progress=1", function (error, results, fields) {
            if (error) {
                console.log(error);
            }
            results.forEach(function (result) {
                var chatThrottle = throttledQueue(5, 5000);
                var moneyThrottle = throttledQueue(5, 5000);
                var channel = JSON.parse(result.channel);
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
                    chatSend: function (message) {
                        return new Promise(function (resolve) {
                            chatThrottle(function () {
                                bot.chat.send(channel, {
                                    body: message
                                }).then(function (messageId) {
                                    resolve(messageId);
                                });
                            });
                        });
                    },
                    moneySend: function (amount, recipient) {
                        return new Promise(function (resolve) {
                            moneyThrottle(function () {
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
function launchSnipe(channel) {
    // Tell the channel: OK, your snipe has been accepted for routing.
    var snipe = activeSnipes[JSON.stringify(channel)];
    var message = "The snipe is on (**#" + activeSnipes[JSON.stringify(channel)].snipeId + "**).  Bet in multiples of 0.01XLM.  Betting format:";
    message += "```+0.01XLM@" + botUsername + "```";
    message += "Minimum bet: " + snipe.blinds + "XLM";
    snipe.chatSend(message);
    snipe.betting_stops = moment().add(snipe.countdown, 'seconds');
    snipe.chatSend("Betting stops " + moment().to(snipe.betting_stops)).then(function (sentMessage) {
        snipe.clock = sentMessage.id;
        runClock(channel);
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, snipe.countdown * 1000);
    activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;
}
function finalizeBets(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    snipe.chatSend("No more bets!");
    snipe.betting_open = false;
    // Give 5 seconds to finalize transactions + 1 extra.
    setTimeout(function () {
        executeFlipOrCancel(channel);
    }, 6 * 1000);
}
function refundAllParticipants(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var bets = {};
    snipe.participants.forEach(function (participant) {
        if (typeof (bets[participant.transaction.fromUsername]) === 'undefined') {
            var b = {
                fees: [],
                wagers: []
            };
            bets[participant.transaction.fromUsername] = b;
        }
        bets[participant.transaction.fromUsername].fees.push(calculateTransactionFees(participant.transaction));
        bets[participant.transaction.fromUsername].wagers.push(participant.transaction.amount);
    });
    var participantList = Object.keys(bets);
    participantList.forEach(function (participant) {
        Promise.all(bets[participant].fees).then(function (fees) {
            console.log('fees', fees);
            var feeSum = fees.reduce(function (a, b) { return parseFloat(a.toString()) + parseFloat(b.toString()); });
            console.log('feeSum', feeSum);
            var wagerSum = bets[participant].wagers.reduce(function (a, b) { return parseFloat(a.toString()) + parseFloat(b.toString()); });
            console.log('wagerSum', wagerSum);
            var refund = _.round(wagerSum - feeSum, 7);
            console.log('refund', refund);
            snipe.moneySend(refund, participant);
        });
    });
}
function executeFlipOrCancel(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) !== "undefined") {
        var participantUsernames = snipe.participants.map(function (participant) { return participant.onBehalfOf || participant.username; });
        var uniqParticipants = _.union(participantUsernames);
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
function cancelFlip(conversationId, channel, err) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    clearInterval(flipMonitorIntervals[conversationId]);
    if (typeof (activeSnipes[JSON.stringify(channel)]) !== "undefined") {
        snipe.chatSend("The flip has been cancelled due to error, and everyone is getting a refund");
        refundAllParticipants(channel);
        clearSnipe(channel, 'flip-error');
    }
}
function getChannelFromSnipeId(snipeId) {
    Object.keys(activeSnipes).forEach(function (stringifiedChannel) {
        if (activeSnipes[stringifiedChannel].snipeId === snipeId) {
            return JSON.parse(stringifiedChannel);
        }
    });
}
function flipInOurTeam(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var teamName = "croupierflips.snipe" + snipe.snipeId;
    var subChannel = {
        membersType: "team", name: teamName, public: false, topicType: "chat"
    };
    bot.team.createSubteam(teamName).then(function (result) {
        console.log('result for creating subteam', result);
        // invite all the participants - should probably throttle this.
        var usernamesToInvite = Object.keys(snipe.positionSizes).map(function (username) {
            return {
                "username": username,
                "role": "reader"
            };
        });
        usernamesToInvite = usernamesToInvite.concat({
            "username": "croupier",
            "role": "admin"
        });
        bot.team.addMembers({
            "team": teamName,
            "usernames": usernamesToInvite
        }).then(function (res) {
            console.log('result for adding members', res);
            bot.chat.send(subChannel, {
                body: '/flip'
            });
        });
    });
    return snipe;
}
function getOriginChannel(channelName) {
    var channelMatch = channelName.match(/croupierflips.snipe(\d+)/);
    var snipeId = channelMatch[1];
    return getChannelFromSnipeId(snipeId);
}
var flipMonitorIntervals = {};
function monitorFlipResults(msg) {
    var snipe, ourChannel;
    var channelMatch = msg.channel.name.match(/croupierflips.snipe(\d+)/);
    if (channelMatch === null) {
        snipe = activeSnipes[JSON.stringify(msg.channel)];
        ourChannel = false;
    }
    else {
        snipe = activeSnipes[JSON.stringify(getChannelFromSnipeId(channelMatch[1]))];
        ourChannel = true;
    }
    flipMonitorIntervals[msg.conversationId] = setInterval((function () {
        try {
            bot.chat.loadFlip(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId).then(function (flipDetails) {
                if (flipDetails.phase === 2) {
                    console.log("results are in");
                    var winner = resolveFlip(msg.channel, flipDetails.resultInfo.number);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                    clearSnipe(msg.channel, winner);
                    if (ourChannel) {
                        // WISHLIST?: set Timeout to remove the team in ~15 minutes
                    }
                }
                else {
                    console.log("results are NOT in", flipDetails);
                }
            })["catch"](function (err) {
                if (snipe.reflipping) {
                    return false;
                }
                snipe.reflipping = true;
                if (ourChannel) {
                    // extract the name of the offender
                    // remove the offender from the team
                    // clear the interval
                    // run the flip again
                    bot.chat.getFlipData(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId).then(function (res, stdout, stderr) {
                        console.log('getflipdata res!');
                        console.log(res);
                        var errorInfo = JSON.parse(stdout).result.status.errorInfo;
                        if (errorInfo.dupreg && errorInfo.dupreg.user) {
                            bot.team.removeMember({
                                team: msg.channel.name,
                                username: errorInfo.dupreg.user
                            }).then(function (res) {
                                snipe.chatSend("We have punted " + errorInfo.dupreg.user + " for duplicate registration issues");
                                flip(getOriginChannel(msg.channel.name), msg.channel);
                                clearInterval(flipMonitorIntervals[msg.conversationId]);
                            });
                        }
                        else {
                            flip(getOriginChannel(msg.channel.name), msg.channel);
                            clearInterval(flipMonitorIntervals[msg.conversationId]);
                        }
                    });
                }
                else {
                    snipe.chatSend('Due to error, we are going to re-cast the flip in a separate subteam over which we have governance and can kick anyone with a duplicate registration.');
                    var teamName = "croupierflips.snipe" + snipe.snipeId;
                    var subChannel = {
                        membersType: "team", name: teamName, public: false, topicType: "chat"
                    };
                    flip(msg.channel, subChannel);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                }
            });
        }
        catch (err) {
            cancelFlip(msg.conversationId, msg.channel, err);
        }
    }), 1000);
}
function adjustBlinds(channel) {
    var now = +new Date;
    var snipe = activeSnipes[JSON.stringify(channel)];
    var secondsElapsed = Math.floor((now - snipe.betting_started) / 1000);
    var minutesElapsed = Math.floor(secondsElapsed / 60.0);
    var blinds;
    if (minutesElapsed < 10) {
        blinds = 0.01;
    }
    else {
        blinds = 0.01 * Math.pow(2, Math.floor((minutesElapsed - 10) / 5));
    }
    if (blinds !== snipe.blinds) {
        snipe.blinds = blinds;
        updateSnipeLog(channel);
        snipe.chatSend("Blinds are raised to **" + blinds + "**");
    }
}
var runningClocks = {};
function runClock(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var seconds = getTimeLeft(snipe);
    console.log("according to runClock, the timeLeft is " + seconds);
    try {
        adjustBlinds(channel);
        // :hourglass: :hourglass_flowing_sand:
        if (seconds % 5 === 0) {
            var hourglass = void 0;
            var lastDigit = JSON.stringify(seconds).slice(-1);
            if (lastDigit === "5") {
                hourglass = ":hourglass:";
            }
            else {
                hourglass = ":hourglass_flowing_sand:";
            }
            var stops_when = moment().to(snipe.betting_stops);
            if (seconds < 55) {
                stops_when = "in " + seconds + " seconds";
            }
            console.log("attempting to edit message " + snipe.clock + " in channel " + channel);
            bot.chat.edit(channel, snipe.clock, {
                message: {
                    body: hourglass + (" betting stops " + stops_when)
                }
            }).then(function (res) {
                console.log(res);
            })["catch"](function (e) {
                console.log(e);
            });
        }
    }
    catch (e) {
        console.log('ran into error in runClock fxn, ', e);
        return;
    }
    if (seconds > 1) {
        setTimeout(function () {
            runClock(channel);
        }, 1000);
    }
    else {
        setTimeout(function () {
            bot.chat["delete"](channel, snipe.clock, {});
        }, 1000);
    }
}
function buildPowerupsTable(channel, whose) {
    var table = '';
    var snipe = activeSnipes[JSON.stringify(channel)];
    var powerupsCount = {};
    snipe.participants.forEach(function (bet) {
        if (bet.powerup && bet.powerup.usedAt === null && bet.username === whose) {
            var award = JSON.stringify(bet.powerup.award);
            if (typeof (powerupsCount[award]) === 'undefined') {
                powerupsCount[award] = 0;
            }
            powerupsCount[award] += 1;
        }
    });
    Object.keys(powerupsCount).forEach(function (awardJsonified) {
        var award = JSON.parse(awardJsonified);
        table += powerupsCount[awardJsonified] + "x " + award.emoji + " **" + award.name + "**: " + award.description + "\n";
    });
    return table;
}
function checkTextForPowerup(msg) {
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    if (typeof (snipe) === 'undefined') {
        return;
    }
    var powerupsQuery = msg.content.text.body.match(/(.powerups|🐶)\s?@?(\w+)?/);
    if (powerupsQuery !== null) {
        if (typeof (powerupsQuery[2]) !== 'undefined') {
            var whose = powerupsQuery[1];
            if (snipe.positionSizes[whose] > 10) {
                snipe.positionSizes[whose] -= 10;
                var str = buildPowerupsTable(msg.channel, whose);
                snipe.sendChat(str + "\nIt cost @" + msg.sender.username + " 10 position to scope @" + whose + " powerups");
            }
        }
        else {
            var whose = msg.sender.username;
            if (snipe.positionSizes[whose] > 1) {
                snipe.positionSizes[whose] -= 1;
                var str = buildPowerupsTable(msg.channel, whose);
                snipe.sendChat(str + "\nIt cost @" + whose + " 1 position to check their own powerups");
            }
        }
        return;
    }
    else {
        snipe.participants.forEach(function (bet) {
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
;
function checkReactionForPowerup(msg) {
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    if (typeof (snipe) === 'undefined') {
        return;
    }
    var reactionId = msg.id;
    var reaction = msg.content.reaction;
    console.log('Checking for powerup');
    console.log('msg.sender.username', msg.sender.username);
    snipe.participants.forEach(function (bet) {
        if (msg.sender.username === bet.username) {
            if (bet.powerup && bet.powerup.usedAt === null) {
                console.log('reaction.b', reaction.b);
                console.log('bet powerup award reaction', bet.powerup.award.reaction);
                console.log('reaction.m', reaction.m);
                console.log('bet powerup reactionId', bet.powerup.reactionId);
                if (reaction.b === bet.powerup.award.reaction && reaction.m === bet.powerup.reactionId) {
                    consumePowerup(msg.channel, bet.powerup);
                }
            }
        }
    });
}
function findPotLead(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var obj = snipe.positionSizes;
    return _.maxBy(_.keys(obj), function (o) { return obj[o]; });
}
function consumePowerup(channel, powerup) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var consumer = snipe.participants[powerup.participantIndex].username;
    var leader = findPotLead(channel);
    powerup.usedAt = +new Date;
    switch (powerup.award.name) {
        case 'nuke':
            var unusedPowerups = snipe.participants.filter(function (p) { return p.powerup && typeof (p.powerup.usedAt) === 'undefined'; });
            snipe.sendChat("@" + consumer + " went nuclear.  Enjoy the show :fireworks:.");
            if (unusedPowerups.length === 0) {
                snipe.sendChat("...well, that was awkward. All that nuclear FUD, and for what?");
            }
            snipe.participants.forEach(function (participant) {
                if (participant.powerup) {
                    var powerup_1 = participant.powerup;
                    if (typeof (powerup_1.usedAt) === 'undefined') {
                        consumePowerup(getChannelFromSnipeId(snipe.snipeId), powerup_1);
                    }
                }
            });
            break;
        case 'freeze':
            snipe.sendChat("@" + consumer + " played Freeze.  Any action by anyone other than " + consumer + " or @croupier during the next 10 seconds will be ignored and instead increase " + consumer + "'s position by 1.");
            snipe.freeze = consumer;
            setTimeout(function () {
                snipe.sendChat("@" + consumer + "'s freeze has expired!");
                snipe.freeze = undefined;
            }, 1000 * 10);
            break;
        case 'the-final-countdown':
            snipe.betting_stops = moment().add(60, 'seconds');
            snipe.sendChat("@" + consumer + " played The Final Countdown.  Will things ever be the same again?  60 seconds on the clock.   It's the final countdown.");
            break;
        case 'level-the-playing-field':
            Object.keys(snipe.positionSizes).forEach(function (username) {
                snipe.positionSizes[username] = 1;
            });
            snipe.sendChat("@" + consumer + " leveled the playing field in a big way.  Everyone's positions are now equal.  One love.");
            break;
        case 'half-life': // Cut the remaining time in half
            var timeToSubtract = Math.floor(getTimeLeft(snipe) / 2.0);
            snipe.betting_stops = snipe.betting_stops.subtract(timeToSubtract, 'seconds');
            snipe.sendChat("@" + consumer + " chopped " + timeToSubtract + " seconds off the clock.");
            break;
        case 'double-life': // Double the remaining time
            var timeToAdd = Math.floor(getTimeLeft(snipe));
            snipe.betting_stops = snipe.betting_stops.add(timeToAdd, 'seconds');
            snipe.sendChat("@" + consumer + " added " + timeToAdd + " seconds to the clock.");
            break;
        case 'assassin': // Reduce the pot leader's position size to 1
            snipe.positionSizes[leader] = 1;
            snipe.chatSend("@" + consumer + "'s :gun: seriously injured @" + leader + " and their position size is now 1.");
            break;
        case 'popularity-contest': // Put it to a vote: who does the group like more, you or the pot leader?  If the pot leader wins, your position is reduced to 1.  If you win, you and the pot leader swap position sizes!
            if (consumer === leader) {
                snipe.chatSend("You cannot challenge yourself in this game. ::powerup fizzles::");
                return;
            }
            bot.chat.send(channel, {
                body: "@" + consumer + " called a popularity contest to challenge @" + leader + "'s throne!  Whom do you prefer?  First to 3 votes wins (4 votes including the initial reaction seeded by me the Croupier)!"
            }).then(function (msgData) {
                var challengerReaction = bot.chat.react(channel, msgData.id, "" + consumer);
                var leaderReaction = bot.chat.react(channel, msgData.id, "" + leader);
                Promise.all([challengerReaction, leaderReaction]).then(function (values) {
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
            if (Math.random() >= 0.5) {
                snipe.positionSizes[consumer] = 2 * snipe.positionSizes[consumer];
                snipe.chatSend("A favorable day!  @" + consumer + "'s position size has doubled to " + snipe.positionSizes[consumer]);
            }
            else {
                snipe.positionSizes[consumer] = Math.ceil(snipe.positionSizes[consumer] / 2);
                snipe.chatSend("Ouch! @" + consumer + " cut their hand on the double edged sword and is now dealing with " + snipe.positionSizes[consumer] + ".");
            }
            break;
        default:
            // nothing.
            break;
    }
    updateSnipeLog(channel);
    resetSnipeClock(channel);
}
function checkForPopularityContestVote(msg) {
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    if (typeof (snipe) === 'undefined' || typeof (snipe.popularityContests) === 'undefined') {
        return;
    }
    var reactionId = msg.id;
    var reaction = msg.content.reaction;
    snipe.popularityContests.forEach(function (contest) {
        if (contest.pollMessageId === reaction.m) {
            if (reaction.b === contest.leader) {
                contest.votesForLeader.push(reactionId);
                checkForPopularityContestEnd(msg.channel, reaction.m);
            }
            else if (reaction.b === contest.challenger) {
                contest.votesForChallenger.push(reactionId);
                checkForPopularityContestEnd(msg.channel, reaction.m);
            }
        }
    });
}
function checkForPopularityContestVoteRemoval(msg) {
    var getIdx;
    var deleteReactionIds = msg.content["delete"].messageIDs;
    // check for open popularity contests.
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    snipe.popularityContests.forEach(function (contest, contestIdx) {
        deleteReactionIds.forEach(function (reactionToDeleteId) {
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
;
function checkForPopularityContestEnd(channel, pollMessageId) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    snipe.popularityContests.forEach(function (contest, contestIdx) {
        if (contest.votesForChallenger.length >= 3) {
            var leaderPositionSize = snipe.positionSizes[contest.leader];
            var challengerPositionSize = snipe.positionSizes[contest.challenger];
            snipe.positionSizes[contest.leader] = challengerPositionSize;
            snipe.positionSizes[contest.challenger] = leaderPositionSize;
            snipe.sendChat(contest.challenger + " and " + contest.leader + " have swapped position sizes! You can't buy your way to the top in this game!");
            // TODO: could be dangerous to modify an array while looping over it?
            // mark the contest closed ...
            snipe.popularityContests.splice(contestIdx, 1);
        }
        else if (contest.votesForLeader.length >= 3) {
            snipe.positionSizes[contest.challenger] = 1;
            snipe.sendChat(contest.challenger + " lost the popular vote and is punished.  Position size = 1.");
            // mark the contest closed
            snipe.popularityContests.splice(contestIdx, 1);
        }
    });
}
function freeze(msg) {
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    snipe.sendChat("@" + msg.sender.username + "'s attempt was frozen and instead @" + snipe.freeze + "'s position increased +1");
    snipe.positionSizes[snipe.freeze] += 1;
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var channel, message, error_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 5, , 6]);
                    return [4 /*yield*/, bot.init(botUsername, paperkey)];
                case 1:
                    _a.sent();
                    console.log("Bot initialized with username " + botUsername + ".");
                    return [4 /*yield*/, bot2.init(botUsername, paperkey2)];
                case 2:
                    _a.sent();
                    console.log("Second key initialized");
                    console.log("Listening for all messages...");
                    channel = {
                        membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat"
                    };
                    message = {
                        body: botUsername + " was just restarted...[development mode] [use at own risk] [not functional]"
                    };
                    bot.chat.send(channel, message);
                    return [4 /*yield*/, loadActiveSnipes()];
                case 3:
                    activeSnipes = _a.sent();
                    console.log('here, the active snipes we found: ');
                    console.log(activeSnipes);
                    Object.keys(activeSnipes).forEach(function (chid) {
                        var channel = JSON.parse(chid);
                        activeSnipes[chid].chatSend('Croupier was restarted... Previous bets are still valid!');
                        activeSnipes[chid].chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel)));
                        launchSnipe(channel);
                    });
                    return [4 /*yield*/, bot.chat.watchAllChannelsForNewMessages(function (msg) { return __awaiter(_this, void 0, void 0, function () {
                            var snipe;
                            return __generator(this, function (_a) {
                                if (msg.channel.topicName !== "test3") {
                                    return [2 /*return*/];
                                }
                                try {
                                    snipe = activeSnipes[JSON.stringify(msg.channel)];
                                    if (typeof (snipe) !== 'undefined' && snipe.freeze && msg.sender.username !== snipe.freeze) {
                                        freeze(msg);
                                        return [2 /*return*/];
                                    }
                                    if (msg.content.type === "flip" && msg.sender.username === botUsername) {
                                        monitorFlipResults(msg);
                                        return [2 /*return*/];
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
                                }
                                catch (err) {
                                    console.error(err);
                                }
                                return [2 /*return*/];
                            });
                        }); }, function (e) { return console.error(e); })];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    console.error(error_1);
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function shutDown() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, bot.deinit()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, bot2.deinit()];
                case 2:
                    _a.sent();
                    process.exit();
                    return [2 /*return*/];
            }
        });
    });
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
main();
