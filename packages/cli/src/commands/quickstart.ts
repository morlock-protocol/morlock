#!/usr/bin/env node

import {
  C, g, c, y, dim, b, w,
  sleep, clearScreen, typewrite, printLines,
  prompt, hr, header, waitForEnter,
  LOGO, SPINNER_FRAMES,
} from "../ui";

// ─── Screens ──────────────────────────────────────────────────────────────────

async function screenWelcome(): Promise<void> {
  clearScreen();
  console.log("");
  console.log(`  ${LOGO}  ${dim("quickstart")}`);
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

  let fi = 0;
  const spin = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan}${SPINNER_FRAMES[fi++ % SPINNER_FRAMES.length]}${C.reset}  ${dim("fetching @morlock/core...")}`);
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
    `  ${c("import")} { createMorlock } ${c("from")} ${y("'@morlock/core/server'")}`,
    "",
    `  ${c("const")} morlock ${g("=")} createMorlock({`,
    `    name:     ${y('"my-app"')},`,
    `    baseUrl:  ${y('"https://my-app.com"')},`,
    `    commands: { ${dim("/* ... */")} },`,
    "  })",
    "",
    `  app.${w("use")}(morlock.${w("express")}())`,
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
    `    ${c('"morlock"')}:   ${y('"0.2"')},`,
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
    { text: `${LOGO}  ${b(w("Your site is agent-ready."))}`,               delay: 3300 },
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
