# croupier

## Getting started

1. Create two bot accounts (one to use `/flip` and the other to read the result)
   - Note: the bot with `DEV_CROUPIER_USERNAME1` is the Main bot
2. Create two paperkeys within Keybase for your bots (click the Devices tab within the Keybase GUI).
3. `npm install`
4. Set these envvars:

   - `DEV_CROUPIER_USERNAME1`
   - `DEV_CROUPIER_USERNAME2`
   - `DEV_CROUPIER_PAPERKEY1`
   - `DEV_CROUPIER_PAPERKEY2`
   - `MONGODB_USERNAME`
   - `MONGODB_PASSWORD`
   - `MONGODB_HOST`
   - `IS_CLUSTER` (true or false)

5. Verify you have an instance of Mongo running somewhere
6. `npm run start`

### Requirements

- MongoDB (if you're running the bot locally)
- Unix/Linux Server - Croupier relies on non-Windows commands (namely `which`)
- `expect` command (`apt-get install expect`)
- Some Lumens to fund the bot accounts (Main bot needs at least 1XLM to function)

## Contributing

Contributions are welcome. Any new features should be accompanied by a test. To run the test suite, `yarn test --detectOpenHandles --verbose --forceExit`

Note: run `killall keybase` and `keybase ctl stop` before running test suite

## Releases

All releases should more or less be stable.

- [Release v1](https://blog.codefor.cash/2019/07/01/finding-alice-and-bob-in-wonderland-a-writeup-of-croupier-the-keybase-bot/)

The next release is a work in progress and is expected some time in July.

Join [@codeforcash](https://keybase.io/team/codeforcash) or [@mkbot#test3](https://keybase.io/team/mkbot#test3) on Keybase if you'd like to follow along.
