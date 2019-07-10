#!/bin/bash

TEAM_NAME=$1
WORKING_DIR=$2
HOME_DIR=$3
KB_SPAWN="${WORKING_DIR}/keybase --home ${HOME_DIR} team create '${TEAM_NAME}'"
echo $KB_SPAWN
eval $KB_SPAWN
