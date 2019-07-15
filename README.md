# croupier

## Getting started

1. `npm install`
2. `npm install -g ts-node --save`
3. Create a MySQL table:
```
CREATE TABLE `snipes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `channel` text,
  `participants` text,
  `winner` text,
  `was_cancelled` tinyint(1) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `in_progress` tinyint(1) NOT NULL DEFAULT '1',
  `cancellation_reason` text,
  `countdown` int(11) NOT NULL,
  `position_sizes` text,
  `blinds` longtext,
  `betting_started` text,
  `pot_size` int(11) DEFAULT NULL,
  `clock_remaining` bigint(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB`
```
4. Create two paperkeys within Keybase for your bot (click the Devices tab within the Keybase GUI).
5. Set these envvars:

    * `CROUPIER_PAPERKEY_1`
    * `CROUPIER_PAPERKEY_2`
    * `MYSQL_DB`
    * `MYSQL_HOST`
    * `MYSQL_PASSWORD`
    * `MYSQL_USER`
6. Run the bot with `ts-node index.ts`


## Releases
### All releases should more or less be stable.

* [Release v1](https://blog.codefor.cash/2019/07/01/finding-alice-and-bob-in-wonderland-a-writeup-of-croupier-the-keybase-bot/)

The next release is a work in progress and is expected some time in July.  Join [@codeforcash](https://keybase.io/team/codeforcash) or [@mkbot#test3](https://keybase.io/team/mkbot#test3) on Keybase if you'd like to follow along.
