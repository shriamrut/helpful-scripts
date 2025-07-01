#!/bin/bash

# Check if docker is installed and running
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed."
  exit 1
elif ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is installed but the daemon is not running."
  exit 1
else
  echo "Info: Docker is installed and the daemon is running."
fi

CONTAINER_NAME="${1:-gemini-cli-agent}"

echo "Using container name as $CONTAINER_NAME"

# Check if the container with same name exists
if docker ps -a --format '{{.Names}}' | grep -wq "$CONTAINER_NAME"; then
  echo "Error: Container '$CONTAINER_NAME' already exists. Please remove or rename the container or use a different name in argument." >&2
  exit 1
fi

# Prompt the user to enter the GEMINI_API_KEY
read -p "Please enter your GEMINI_API_KEY: " GEMINI_API_KEY

# Build the Docker image
docker build -t gemini-cli-agent:latest .

# Run the Docker container, passing the API key as an environment variable
# and executing the 'gemini command' within the container.
docker run -i -t --name $CONTAINER_NAME -e GEMINI_API_KEY="$GEMINI_API_KEY" gemini-cli-agent sh -c "gemini"

# Remove the container with name $CONTAINER_NAME when exiting
docker rm $CONTAINER_NAME
