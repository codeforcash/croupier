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

NOTE:

The first time you launch the docker file, you are going to need to:

1. Replace `keybase service &` in start.sh with `while true; do echo 'while'; sleep 2s; done`
2. Build the dockerfile, `docker build -t keybase_croupier .`
3. Start the container, `docker-compose up -d croupier`
4. Attach to a bash process, `docker-compose exec croupier bash`
5. And provision the container device for Keybase: `keybase login`

Once you have authorized the device:

1. Replace `while true; do echo 'while'; sleep 2s; done` with `keybase service &`
2. Rebuild the Dockerfile, `docker build -t keybase_croupier .`
3. You're good to go, with `docker-compose up -d croupier`

## Debugging issues

1. `docker-compose exec croupier bash` to start a bash prompt within container
2. `tail /home/keybase/node_log`

### Analyzing the logs on local machine

1. Use `docker ps` to find container id
2. `docker cp CONTAINER_ID:/home/keybase/node_log .`
3. scp it to your local machine or just check on the server
