#!/bin/bash

WORKING_DIR=$5
HOME_DIR=$6
KB_TEAM=$1
KB_CHAN=$2
KB_AMT=$3
KB_RCPT=$4
KB_SPAWN="expect -c 'spawn ${WORKING_DIR}/keybase --home ${HOME_DIR} chat send --channel ${KB_TEAM} ${KB_CHAN} \"+${KB_AMT}XLM@${KB_RCPT}\" ; expect \"if you are sure\" ; send -- \"sendmoney\r\" ; expect eof'"
echo $KB_SPAWN
pushd $WORKING_DIR
eval $KB_SPAWN
popd
