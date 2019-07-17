#!/bin/bash

WORKING_DIR=$5
HOME_DIR=$6
KB_TEAM=$1
KB_CHAN=$2
KB_AMT=$3
KB_RCPT=$4
KB_SPAWN="expect -c 'spawn ${WORKING_DIR}/keybase chat send --channel ${KB_CHAN} ${KB_TEAM} \"+${KB_AMT}XLM@${KB_RCPT}\" ; expect \"if you are sure\" ; send -- \"sendmoney\r\" ; expect eof'"
echo $KB_SPAWN
eval $KB_SPAWN
process_id=`/bin/ps -fu $USER| grep "expect" | grep -v "grep" | awk '{print $2}'`
echo $process_id
wait $process_id
echo "Ah"
