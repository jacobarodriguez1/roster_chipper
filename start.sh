#!/bin/sh
set -e

# Run Prisma migrations against the persistent volume database
npx prisma migrate deploy

# Start the Next.js server
exec node server.js
