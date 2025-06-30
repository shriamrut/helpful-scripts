#!/bin/bash

# Prompt the user to enter the GEMINI_API_KEY
read -p "Please enter your GEMINI_API_KEY: " GEMINI_API_KEY

# Build the Docker image
docker build -t gemini-cli-agent:latest .

# Run the Docker container, passing the API key as an environment variable
# and executing the 'gemini command' within the container.
docker run -i -t --name gemini-cli-agent -e GEMINI_API_KEY="$GEMINI_API_KEY" gemini-cli-agent sh -c "gemini"
