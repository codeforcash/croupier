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
var os = require("os");
var Bot = require("./keybase-bot");
require("source-map-support/register");
var bot = new Bot(os.homedir());
var bot2 = new Bot(os.homedir());
var botUsername = "croupier";
var paperkey = process.env.CROUPIER_PAPERKEY_1;
var paperkey2 = process.env.CROUPIER_PAPERKEY_2;
function documentSnipe(channel, winner, wasCancelled) {
    var participants = JSON.stringify(activeSnipes[JSON.stringify(channel)].participants);
    var connection = mysql.createConnection({
        database: process.env.MYSQL_DB,
        host: process.env.MYSQL_HOST,
        password: process.env.MYSQL_PASSWORD,
        user: process.env.MYSQL_USER
    });
    connection.connect();
    if (winner !== null) {
        winner = "'" + winner + "'";
    }
    connection.query("INSERT INTO snipes\n    (participants, winner, was_cancelled)\n    VALUES\n    ('" + participants + "', " + winner + ", " + wasCancelled + ")", function (error, results, fields) {
        if (error) {
            console.log(error);
        }
    });
    connection.end();
}
function processRefund(txn, channel) {
    console.log("refunding txn", txn);
    // API returns a response, number of stroops
    var transactionFees = 300 * 0.0000001;
    console.log("refunding txn fees", transactionFees);
    var refund = _.round(txn.amount - transactionFees, 7);
    console.log("total refund is", refund);
    bot.chat.sendMoneyInChat(channel.topicName, channel.name, refund.toString(), txn.fromUsername);
}
function extractTxn(msg) {
    var txnId = msg.content.text.payments[0].result.sent;
    bot.wallet.details(txnId).then(function (details) { return processTxnDetails(details, msg.channel); });
}
function sendAmountToWinner(winnerUsername, channel) {
    var bounty;
    var snipe = activeSnipes[JSON.stringify(channel)];
    bounty = 0;
    snipe.participants.forEach(function (participant) {
        bounty += parseFloat(participant.transaction.amount);
        bounty -= (300 * 0.0000001); // transaction fees for receiving the transaction
    });
    bounty = _.round(bounty, 7);
    console.log("now rounded", bounty);
    bot.chat.sendMoneyInChat(channel.topicName, channel.name, bounty.toString(), winnerUsername);
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
    bot.chat.send(channel, {
        body: "Congrats to @" + winnerUsername
    });
    documentSnipe(channel, winnerUsername, false);
}
function buildBettorRange(channel) {
    var bettorMap = {};
    activeSnipes[JSON.stringify(channel)].participants.forEach(function (participant) {
        if (typeof (bettorMap[participant.username]) === "undefined") {
            bettorMap[participant.username] = Math.floor(participant.transaction.amount / 0.01);
        }
        else {
            bettorMap[participant.username] += Math.floor(participant.transaction.amount / 0.01);
        }
    });
    var bettorRange = {};
    var start = 0;
    Object.keys(bettorMap).forEach(function (key) {
        bettorRange[key] = [start + 1, start + bettorMap[key]];
        start += bettorMap[key];
    });
    return bettorRange;
}
function flip(channel) {
    var bettorRange = buildBettorRange(channel);
    var bettingValues = Object.values(bettorRange);
    var flatBettingValues = _.flatten(bettingValues);
    var minBet = flatBettingValues.reduce(function (a, b) { return Math.min(a, b); });
    var maxBet = flatBettingValues.reduce(function (a, b) { return Math.max(a, b); });
    var bettingTable = "Betting table\n";
    Object.keys(bettorRange).forEach(function (username) {
        bettingTable += "\n@" + username + ": `" + bettorRange[username][0] + " - " + bettorRange[username][1] + "`";
    });
    bot2.chat.send(channel, {
        body: bettingTable
    });
    bot2.chat.send(channel, {
        body: "/flip " + minBet + ".." + maxBet
    });
}
function processTxnDetails(txn, channel) {
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
        launchSnipe(channel);
        activeSnipes[JSON.stringify(channel)].participants.push({
            transaction: txn,
            username: txn.fromUsername
        });
    }
    console.log("betting_open 178");
    if (snipe.betting_open === false) {
        bot.chat.send(channel, {
            body: "Betting has closed - refunding"
        });
        processRefund(txn, channel);
        return;
    }
    activeSnipes[JSON.stringify(channel)].participants.push({
        transaction: txn,
        username: txn.fromUsername
    });
    bot.chat.send(channel, {
        body: "@" + txn.fromUsername + " is locked into the snipe!"
    });
    resetSnipeClock(channel);
}
function resetSnipeClock(channel) {
    var snipeTimeout = 60;
    clearTimeout(activeSnipes[JSON.stringify(channel)].timeout);
    bot.chat["delete"](channel, activeSnipes[JSON.stringify(channel)].clock, {});
    bot.chat.send(channel, {
        body: "Betting stops in " + snipeTimeout + " seconds"
    }).then(function (sentMessage) {
        runClock(channel, sentMessage.id, snipeTimeout);
        activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, snipeTimeout * 1000);
    activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;
}
var activeSnipes = {};
function launchSnipe(channel) {
    // Tell the channel: OK, your snipe has been accepted for routing.
    var snipeTimeout = 60;
    var message = "The snipe is on.  Bet in multiples of 0.01XLM.  Betting format:";
    message += "```+0.01XLM@" + botUsername + "```";
    activeSnipes[JSON.stringify(channel)] = {
        betting_open: true,
        clock: null,
        participants: [],
        timeout: null
    };
    bot.chat.send(channel, { body: message });
    bot.chat.send(channel, {
        body: "Betting stops in " + snipeTimeout + " seconds"
    }).then(function (sentMessage) {
        runClock(channel, sentMessage.id, snipeTimeout);
        activeSnipes[JSON.stringify(channel)].clock = sentMessage.id;
    });
    var finalizeBetsTimeout = setTimeout(function () {
        finalizeBets(channel);
    }, snipeTimeout * 1000);
    activeSnipes[JSON.stringify(channel)].timeout = finalizeBetsTimeout;
}
function finalizeBets(channel) {
    bot.chat.send(channel, {
        body: "No more bets!"
    });
    console.log("betting_open 255");
    activeSnipes[JSON.stringify(channel)].betting_open = false;
    // Give 5 seconds to finalize transactions + 1 extra.
    setTimeout(function () {
        executeFlipOrCancel(channel);
    }, 6 * 1000);
}
/* TODO: check that there are _different_ participants not someone betting against themself multiple times */
function executeFlipOrCancel(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) !== "undefined") {
        var participantUsernames = snipe.participants.map(function (participant) { return participant.username; });
        var uniqParticipants = _.union(participantUsernames);
        if (uniqParticipants.length > 1) {
            flip(channel);
        }
        else if (uniqParticipants.length === 1) {
            snipe.participants.forEach(function (participant) {
                processRefund(participant.transaction, channel);
            });
            bot.chat.send(channel, {
                body: "The snipe has been cancelled due to a lack of participants."
            });
            documentSnipe(channel, null, true);
            activeSnipes[JSON.stringify(channel)] = undefined;
        }
        else {
            bot.chat.send(channel, {
                body: "The snipe has been cancelled due to a lack of participants."
            });
            documentSnipe(channel, null, true);
            activeSnipes[JSON.stringify(channel)] = undefined;
        }
    }
}
function cancelFlip(conversationId, channel, err) {
    clearInterval(flipMonitorIntervals[conversationId]);
    if (typeof (activeSnipes[JSON.stringify(channel)]) !== "undefined") {
        bot.chat.send(channel, {
            body: "The flip has been cancelled due to error, and everyone is getting a refund"
        });
        activeSnipes[JSON.stringify(channel)].participants.forEach(function (participant) {
            processRefund(participant.transaction, channel);
        });
        documentSnipe(channel, null, true);
        activeSnipes[JSON.stringify(channel)] = undefined;
    }
}
var flipMonitorIntervals = {};
function monitorFlipResults(msg) {
    flipMonitorIntervals[msg.conversationId] = setInterval((function () {
        try {
            bot.chat.loadFlip(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId).then(function (flipDetails) {
                if (flipDetails.phase === 2) {
                    console.log("results are in");
                    resolveFlip(msg.channel, flipDetails.resultInfo.number);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                    activeSnipes[JSON.stringify(msg.channel)] = undefined;
                }
                else {
                    console.log("results are NOT in", flipDetails);
                }
            })["catch"](function (err) {
                cancelFlip(msg.conversationId, msg.channel, err);
            });
        }
        catch (err) {
            cancelFlip(msg.conversationId, msg.channel, err);
        }
    }), 1000);
}
var allClocks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reverse();
var runningClocks = {};
function runClock(channel, messageId, seconds) {
    try {
        bot.chat.edit(channel, messageId, {
            message: {
                body: ":clock" + allClocks[seconds % 12].toString() + ":" + (" betting stops in " + seconds + "s")
            }
        });
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
            bot.chat.edit(channel, messageId, {
                message: {
                    body: "~:clock" + allClocks[seconds % 12].toString() + ":" + " betting stops in 1s~ no longer accepting bets"
                }
            });
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
                    _a.trys.push([0, 4, , 5]);
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
                case 3:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _a.sent();
                    console.error(error_1);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
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
