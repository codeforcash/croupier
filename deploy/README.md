1. `apt-get install docker-compose`
2. `usermod -aG docker`
3. Log out and log back into shell
4. Copy the deploy/ folder to the server
5. Update docker-compose.yaml with your envvars
6. Update 0_scripts/start.sh with your envvars
7. `chmod +x 0_scripts/start.sh`; `chmod +x 0_scripts/sendmoney.sh`
8. Copy the scripts in the root directory to 0_scripts/ on the production box
9. `docker build --no-cache -t keybase_croupier .`
10. `docker-compose up croupier`
