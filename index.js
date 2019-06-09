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
var axios_1 = require("axios");
var lodash_1 = require("lodash");
var os = require("os");
var Bot = require("./keybase-bot");
require("source-map-support/register");
var bot = new Bot(os.homedir());
var bot2 = new Bot(os.homedir());
var botUsername = "croupier";
var paperkey = process.env.CROUPIER_PAPERKEY_1;
var paperkey2 = process.env.CROUPIER_PAPERKEY_2;
var isNumber = function (value) { return !Number.isNaN(parseFloat(value)); };
function processRefund(txn, channel) {
    console.log("refunding txn", txn);
    var txnDetailsApi = "https://horizon.stellar.org/transactions/" + txn.txId;
    axios_1["default"].get(txnDetailsApi).then(function (response) {
        // API returns a response, number of stroops
        var transactionFees = parseFloat(response.data.fee_paid) * 0.0000001;
        console.log("refunding txn fees", transactionFees);
        var refund = lodash_1["default"].round(txn.amount - transactionFees, 7);
        console.log("total refund is", refund);
        bot.wallet.send(txn.fromUsername, refund.toString()).then(function (refundTxn) {
            var refundMsg = "```+" + refund + "XLM@" + txn.fromUsername + "``` ";
            refundMsg += " :arrow_right: ";
            refundMsg += "`https://stellar.expert/explorer/public/tx/" + refundTxn.txId + "`";
            bot.chat.send(channel, {
                body: refundMsg
            });
        })["catch"](function (err) {
            console.log(err);
        });
    });
}
function extractTxn(msg) {
    var txnId = msg.content.text.payments[0].result.sent;
    bot.wallet.details(txnId).then(function (details) { return processTxnDetails(details, msg.channel); });
}
function sendAmountToWinner(winnerUsername, wager, channel) {
    var txnDetailsApi;
    var transactionFees;
    var bounty;
    var snipe = activeSnipes[JSON.stringify(channel)];
    Promise.all(snipe.participants.map(function (participant) {
        txnDetailsApi = "https://horizon.stellar.org/transactions/" + participant.transaction.txId;
        return axios_1["default"].get(txnDetailsApi);
    })).then(function (apiResponses) {
        transactionFees = 0;
        bounty = 0;
        apiResponses.forEach(function (apiResponse) {
            transactionFees += (parseFloat(apiResponse.data.fee_paid) * 0.0000001);
            bounty += snipe.wager;
        });
        bounty = lodash_1["default"].round(bounty - transactionFees, 7);
        bot.wallet.send(winnerUsername, bounty.toString()).then(function (txn) {
            var bountyMsg = "```+" + bounty + "XLM@" + winnerUsername + "``` ";
            bountyMsg += ":arrow_right: ";
            bountyMsg += "`https://stellar.expert/explorer/public/tx/" + txn.txId + "`",
                bot.chat.send(channel, {
                    body: bountyMsg
                });
        });
    });
}
function resolveFlip(channel, results) {
    var winnerUsername = results[0];
    var snipe = activeSnipes[JSON.stringify(channel)];
    sendAmountToWinner(winnerUsername, snipe.wager, channel);
    bot.chat.send(JSON.parse(snipe.channel), {
        body: "Congrats to @" + winnerUsername
    });
}
function flip(channel) {
    var flipParticipants = activeSnipes[JSON.stringify(channel)].participants.map(function (el) {
        return el.username;
    }).join(", ");
    bot2.chat.send(channel, {
        body: "/flip " + flipParticipants
    });
}
function processTxnDetails(txn, channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) === "undefined") {
        return;
    }
    var isNative = txn.asset.type === "native";
    if (!isNative) {
        return;
    }
    if (txn.toUsername !== botUsername) {
        return;
    }
    if (snipe.betting_open === false) {
        processRefund(txn, channel);
    }
    else {
        activeSnipes[JSON.stringify(channel)].participants.push({
            transaction: txn,
            username: txn.fromUsername
        });
        bot.chat.send(channel, {
            body: "@" + txn.fromUsername + " is locked into the snipe!"
        });
    }
}
var activeSnipes = {};
function launchSnipe(wager, channel) {
    // Tell the channel: OK, your snipe has been accepted for routing.
    var message = "The snipe is on.  ";
    message += "Anybody is free to send me _exactly_ " + wager + "XLM within 30 seconds: ";
    message += "```+" + wager + "XLM@beemo```.";
    message += " If there are not at >= 2 confirmed participants, the snipe is going ";
    message += "to be cancelled with deposits refunded, less transaction fess.";
    bot.chat.send(channel, { body: message });
    bot.chat.send(channel, {
        body: "Betting stops in 30 seconds"
    }).then(function (sentMessage) {
        runClock(channel, sentMessage.id, 30);
    });
    setTimeout(function () {
        finalizeBets(channel);
    }, 30 * 1000);
    activeSnipes[JSON.stringify(channel)] = {
        betting_open: true,
        participants: [],
        wager: {}
    };
}
function finalizeBets(channel) {
    bot.chat.send(channel, {
        body: "No more bets!"
    });
    activeSnipes[JSON.stringify(channel)].betting_open = false;
    // Give 5 seconds to finalize transactions + 1 extra.
    setTimeout(function () {
        executeFlipOrCancel(channel);
    }, 6 * 1000);
}
function executeFlipOrCancel(channel) {
    var snipe = activeSnipes[JSON.stringify(channel)];
    if (typeof (snipe) !== "undefined") {
        if (snipe.participants.length > 1) {
            flip(channel);
        }
        else if (snipe.participants.length === 1) {
            processRefund(snipe.participants[0].transaction, channel);
            bot.chat.send(channel, {
                body: "The snipe has been cancelled due to a lack of participants."
            });
            activeSnipes[JSON.stringify(channel)] = undefined;
        }
        else {
            bot.chat.send(channel, {
                body: "The snipe has been cancelled due to a lack of participants."
            });
            activeSnipes[JSON.stringify(channel)] = undefined;
        }
    }
}
function checkForSnipe(msg) {
    if (msg.channel.public || msg.channel.membersType !== "team" || msg.channel.topicType !== "chat") {
        // Beemo only listens to public conversations.
        return;
    }
    if (typeof activeSnipes[JSON.stringify(msg.channel)] !== "undefined") {
        bot.chat.send(msg.channel, {
            body: "Please!  Just one active snipe per channel at any given moment"
        });
        return;
    }
    var msgText = msg.content.text.body;
    var matchResults = msgText.match(/^\/cryptosnipe \+([0-9]+(?:[\.][0-9]*)?|\.[0-9]+)XLM@beemo/);
    if (matchResults === null) {
        bot.chat.send(msg.channel, {
            body: "Format is: \`\`\`/cryptosnipe +0.005XLM@beemo\`\`\`"
        });
        return;
    }
    var wager = parseFloat(matchResults[1]);
    if (!isNumber(wager)) {
        bot.chat.send(msg.channel, {
            body: "Wager must be in decimal format"
        });
        return;
    }
    if (wager <= 0) {
        bot.chat.send(msg.channel, {
            body: "Wager must be a positive amount"
        });
        return;
    }
    if (wager > 0.01) {
        // throw error, amount must be less than threshold
        bot.chat.send(msg.channel, {
            body: "Beemo is prototype stage software.  Please do not wager more than 0.01XLM"
        });
        return;
    }
    launchSnipe(wager, msg.channel);
}
function cancelFlip(conversationId, channel, err) {
    clearInterval(flipMonitorIntervals[conversationId]);
    bot.chat.send(channel, {
        body: "The flip has been cancelled due to error,\n     `" + err + "`,\n    and everyone is getting a refund"
    });
    activeSnipes[JSON.stringify(channel)].participants.forEach(function (participant) {
        processRefund(participant.transaction, channel);
    });
    activeSnipes[JSON.stringify(channel)] = undefined;
}
// Something to consider paging to disk or network
var flipMonitorIntervals = {};
function monitorFlipResults(msg) {
    flipMonitorIntervals[msg.conversationId] = setInterval((function () {
        try {
            bot.chat.loadFlip(msg.conversationId, msg.content.flip.flipConvId, msg.id, msg.content.flip.gameId).then(function (flipDetails) {
                if (flipDetails.phase === 2) {
                    resolveFlip(msg.channel, flipDetails.resultInfo.shuffle);
                    clearInterval(flipMonitorIntervals[msg.conversationId]);
                    activeSnipes[JSON.stringify(msg.channel)] = undefined;
                }
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
    bot.chat.edit(channel, messageId, {
        message: {
            body: ":clock" + allClocks[seconds % 12].toString() + ":" + (" betting stops in " + seconds + "s")
        }
    });
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
        var info, channel, message, error_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, bot.init(botUsername, paperkey)];
                case 1:
                    _a.sent();
                    info = bot.myInfo();
                    console.log("Bot initialized with username " + info.username + ".");
                    return [4 /*yield*/, bot2.init(botUsername, paperkey2)];
                case 2:
                    _a.sent();
                    console.log("Second key initialized");
                    console.log("Listening for all messages...");
                    channel = {
                        membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat"
                    };
                    message = {
                        body: "beemo has been restarted ... but is still in development mode.  please do not @ me.  Now in TypeScript!"
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
                                    if (msg.content.text && /^\/cryptosnipe/.test(msg.content.text.body)) {
                                        checkForSnipe(msg);
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
