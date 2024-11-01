import { Command } from "@commander-js/extra-typings";
import { InvalidArgumentError } from "commander";
import packageJson from "../../package.json";

const allowedCommands = ["allow"] as const;
export type AllowedCommand = (typeof allowedCommands)[number];

export interface CommandArguments {
  username: string;
  labels: string[];
  command: AllowedCommand;
}

/**
 * Checks if the given string is a potential valid command, by checking if it starts with a slash character and is
 * contained within the list of allowed commands.
 */
export function isValidCommand(command: string) {
  const match = command.match(/^\/\S+/);

  if (!match) {
    return false;
  }
  return allowedCommands.includes(match[0].slice(1) as AllowedCommand);
}

function parseUser(value: string) {
  if (!value.length || value.length < 2) {
    throw new InvalidArgumentError("Username should be at least 2 characters long.");
  }
  if (value[0] !== "@") {
    throw new InvalidArgumentError("Username should start with @.");
  }
  // Remove @ character
  return value.slice(1);
}

function parseCommand(value: string) {
  if (!value.length || value.length < 2) {
    throw new InvalidArgumentError("Command should be at least 2 characters long.");
  }
  if (value[0] !== "/") {
    throw new InvalidArgumentError("Command should start with /.");
  }
  const slicedValue = value.slice(1) as AllowedCommand;
  if (!allowedCommands.includes(slicedValue)) {
    throw new InvalidArgumentError(`${value} is not a valid command.`);
  }
  // Remove slash character
  return slicedValue;
}

const commandParser = new Command()
  .name(" ")
  .usage("/<command> @<username> [labels...]")
  .argument("<command>", "The command to execute, e.g. /allow", parseCommand)
  .argument("<username>", "User name to allow rights to, e.g @UbiquityOS", parseUser)
  .argument("[labels...]", "Labels to allow, e.g time priority")
  .exitOverride()
  .version(packageJson.version);

// Overrides to make sure we do not use TTY outputs as they are not available outside Node.js env
commandParser.configureOutput({
  writeOut(str: string) {
    console.log(str);
  },
  writeErr(str: string) {
    console.error(str);
  },
  getErrHelpWidth(): number {
    return 0;
  },
  getOutHelpWidth(): number {
    return 0;
  },
});

export default commandParser;
