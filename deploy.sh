#!/bin/bash
# Sends the current local app files to the AWS server and restarts it.
# Usage: DEPLOY_KEY=~/path/to/key.pem DEPLOY_HOST=user@host ./deploy.sh
set -e

if [ -z "$DEPLOY_KEY" ] || [ -z "$DEPLOY_HOST" ]; then
  echo "Set DEPLOY_KEY and DEPLOY_HOST env vars first (see deploy.sh.example)." >&2
  exit 1
fi

KEY="$DEPLOY_KEY"
SERVER="$DEPLOY_HOST"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/home/ubuntu/shipmentscope}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new"

echo "Sending files..."
ssh $SSH_OPTS -i "$KEY" "$SERVER" "mkdir -p $REMOTE_DIR/assets"
scp $SSH_OPTS -i "$KEY" server.js "PokéOrders.html" admin.html package.json "$SERVER:$REMOTE_DIR/"
scp $SSH_OPTS -i "$KEY" assets/logo.png assets/product-box.png assets/product-card.png "$SERVER:$REMOTE_DIR/assets/"

echo "Renaming and restarting on the server..."
ssh $SSH_OPTS -i "$KEY" "$SERVER" "cd $REMOTE_DIR && mv 'PokéOrders.html' app.html && sed -i 's/PokéOrders\.html/app.html/g' server.js && npm install --production && pm2 restart shipmentscope"

echo "Done. Check https://shipmentscope.com or your server IP."
