#!/bin/bash

WORKING_DIR=$5
HOME_DIR=$6
CONVERSATION_ID=$1
FLIP_CONVERSATION_ID=$2
MSG_ID=$3
GAME_ID=$4
KB_SPAWN="${WORKING_DIR}/keybase --home ${HOME_DIR} chat api -m '{\"method\": \"loadflip\", \"params\": {\"options\": {\"conversation_id\": \"${CONVERSATION_ID}\", \"flip_conversation_id\": \"${FLIP_CONVERSATION_ID}\", \"msg_id\": ${MESSAGE_ID}, \"game_id\": \"${GAME_ID}\"}}}'"
echo $KB_SPAWN
eval $KB_SPAWN
