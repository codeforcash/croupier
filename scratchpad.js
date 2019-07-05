"use strict";
exports.__esModule = true;
var moment = require("moment");
var snipeDone = moment().add(70, 'seconds');
console.log(moment().to(snipeDone));
// /*
// Just a REPL type file to facilitate feature development
// */
// import * as os from "os";
// import * as Bot from "./keybase-bot";
// import "source-map-support/register";
// const bot: Bot = new Bot(os.homedir());
// const botUsername: string = "croupier";
// const paperkey: string = process.env.CROUPIER_PAPERKEY_1;
// async function main() {
// 	await bot.init(botUsername, paperkey);
// 	console.log('initialized.');
//     await bot.chat.watchAllChannelsForNewMessages(
//       async (msg) => {
//         try {
//           if (msg.content.type === "text" && msg.content.text.payments && msg.content.text.payments.length === 1) {
//             console.log(msg.content.text.body);
//           }
//         } catch (err) {
//           console.error(err);
//         }
//       },
//       (e) => console.error(e),
//     );
// 	// bot.wallet.details('7713b51be0af635e92351f0e6650aed0d644ebe3d4881b8f776477931decfdd0').then(details => {
// 	// 	console.log('details', details.status, details.feeChargedDescription);
// 	// 	const xlmFeeMatch = details.feeChargedDescription.match(/(\d\.\d+) XLM/);
// 	// 	if (xlmFeeMatch !== null) {
// 	// 		const fee = xlmFeeMatch[1]
// 	// 		console.log('fee', fee);
// 	// 	}
// 	// });
// }
// main();
