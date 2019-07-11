
// /*

// Just a REPL type file to facilitate feature development

// */

import * as os from "os";
import * as Bot from "./keybase-bot";
import * as _ from "lodash";

import "source-map-support/register";

const bot: Bot = new Bot(os.homedir());

const botUsername: string = "croupier";
const paperkey: string = process.env.CROUPIER_PAPERKEY_1;


function makeSubteamForFlip(): void {

  const subteamName: string = `croupierflips.snipeZBTEST`;

  const usernamesToAdd: Array<object> = [{username: "croupier", role: "admin"}];

  usernamesToAdd.push({
    role: "reader",
    username: 'zackburt',
  });

  bot.team.createSubteam(subteamName).then((res) => {

    console.log('Subteam creation was successful', res);
    bot.team.addMembers({
      team: subteamName,
      usernames: usernamesToAdd,
    }).then((addMembersRes) => {
      const newSubteam: any = {
        membersType: "team", name: subteamName,
      };
      bot.chat.send(newSubteam, {
        body: 'hello '
      });
    });
  });

}

async function main() {

  await bot.init(botUsername, paperkey);
	console.log('initialized.');


  await bot.chat.watchAllChannelsForNewMessages(
    async (msg) => {
      try {
        console.log(msg);
        if (msg.content.type === "flip") {
          return;
        }
      } catch (err) {
        console.error(err);
      }
    },
    (e) => console.error(e),
  );
}

main();

// {"method": "send", "params": {"options": {"channel": {"name": "mkbot", "members_type": "team", "topic_name": "test3"}, "message": {"body": "test"}}}}


// conversationId: '',
//   flipConvId: '',
//   msgId: 7474,
//   gameId: ''

// keybase chat api -m '{"method": "loadflip", "params": {"options": {"conversation_id": "000044e620fef1e84b623350faff06ebef7a0cd7e403ba81a1b35d311976b9f6", "flip_conversation_id": "000076eed094f4f90020f18a058e772948a2666f0fd638570e2cd80925f51d67", "msg_id": 7474, "game_id": "5982849cac921d68528468ac"}}}'



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
