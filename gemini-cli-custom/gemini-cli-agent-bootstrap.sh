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

# Build the Docker image
docker build -t gemini-cli-agent:latest .
if [ $? -ne 0 ]; then
  echo "Error: Docker image build failed."
  exit 1
fi

# Check if the container exists
if docker ps -a --format '{{.Names}}' | grep -wq "$CONTAINER_NAME"; then
  # If the container exists but is not running, start it
  if ! docker ps --format '{{.Names}}' | grep -wq "$CONTAINER_NAME"; then
    echo "Info: Starting existing container '$CONTAINER_NAME'."
    docker start "$CONTAINER_NAME"
  else
    echo "Info: Reusing running container '$CONTAINER_NAME'."
  fi
  # Exec into the running container and run the gemini command
  docker exec -it "$CONTAINER_NAME" sh -c "gemini"
else
  # Run a new container if it doesn't exist
  # Prompt the user to enter the GEMINI_API_KEY
  read -p "Please enter your GEMINI_API_KEY (Hint: Get it from https://aistudio.google.com/apikey) : " GEMINI_API_KEY
  docker run -i -t --name "$CONTAINER_NAME" -e GEMINI_API_KEY="$GEMINI_API_KEY" gemini-cli-agent sh -c "gemini"
  if [ $? -ne 0 ]; then
    echo "Error: Docker container failed to run."
    exit 1
  fi
fi
