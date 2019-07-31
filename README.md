# croupier

## Getting started

1. `npm install`
2. `npm install -g ts-node --save`
3. Create two paperkeys within Keybase for your bot (click the Devices tab within the Keybase GUI).
4. Set these envvars:

   - `CROUPIER_PAPERKEY_1`
   - `CROUPIER_PAPERKEY_2`
   - `MONGODB_USERNAME`
   - `MONGODB_PASSWORD`
   - `MONGODB_HOST`
   - `HONEYBADGER_API_KEY` # for uncaught exception logging. feel free to use another solution; see index.ts

5. Run the bot with `ts-node index.ts`

## Contributing

Contributions are welcome. Any new features should be accompanied by a test. To run the test suite, `yarn test --detectOpenHandles --verbose --forceExit`

Note: run `killall keybase` and `keybase ctl stop` before running test suite

## Releases

### All releases should more or less be stable.

- [Release v1](https://blog.codefor.cash/2019/07/01/finding-alice-and-bob-in-wonderland-a-writeup-of-croupier-the-keybase-bot/)

The next release is a work in progress and is expected some time in July. Join [@codeforcash](https://keybase.io/team/codeforcash) or [@mkbot#test3](https://keybase.io/team/mkbot#test3) on Keybase if you'd like to follow along.
