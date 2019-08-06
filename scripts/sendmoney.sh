#!/bin/bash

KB_TEAM=$1
KB_CHAN=$2
KB_AMT=$3
KB_RCPT=$4
EXTRA_PARAMS=$5
IMPTEAMNATIVE=$6
WORKING_DIR=$7
HOME_DIR=$8


if [ $IMPTEAMNATIVE == "true" ]; then
	KB_SPAWN="expect -c 'spawn ${WORKING_DIR}/keybase --home ${HOME_DIR} chat send \"${KB_TEAM}\" \"+${KB_AMT}XLM@${KB_RCPT} ${EXTRA_PARAMS}\" ; expect \"if you are sure\" ; send -- \"sendmoney\r\" ; expect eof'"
else
	KB_SPAWN="expect -c 'spawn ${WORKING_DIR}/keybase --home ${HOME_DIR} chat send --channel ${KB_CHAN} ${KB_TEAM} \"+${KB_AMT}XLM@${KB_RCPT} ${EXTRA_PARAMS}\" ; expect \"if you are sure\" ; send -- \"sendmoney\r\" ; expect eof'"
fi

echo $KB_SPAWN
eval $KB_SPAWN
process_id=`/bin/ps -fu $USER| grep "expect" | grep -v "grep" | awk '{print $2}'`
echo $process_id
wait $process_id
echo "Ah"
