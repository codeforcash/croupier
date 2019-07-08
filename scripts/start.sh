#!/bin/bash

# start keybase service without kbfs and gui
keybase oneshot --username croupier --paperkey "warrior laugh mother jazz curve permit country hedgehog honey jazz abuse poverty sense"
run_keybase -fg

# put the commands to run at startup here
sudo pacman -Scc

keybase chat send $BOT_OWNER "$(date) - starting bot"

sudo npm install -g typescript
killall keybase
rm -rf croupier 
git clone https://github.com/codeforcash/croupier.git
cd croupier
npm install
tsc --lib es2015 index.ts
node index.js

