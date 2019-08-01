# Getting the bot deployed to production

1. `apt-get install docker-compose`
2. `usermod -aG docker`
3. Log out and log back into shell
4. Copy the deploy/ folder to the server
5. Rename `docker-compose.yaml.example` to `docker-compose.yaml` and update with your envvars
6. Update 0_scripts/start.sh with your envvars
7. `chmod +x 0_scripts/*`
8. Copy the scripts in the root directory to 0_scripts/ on the production box
9. `docker build --no-cache -t keybase_croupier .`
10. `docker-compose up -d croupier`

## Debugging issues

1. Use `docker ps` to find the container id
2. `docker exec -ti CONTAINER_ID bash` to start a bash prompt within container
3. `tail /home/keybase/node_log`

### Analyzing the logs on local machine

1. Use `docker ps` to find container id
2. `docker cp CONTAINER_ID:/home/keybase/node_log .`
3. scp it to your local machine or just check on the server
