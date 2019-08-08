#!/bin/bash

# put the commands to run at startup here
sudo pacman -Scc

keybase service &

sudo npm install -g typescript
killall keybase
rm -rf croupier
git clone https://github.com/codeforcash/croupier.git
cd croupier
npm install
tsc --lib es2015 index.ts
node index.js 2>&1 >> /home/keybase/node_log
