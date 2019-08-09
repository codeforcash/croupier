# croupier

## Application architecture

### Croupier class

`Croupier` is the bot class. It talks to the database (MongoDB) and talks to Keybase, listening to incoming messages and responding accordingly (see `Croupier.routeIncomingMessage`). Each round is coded as an instance of the `Snipe` class, which manages the game logic. All active snipes are stored in Croupier's `activeSnipes` property, an object with key = JSON strigified Keybase `ChatChannel` and value = `Snipe` instance. This data structure makes sense because there can only be one concurrent snipe per channel.

Note: Due to technical limitations, we cannot read exploding messages from a paper key; therefore, one bot is run as `initFromRunningService` with a provisioned device (see deploy/0_scripts/start.sh).

### Snipe class

This class handles game logic. If you want to modify game behavior, check out this class.

There are many active `NodeJS.Timer` timers within the Snipe, that handle things like polling for the `/flip` results and counting down the game timer.

## Getting started

### Requirements

- MongoDB (if you're running the bot locally)
- Unixy OS (macOS, WSL, Linux, et al): Croupier talks to Keybase via keybase-bot, which relies on non-Windows commands (namely `which`)
- `expect` command (`apt-get install expect`)
- Some Lumens to fund the bot accounts (each bot needs at least 2.01XLM to function)

### Steps

1. Create two bot accounts on Keybase (one to use `/flip` and the other to read the result), and within Keybase, generate a paper key for each account
2. Install MongoDB and get it running
3. `npm install`
4. Set these envvars:

   - `CROUPIER_PAPERKEY_1`
   - `CROUPIER_PAPERKEY_2`
   - `MONGODB_USERNAME`
   - `MONGODB_PASSWORD`
   - `MONGODB_HOST`
   - `HONEYBADGER_API_KEY` # for uncaught exception logging. feel free to use another solution; see index.ts
   - `SUBTEAM_NAME` # in the event that a flip does not complete, either due to duplicate registration issues or someone joining/leaving during the flip, Croupier will initiate a new flip in a separate team under its control. Therefore, you should create a Keybase team and invite your bot and give it admin privileges (so it may dynamically create _subteams_ for the re flips).

5. Run the bot with `npm run start`

## Contributing

Contributions are welcome. Any new features should be accompanied by a test. To run the test suite, `yarn test --detectOpenHandles --verbose --forceExit`

Note: run `killall keybase` and `keybase ctl stop` before running test suite

## Releases

### All releases should more or less be stable.

- [Release v0.1](https://blog.codefor.cash/2019/07/01/finding-alice-and-bob-in-wonderland-a-writeup-of-croupier-the-keybase-bot/)
- [Release v0.2](https://blog.codefor.cash/2019/08/09/announcing-v0-2-of-croupier-the-keybase-sweepstakes-bot/)

The next release is a work in progress and is expected some time in August. Join [@codeforcash](https://keybase.io/team/codeforcash) or [@mkbot#test3](https://keybase.io/team/mkbot#test3) on Keybase if you'd like to follow along.
