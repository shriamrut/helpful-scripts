# Run GEMINI cli agent on an isolated docker container.

For more information, please visit - https://github.com/google-gemini/gemini-cli

## How to invoke the script?

### Pre-requisite
Install configure docker on the host / computer, where its planned to run

### Execution flow
1) Run the below command

```
bash gemini-cli-agent-bootstrap.sh
```
**Note** Incase you want to provide an alternative name for the container, provide the name as an argument like the below
```
bash gemini-cli-agent-bootstrap.sh <CUSTOM-CONTAINER-NAME>
```

2) It prompts for the gemini API key which can be obtained from https://aistudio.google.com/apikey

```
Info: Docker is installed and the daemon is running.
Using container name as gemini-cli-agent
Please enter your GEMINI_API_KEY: <GEMINI_API_KEY>
```

3) Once container is successfully up, will see the gemini CLI agent running and ready

```


   █████████  ██████████ ██████   ██████ █████ ██████   █████ █████
  ███░░░░░███░░███░░░░░█░░██████ ██████ ░░███ ░░██████ ░░███ ░░███
 ███     ░░░  ░███  █ ░  ░███░█████░███  ░███  ░███░███ ░███  ░███
░███          ░██████    ░███░░███ ░███  ░███  ░███░░███░███  ░███
░███    █████ ░███░░█    ░███ ░░░  ░███  ░███  ░███ ░░██████  ░███
░░███  ░░███  ░███ ░   █ ░███      ░███  ░███  ░███  ░░█████  ░███
 ░░█████████  ██████████ █████     █████ █████ █████  ░░█████ █████
  ░░░░░░░░░  ░░░░░░░░░░ ░░░░░     ░░░░░ ░░░░░ ░░░░░    ░░░░░ ░░░░░


Tips for getting started:
1. Ask questions, edit files, or run commands.
2. Be specific for the best results.
3. Create GEMINI.md files to customize your interactions with Gemini.
4. /help for more information.


>
```

