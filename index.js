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
function updateSnipeLog(channel) {
    var participants = JSON.stringify(activeSnipes[JSON.stringify(channel)].participants);
    var snipeId = activeSnipes[JSON.stringify(channel)].snipeId;
    var connection = mysql.createConnection({
        database: process.env.MYSQL_DB,
        host: process.env.MYSQL_HOST,
        password: process.env.MYSQL_PASSWORD,
        user: process.env.MYSQL_USER
    });
    connection.connect();
    connection.query("UPDATE snipes SET participants=" + connection.escape(participants) + " WHERE id=" + connection.escape(snipeId), function (error, results, fields) {
        if (error) {
            console.log(error);
        }
    });
    connection.end();
}
function addSnipeParticipant(channel, txn, onBehalfOf) {
    var newParticipant;
    if (typeof (onBehalfOf) === 'undefined') {
        newParticipant = {
            transaction: txn,
            username: txn.fromUsername
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
        connection.query("INSERT INTO snipes\n      (channel, initial_countdown, followup_countdown)\n      VALUES\n      (" + connection.escape(JSON.stringify(channel)) + ",\n      " + connection.escape(snipe.initialCountdown) + ",\n      " + connection.escape(snipe.followupCountdown) + "\n      )", function (error, results, fields) {
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
    activeSnipes[JSON.stringify(channel)] = undefined;
    documentSnipe(channel, reason);
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
    activeSnipes[JSON.stringify(channel)].participants.forEach(function (participant) {
        console.log('participant', participant);
        var username;
        if (typeof (participant.onBehalfOf) === "undefined") {
            var username_1 = participant.username;
        }
        else {
            var username_2 = participant.onBehalfOf;
        }
        console.log('username', username);
        if (typeof (bettorMap[username]) === "undefined") {
            bettorMap[username] = Math.floor(participant.transaction.amount / 0.01);
        }
        else {
            bettorMap[username] += Math.floor(participant.transaction.amount / 0.01);
        }
    });
    var bettorRange = {};
    var start = 0;
    Object.keys(bettorMap).forEach(function (key) {
        console.log('bettorMap key', key);
        bettorRange[key] = [start + 1, start + bettorMap[key]];
        start += bettorMap[key];
    });
    return bettorRange;
}
function buildBettingTable(potSize, bettorRange) {
    console.log('within BuildBettingTable, bettorRange:', bettorRange);
    var maxValue = Math.max.apply(Math, _.flatten(Object.values(bettorRange)));
    var bettingTable = "Pot size: " + potSize + "XLM\n";
    Object.keys(bettorRange).forEach(function (username) {
        var chancePct = 100 * ((1 + (bettorRange[username][1] - bettorRange[username][0])) / maxValue);
        bettingTable += "\n@" + username + ": `" + bettorRange[username][0].toLocaleString() + " - " + bettorRange[username][1].toLocaleString() + "` (" + chancePct + "% to win)";
    });
    return bettingTable;
}
;
function flip(channel) {
    var bettorRange = buildBettorRange(channel);
    var bettingValues = Object.values(bettorRange);
    var flatBettingValues = _.flatten(bettingValues);
    var minBet = flatBettingValues.reduce(function (a, b) { return Math.min(a, b); });
    var maxBet = flatBettingValues.reduce(function (a, b) { return Math.max(a, b); });
    var bettingTable = buildBettingTable(calculatePotSize(channel), bettorRange);
    bot2.chat.send(channel, {
        body: bettingTable
    });
    bot2.chat.send(channel, {
        body: "/flip " + minBet + ".." + maxBet
    });
}
function processNewBet(txn, msg) {
    var channel = msg.channel;


    if(txn.amount < 2.01) {
        bot.chat.send(channel, {
            body: "if sending onBehalfOf someone else, amount must be >= 2.01XLM in the event they do not already have a Keybase wallet"
        });
        return;
    }

    var onBehalfOfMatch = msg.content.text.body.match(/onBehalfOf:\s?(\d+)/);
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (onBehalfOfMatch !== null) {
        var onBehalfOfRecipient = onBehalfOfMatch[1];
        addSnipeParticipant(channel, txn, onBehalfOfRecipient);
        snipe.chatSend("@" + onBehalfOfRecipient + " is locked into the snipe, thanks to @" + txn.fromUsername + "!");
    }
    else {
        addSnipeParticipant(channel, txn, undefined);
        snipe.chatSend("@" + txn.fromUsername + " is locked into the snipe!");
    }
}
function processTxnDetails(txn, msg) {
    var channel = msg.channel;
    if (txn.toUsername !== botUsername) {
        return;
    }
    var isNative = txn.asset.type === "native";
    if (!isNative) {
        return;
    }
    if (parseFloat(txn.amount) < 0.01) {
        bot.chat.send(channel, {
            body: "Thanks for the tip, but bets should be >= 0.01XLM"
        });
        return;
    }
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) === "undefined") {
        var initialCountdown = 60;
        var initialCountdownMatch = msg.content.text.body.match(/initialCountdown:\s?(\d+)/);
        if (initialCountdownMatch !== null) {
            initialCountdown = parseInt(initialCountdownMatch[1], 10);
            if (initialCountdown < 5 || initialCountdown > 60 * 60 * 24 * 7) {
                initialCountdown = 60;
                bot.chat.send(channel, {
                    body: "Bad value of initialCountdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)"
                });
            }
        }
        var followupCountdown = 60;
        var followupCountdownMatch = msg.content.text.body.match(/followupCountdown:\s?(\d+)/);
        if (followupCountdownMatch !== null) {
            followupCountdown = parseInt(followupCountdownMatch[1], 10);
            if (followupCountdown < 5 || followupCountdown > 60 * 60 * 24 * 7) {
                followupCountdown = 60;
                bot.chat.send(channel, {
                    body: "Bad value of followupCountdown.  Must be >= 5 (5 seconds) && <= 604800 (7 days)"
                });
            }
        }
        var chatThrottle_1 = throttledQueue(5, 5000);
        var moneyThrottle_1 = throttledQueue(5, 5000);
        activeSnipes[JSON.stringify(channel)] = {
            betting_open: true,
            clock: null,
            participants: [],
            timeout: null,
            initialCountdown: initialCountdown,
            followupCountdown: followupCountdown,
            reFlips: 3,
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
                        bot.chat.sendMoneyInChat(channel.topicName, channel.name, amount.toString(), recipient).then(function (res) {
                            resolve(res);
                        });
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
        processNewBet(txn, msg);
        resetSnipeClock(channel);
    }
}
function calculatePotSize(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    var sum = 0;
    snipe.participants.forEach(function (participant) {
        sum += participant.transaction.amount;
    });
    return sum;
}
function resetSnipeClock(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    snipe.chatSend(buildBettingTable(calculatePotSize(channel), buildBettorRange(channel)));
    var snipeTimeout = snipe.followupCountdown;
    clearTimeout(snipe.timeout);
    snipe.betting_stops = moment().add(snipeTimeout, 'seconds');
    bot.chat["delete"](channel, snipe.clock, {});
    snipe.chatSend("Betting stops " + moment().to(snipe.betting_stops)).then(function (sentMessage) {
        runClock(channel, sentMessage.id, snipeTimeout);
        activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, snipeTimeout * 1000);
    activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;
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
                    betting_open: true,
                    clock: null,
                    participants: JSON.parse(result.participants),
                    timeout: null,
                    initialCountdown: result.initial_countdown,
                    followupCountdown: result.followup_countdown,
                    reFlips: 3,
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
                                resolve(true);
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
    snipe.chatSend(message);
    snipe.betting_stops = moment().add(snipe.initialCountdown, 'seconds');
    snipe.chatSend("Betting stops " + moment().to(snipe.betting_stops)).then(function (sentMessage) {
        runClock(channel, sentMessage.id, snipe.initialCountdown);
        snipe.clock = sentMessage.id;
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, snipe.initialCountdown * 1000);
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
            var feeSum = fees.reduce(function (a, b) { return a + b; });
            var wagerSum = bets[participant].wagers.reduce(function (a, b) { return a + b; });
            var refund = _.round(wagerSum - feeSum, 7);
            snipe.moneySend(refund, participant);
        });
    });
}
function executeFlipOrCancel(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) !== "undefined") {
        var participantUsernames = snipe.participants.map(function (participant) { return participant.username; });
        var uniqParticipants = _.union(participantUsernames);
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
function cancelFlip(conversationId, channel, err) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    clearInterval(flipMonitorIntervals[conversationId]);
    if (typeof (activeSnipes[JSON.stringify(channel)]) !== "undefined") {
        snipe.chatSend("The flip has been cancelled due to error, and everyone is getting a refund");
        refundAllParticipants(channel);
        clearSnipe(channel, 'flip-error');
    }
}
var flipMonitorIntervals = {};
function monitorFlipResults(msg) {
    var snipe = activeSnipes[JSON.stringify(msg.channel)];
    flipMonitorIntervals[msg.conversationId] = setInterval((function () {
        try {
            bot.chat.loadFlip(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId).then(function (flipDetails) {
                if (flipDetails.phase === 2) {
                    console.log("results are in");
                    var winner = resolveFlip(msg.channel, flipDetails.resultInfo.number);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                    clearSnipe(msg.channel, winner);
                }
                else {
                    console.log("results are NOT in", flipDetails);
                }
            })["catch"](function (err) {
                if (snipe.reFlips > 0) {
                    snipe.chatSend('Due to error, we are going to re-flip in 60 seconds');
                    snipe.reFlips--;
                    setTimeout(function () {
                        flip(msg.channel);
                    }, 60 * 1000);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                }
                else {
                    cancelFlip(msg.conversationId, msg.channel, err);
                }
            });
        }
        catch (err) {
            cancelFlip(msg.conversationId, msg.channel, err);
        }
    }), 1000);
}
var runningClocks = {};
function runClock(channel, messageId, seconds) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    try {
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
            bot.chat.edit(channel, messageId, {
                message: {
                    body: hourglass + (" betting stops " + stops_when)
                }
            });
        }
    }
    catch (e) {
        return;
    }
    if (seconds > 1) {
        setTimeout(function () {
            runClock(channel, messageId, seconds - 1);
        }, 1000);
    }
    else {
        setTimeout(function () {
            bot.chat["delete"](channel, messageId, {});
        }, 1000);
    }
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
                            return __generator(this, function (_a) {
                                try {
                                    if (msg.content.type === "flip" && msg.sender.username === botUsername) {
                                        monitorFlipResults(msg);
                                        return [2 /*return*/];
                                    }
                                    if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
                                        extractTxn(msg);
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
