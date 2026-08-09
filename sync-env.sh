#!/bin/bash
cp .env apps/web/.env.local
cp .env apps/server/.env
echo "synced .env -> apps/web/.env.local, apps/server/.env"
