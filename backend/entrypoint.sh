#!/bin/sh
set -e

echo "Running Alembic migrations..."
alembic upgrade head

echo "Starting BuzzerMinds backend..."
exec python -m buzzerminds_backend
