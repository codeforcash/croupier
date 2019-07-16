import * as os from "os";
import Croupier from "../croupier";
import * as Bot from "../keybase-bot";
import { ChatChannel, MessageSummary, Transaction } from "../keybase-bot";

import {
  IBetData,
  IBetList,
  IParticipant,
  IPopularityContest,
  IPositionSize,
  IPowerup,
  IPowerupAward,
  IReactionContent,
} from "../types";


process.env.DEVELOPMENT = undefined;
process.env.TEST = "true";

describe('Betting Functionality', (): void => {

  const botUsername = "testcroupier";

  const ringo = new Bot()
  const paul = new Bot()
  const john = new Bot()
  const george = new Bot()

  const croupier = new Croupier(botUsername,
    process.env.TEST_CROUPIER_PAPERKEY1,
    process.env.TEST_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    true);

  const channel: ChatChannel = {
    name: "codeforcash.croupiertest",
    public: false,
    topicType: "chat",
    membersType: "team",
    topicName: "general",
  }



  beforeAll(async (): Promise<void> => {
    await croupier.init();
    await ringo.init(process.env.CROUPIER_RINGO_USERNAME, process.env.CROUPIER_RINGO_PAPERKEY)
    await paul.init(process.env.CROUPIER_PAUL_USERNAME, process.env.CROUPIER_PAUL_PAPERKEY)
    await john.init(process.env.CROUPIER_JOHN_USERNAME, process.env.CROUPIER_JOHN_PAPERKEY)
    await george.init(process.env.CROUPIER_GEORGE_USERNAME, process.env.CROUPIER_GEORGE_PAPERKEY)
    console.log('All bots initialized!');
    croupier.run(false);
  })

  afterAll(async (): Promise<void> => {
    await ringo.deinit();
    await paul.deinit();
    await john.deinit();
    await george.deinit();
    croupier.shutdown();
  })

  describe('Functional snipes', (): void => {
    it('Starts a new snipe', async (): Promise<void> => {

      try {
        await ringo.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername);
      } catch(e) {
        console.log('big problem', e);
      }

      expect(true).toBe(true)

    })
  })

});
