#!/usr/bin/env node

import { quickstart } from "./commands/quickstart";
import { ping } from "./commands/ping";
import { dim, c, LOGO } from "./ui";

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case "quickstart":
  case undefined:
    quickstart();
    break;
  case "ping":
    ping(arg);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log("");
    console.log(`  ${LOGO}  ${dim("CLI for the Morlock protocol")}`);
    console.log("");
    console.log(`  ${c("morlock quickstart")}          Interactive walkthrough for site owners`);
    console.log(`  ${c("morlock ping <domain>")}       Probe a site's /.well-known/morlock manifest`);
    console.log("");
    console.log(`  ${dim("Docs:")} https://github.com/morlock-protocol/morlock`);
    console.log("");
    break;
  default:
    console.log("");
    console.log(`  ${LOGO}`);
    console.log("");
    console.log(`  Unknown command: ${c(command)}`);
    console.log(`  ${dim("Try:")}  ${c("morlock help")}`);
    console.log("");
    process.exit(1);
}
