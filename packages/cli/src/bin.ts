#!/usr/bin/env node

import { quickstart } from "./commands/quickstart";

const command = process.argv[2];

if (command === "quickstart" || !command) {
  quickstart();
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
