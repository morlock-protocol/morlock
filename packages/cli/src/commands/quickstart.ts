#!/usr/bin/env node

import * as readline from "readline";

const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  white:   "\x1b[97m",
  gray:    "\x1b[90m",
  bgBlack: "\x1b[40m",
};

const g   = (s: string): string => `${C.green}${s}${C.reset}`;
const c   = (s: string): string => `${C.cyan}${s}${C.reset}`;
const y   = (s: string): string => `${C.yellow}${s}${C.reset}`;
const dim = (s: string): string => `${C.dim}${C.gray}${s}${C.reset}`;
const b   = (s: string): string => `${C.bold}${s}${C.reset}`;
const w   = (s: string): string => `${C.white}${s}${C.reset}`;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function clearScreen(): void { process.stdout.write("\x1bc"); }

function typewrite(text: string, delay = 18): Promise<void> {
  return new Promise(resolve => {
    let i = 0;
    const tick = (): void => {
      if (i < text.length) {
        process.stdout.write(text[i++]);
        setTimeout(tick, delay);
      } else {
        process.stdout.write("\n");
        resolve();
      }
    };
    tick();
  });
}

async function printLines(lines: string[], opts: { lineDelay?: number; typeFirst?: boolean } = {}): Promise<void> {
  const { lineDelay = 60, typeFirst = false } = opts;
  for (let i = 0; i < lines.length; i++) {
    if (typeFirst && i === 0) {
      await typewrite(lines[i], 20);
    } else {
      console.log(lines[i]);
    }
    if (i < lines.length - 1) await sleep(lineDelay);
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, (answer: string) => { rl.close(); resolve(answer.trim()); });
  });
}

function hr(): void { console.log(dim("\u2500".repeat(56))); }

function header(step: number, total: number, title: string): void {
  console.log("");
  console.log(dim(`  step ${step} of ${total}`));
  console.log(`  ${b(w(title))}`);
  console.log("");
}

async function waitForEnter(label = "Press Enter to continue"): Promise<void> {
  await prompt(`  ${dim(`[ ${label} ]`)} `);
}

// ─── Screens ──────────────────────────────────────────────────────────────────

async function screenWelcome(): Promise<void> {
  clearScreen();
  console.log("");
  console.log(`  ${g("\u2593\u2593")} ${b(w("Morlock"))}  ${dim("quickstart")}`);
  console.log(`  ${dim("Make your site natively agent-friendly.")}`);
  console.log("");
  hr();
  console.log("");
  console.log("  This walkthrough will:");
  console.log("");
  console.log(`   ${g("1.")} Install ${c("@morlock/core")}`);
  console.log(`   ${g("2.")} Add the middleware to your server`);
  console.log(`   ${g("3.")} Define your first command`);
  console.log(`   ${g("4.")} Show you your live agent manifest`);
  console.log(`   ${g("5.")} Simulate an AI agent discovering you`);
  console.log("");
  hr();
  console.log("");
  await waitForEnter("Let's go");
}

async function screenInstall(): Promise<void> {
  clearScreen();
  header(1, 5, "Install Morlock");

  console.log(`  Add ${c("@morlock/core")} to your project.`);
  console.log(`  ${dim("Works with Express, Next.js, Cloudflare Workers, Bun, Deno.")}`);
  console.log("");
  hr();
  console.log("");

  console.log(`  ${g("$")} ${w("npm install @morlock/core")}`);
  console.log("");
  await sleep(600);

  const frames = ["\u280B","\u2819","\u2839","\u2838","\u283C","\u2834","\u2826","\u2827","\u2807","\u280F"];
  let fi = 0;
  const spin = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan}${frames[fi++ % frames.length]}${C.reset}  ${dim("fetching @morlock/core...")}`);
  }, 80);

  await sleep(2200);
  clearInterval(spin);
  process.stdout.write("\r" + " ".repeat(48) + "\r");

  await printLines([
    `  ${dim("added 1 package in 0.8s")}`,
    `  ${g("\u2713")}  ${w("@morlock/core")} installed`,
  ], { lineDelay: 120 });

  console.log("");
  console.log(`  ${dim("That's the only dependency. No build step, no config files yet.")}`);
  console.log("");
  await waitForEnter();
}

async function screenMiddleware(): Promise<void> {
  clearScreen();
  header(2, 5, "Add the middleware");

  console.log("  Mount Morlock on your existing server in two lines.");
  console.log(`  ${dim("No new process. No separate port. It attaches to what you already have.")}`);
  console.log("");
  hr();
  console.log("");

  await printLines([
    `  ${dim("// server.js (Express example)")}`,
  ]);
  await sleep(200);

  const code = [
    `  ${c("import")} { morlock } ${c("from")} ${y("'@morlock/core/express'")}`,
    "",
    `  ${c("const")} app ${g("=")} express()`,
    "",
    `  app.${w("use")}(morlock({`,
    `    name:    ${y('"my-app"')},`,
    `    version: ${y('"1.0.0"')},`,
    "  }))",
  ];

  for (const line of code) {
    console.log(line);
    await sleep(70);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  That's it. Morlock is now running alongside your app.`);
  console.log("");
  console.log(`  ${dim("Adapters available:")}  express  next  cloudflare  bun  deno`);
  console.log("");
  await waitForEnter();
}

async function screenCommands(): Promise<void> {
  clearScreen();
  header(3, 5, "Define your first command");

  console.log(`  Commands are what AI agents can ${b("do")} on your site.`);
  console.log(`  ${dim("Each one has a name, typed inputs, and a handler. Plain TypeScript.")}`);
  console.log("");
  hr();
  console.log("");

  const name = await prompt(`  ${g("?")}  What should your first command do? ${dim("(e.g. search, get-user, list-products)")}  `);
  const cmdName = name.replace(/\s+/g, "-").toLowerCase() || "search";

  console.log("");
  await sleep(300);

  const code = [
    `  ${dim("// morlock.config.ts")}`,
    "",
    "  commands: [",
    "    {",
    `      name:    ${y(`"${cmdName}"`)},`,
    `      input:   { query: ${c("string")} },`,
    `      handler: ${c("async")} ({ query }) ${g("=>")} {`,
    `        ${dim("// your logic here")}`,
    `        ${c("return")} { results: [] }`,
    "      }",
    "    }",
    "  ]",
  ];

  for (const line of code) {
    console.log(line);
    await sleep(55);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  Command ${c(`"${cmdName}"`)} registered.`);
  console.log(`  ${dim("You can add as many commands as you like.")}`);
  console.log("");
  await waitForEnter();
}

async function screenManifest(): Promise<void> {
  clearScreen();
  header(4, 5, "Your manifest goes live");

  console.log(`  Morlock automatically exposes ${c("/.well-known/morlock")} on your domain.`);
  console.log(`  ${dim("This is what AI agents read to understand what your site can do.")}`);
  console.log("");
  hr();
  console.log("");

  console.log(`  ${g("$")} ${w("curl https://your-app.com/.well-known/morlock")}`);
  console.log("");
  await sleep(800);

  const manifest = [
    `  ${y("{")}`,
    `    ${c('"morlock"')}:   ${y('"0.1"')},`,
    `    ${c('"name"')}:     ${y('"my-app"')},`,
    `    ${c('"version"')}:  ${y('"1.0.0"')},`,
    `    ${c('"commands"')}: [${y('"search"')}],`,
    `    ${c('"transport"')}: ${y('"http"')}`,
    `  ${y("}")}`,
  ];

  for (const line of manifest) {
    console.log(line);
    await sleep(80);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  Any agent that knows the Morlock protocol can find this.`);
  console.log(`  ${dim("No scraping. No browser. No vision model. Just a clean HTTP call.")}`);
  console.log("");
  await waitForEnter();
}

async function screenAgent(): Promise<void> {
  clearScreen();
  header(5, 5, "Simulate an agent discovering you");

  console.log("  Here's what happens when an AI agent visits your site.");
  console.log(`  ${dim("This is the whole point.")}`);
  console.log("");
  hr();
  console.log("");

  console.log(`  ${g("$")} ${w("morlock simulate-agent --site your-app.com")}`);
  console.log("");

  const steps = [
    { text: `\u2192  checking ${c("your-app.com/.well-known/morlock")}`,   delay: 500  },
    { text: `${g("\u2713")}  manifest found`,                                delay: 900  },
    { text: "\u2192  reading available commands",                            delay: 1200 },
    { text: `${g("\u2713")}  1 command found: ${c('"search"')}`,            delay: 1600 },
    { text: `\u2192  calling ${c("search")}  ${dim('{ query: "morlock protocol" }')}`, delay: 2100 },
    { text: `${g("\u2713")}  3 results returned in 42ms`,                   delay: 2800 },
    { text: "",                                                              delay: 3100 },
    { text: `${g("\u2593\u2593")}  ${b(w("Your site is agent-ready."))}`,  delay: 3300 },
  ];

  for (const s of steps) {
    await sleep(s.delay - (steps.indexOf(s) > 0 ? steps[steps.indexOf(s) - 1].delay : 0));
    console.log(`  ${s.text}`);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${dim("Next steps:")}`);
  console.log("");
  console.log(`   ${g("\u2192")}  ${w("morlocks.dev")}          docs, registry, examples`);
  console.log(`   ${g("\u2192")}  ${c("npm i -g @morlock/cli")}  full CLI toolchain`);
  console.log(`   ${g("\u2192")}  ${c("@morlock/openclaw")}      ClawHub skill adapter`);
  console.log("");
  console.log("");
  await waitForEnter("Exit");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function quickstart(): Promise<void> {
  try {
    await screenWelcome();
    await screenInstall();
    await screenMiddleware();
    await screenCommands();
    await screenManifest();
    await screenAgent();
    clearScreen();
    console.log("");
    console.log(`  ${g("Done.")}  ${dim("Go build something agents can use.")}`);
    console.log("");
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ERR_USE_AFTER_CLOSE") {
      process.exit(0);
    }
    throw e;
  }
}

if (require.main === module) {
  quickstart();
}
