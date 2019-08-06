
// /*

// Just a REPL type file to facilitate feature development

// */

import * as _ from "lodash";
import * as os from "os";
import * as Bot from "./keybase-bot";

import "source-map-support/register";

const bot: Bot = new Bot(os.homedir());

const botUsername: string = "zackburt2";
const paperkey: string = process.env.ZACKBURT2_PAPERKEY;

async function main(): Promise<any> {

  await bot.init(botUsername, paperkey);
  console.log("initialized.");

  await bot.chat.listHere('cryptosnipe', 'mkbot').then((data) => {
    console.log('...data!');
    console.log(data.map((x) => x.toString()));
  });
}

main();

// conversationId: '',
//   flipConvId: '',
//   msgId: 7474,
//   gameId: ''

  // const channel: object = {
  //   membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat",
  // };

  // bot.chat.send(channel, {
  //   body: 'This is a test'
  // }).then((msgData) => {
  //   console.log(msgData);
  //   bot.chat.react(channel, msgData.id, '@zackburt').then((msgId) => {
  //     console.log('this is the msg id from the reaction itself....', msgId.id);
  //   });
  // })

// function monitorFlip(msg) {
//   try {
//     bot.chat.loadFlip(
//       msg.conversationId,
//       msg.content.flip.flipConvId,
//       msg.id,
//       msg.content.flip.gameId,
//     ).then((flipDetails) => {
//       console.log('flip details', flipDetails);
//     }).catch((err) => {
//       console.log('err', err);
//     });
//   } catch (err) {
//     console.log('err', err);
//   }

// }

// function makeSubteamForFlip(): void {

//   const subteamName: string = `croupierflips.snipeZBTEST`;

//   const usernamesToAdd: Array<object> = [{username: "croupier", role: "admin"}];

//   usernamesToAdd.push({
//     role: "reader",
//     username: 'zackburt',
//   });

//   bot.team.createSubteam(subteamName).then((res) => {

//     console.log('Subteam creation was successful', res);
//     bot.team.addMembers({
//       team: subteamName,
//       usernames: usernamesToAdd,
//     }).then((addMembersRes) => {
//       const newSubteam: any = {
//         membersType: "team", name: subteamName,
//       };
//       bot.chat.send(newSubteam, {
//         body: 'hello '
//       });
//     });
//   });

// }
