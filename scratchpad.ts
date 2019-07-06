
// /*

// Just a REPL type file to facilitate feature development

// */

import * as os from "os";
import * as Bot from "./keybase-bot";

import "source-map-support/register";

const bot: Bot = new Bot(os.homedir());

const botUsername: string = "croupier";
const paperkey: string = process.env.CROUPIER_PAPERKEY_1;


async function main() {

	await bot.init(botUsername, paperkey);
	console.log('initialized.');

  bot.wallet.lookup('zackburt').then((acct) => {
    console.log(acct);

    bot.wallet.balances(acct.accountId).then((balances) => {
      console.log(balances);
      balances.forEach((acctDetail) => {
        console.log(acctDetail.balance[0].amount)
      });

    }).catch((e) => {
      console.log(e);
    })


  }).catch((e) => {
    console.log(e);
  })
  // let res = await bot.team.listTeamMemberships({
  //   team: 'mkbot'
  // });

  // let all_members = [];
  // all_members = all_members.concat(res.members.owners.map(u => u.username));
  // all_members = all_members.concat(res.members.admins.map(u => u.username));
  // all_members = all_members.concat(res.members.writers.map(u => u.username));
  // all_members = all_members.concat(res.members.readers.map(u => u.username));

  // console.log(all_members);



    // await bot.chat.watchAllChannelsForNewMessages(
    //   async (msg) => {
    //     try {
    //       if (msg.content.type === "flip") {

    //         setInterval((() => {
    //           try {
    //             bot.chat.loadFlip(
    //               msg.conversationId,
    //               msg.content.flip.flipConvId,
    //               msg.id,
    //               msg.content.flip.gameId,
    //             ).then((flipDetails) => {
    //               if (flipDetails.phase === 2) {
    //                 console.log("results are in");
    //                 console.log(msg.channel, flipDetails.resultInfo.number);
    //               } else {
    //                 console.log("results are NOT in yet");
    //               }
    //             }).catch((err) => {
    //               console.log('type 1 error');
    //               console.log(err);
    //             });
    //           } catch (err) {
    //             console.log('type 2 error');
    //             console.log(err);
    //           }
    //         }), 1000);

    //       }
    //     } catch (err) {
    //       console.error(err);
    //     }
    //   },
    //   (e) => console.error(e),
    // );


}

main();
