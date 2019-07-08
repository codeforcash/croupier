
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


async function main() {

  await bot.init(botUsername, paperkey);
	console.log('initialized.');


  // let res = await bot.team.listTeamMemberships({
  //   team: 'mkbot'
  // });

  // let all_members = [];
  // all_members = all_members.concat(res.members.owners.map(u => u.username));
  // all_members = all_members.concat(res.members.admins.map(u => u.username));
  // all_members = all_members.concat(res.members.writers.map(u => u.username));
  // all_members = all_members.concat(res.members.readers.map(u => u.username));

  // console.log(all_members);


  const channel: object = {
    membersType: "team", name: "mkbot", public: false, topicName: "test3", topicType: "chat",
  };

  bot.chat.send(channel, {
    body: 'This is a test'
  }).then((msgData) => {
    console.log(msgData);
    bot.chat.react(channel, msgData.id, '@zackburt').then((msgId) => {
      console.log('this is the msg id from the reaction itself....', msgId.id);
    });
  })

  await bot.chat.watchAllChannelsForNewMessages(
    async (msg) => {
      try {
        console.log(msg);
        if(msg.content.type === 'reaction') {
          let reactionId = msg.id;
          let reaction = msg.content.reaction;
          // reaction.m; // messageId they are reacting to
          // reaction.b; // the reaction itself
          console.log('They are reacting to: ', reaction.m); // parent message id.  NOT the reaction id.
        }
        if(msg.content.type === 'delete') {
          let deleteReactionIds = msg.content.delete.messageIDs;
          console.log('delete reaction IDs', deleteReactionIds); // reaction id.
        }
      } catch (err) {
        console.error(err);
      }
    },
    (e) => console.error(e),
  );
}

main();
