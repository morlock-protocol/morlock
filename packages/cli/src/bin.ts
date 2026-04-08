#!/usr/bin/env node

import { quickstart } from "./commands/quickstart";
import { ping } from "./commands/ping";
import { badge } from "./commands/badge";
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
  case "badge":
    badge(arg);
    break;
  default:
    console.log("");
    console.log(`  ${LOGO}`);
    console.log("");
    console.log(`  Nothing by that name down here.`);
    console.log(`  ${dim("Known passages:")}  ${c("quickstart")}  ${c("ping")}  ${c("badge")}`);
    console.log("");
    process.exit(1);
}
