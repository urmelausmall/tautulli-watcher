docker buildx create --use --name multi

docker buildx inspect --bootstrap

docker buildx build \
--platform linux/amd64,linux/arm64 \
-t urmelausmall/tautulli-watcher:latest \
-t urmelausmall/tautulli-watcher:0.1 \
--push \
./tautulli-watcher