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

function timeout(time: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}

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



  beforeAll(async (done): Promise<void> => {
    Promise.all([
      ringo.init(process.env.CROUPIER_RINGO_USERNAME, process.env.CROUPIER_RINGO_PAPERKEY),
      paul.init(process.env.CROUPIER_PAUL_USERNAME, process.env.CROUPIER_PAUL_PAPERKEY),
      john.init(process.env.CROUPIER_JOHN_USERNAME, process.env.CROUPIER_JOHN_PAPERKEY),
      george.init(process.env.CROUPIER_GEORGE_USERNAME, process.env.CROUPIER_GEORGE_PAPERKEY),
    ]).then(async (res) => {
      await croupier.run(false);
      console.log('croupier is running');
      done();
    });
  });

  afterAll(async (): Promise<void> => {
    console.log('de initializing ringo');
    await ringo.deinit();
    await paul.deinit();
    await john.deinit();
    await george.deinit();
    await croupier.shutdown();
  })

  describe('Functional snipes', (): void => {
    it('starts a new snipe', async (): Promise<void> => {
      const exitCode = await ringo.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername);
      console.log('exitCode', exitCode);
      await timeout(3000)
      expect(true).toBe(true);
    })

    test('?', () => {
      expect(false).toBe(true);
    })

  })

});
