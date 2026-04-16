#!/usr/bin/env node

import {
  g, c, y, dim, b, w,
  sleep, clearScreen, printLines,
  prompt, hr, header, waitForEnter,
  LOGO,
} from "../ui";

// ─── Screens ──────────────────────────────────────────────────────────────────

async function screenWelcome(): Promise<void> {
  clearScreen();
  console.log("");
  console.log(`  ${LOGO}  ${dim("quickstart")}`);
  console.log(`  ${dim("A guided walkthrough for making a site agent-native.")}`);
  console.log("");
  hr();
  console.log("");
  console.log("  This walkthrough is interactive. It will:");
  console.log("");
  console.log(`   ${g("1.")} Show you how to install ${c("@morlock/core")}`);
  console.log(`   ${g("2.")} Show you the middleware setup`);
  console.log(`   ${g("3.")} Help you shape your first command`);
  console.log(`   ${g("4.")} Show what your live agent manifest looks like`);
  console.log(`   ${g("5.")} Tell you how to verify everything end-to-end`);
  console.log("");
  console.log(`  ${dim("Nothing is installed, mounted, or published by this walkthrough.")}`);
  console.log(`  ${dim("It's a teaching tool — copy the snippets into your own project.")}`);
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

  console.log(`  ${dim("In your project directory, run:")}`);
  console.log("");
  console.log(`  ${g("$")} ${w("npm install @morlock/core")}`);
  console.log("");
  console.log(`  ${dim("Zero runtime dependencies. TypeScript types included.")}`);
  console.log("");
  await waitForEnter();
}

async function screenMiddleware(): Promise<void> {
  clearScreen();
  header(2, 5, "Add the middleware");

  console.log("  Mount Morlock on your existing server in a few lines.");
  console.log(`  ${dim("No new process. No separate port. It attaches to what you already have.")}`);
  console.log("");
  hr();
  console.log("");

  await printLines([
    `  ${dim("// server.ts (Express example)")}`,
  ]);
  await sleep(150);

  const code = [
    `  ${c("import")} express ${c("from")} ${y('"express"')}`,
    `  ${c("import")} { createMorlock } ${c("from")} ${y('"@morlock/core/server"')}`,
    "",
    `  ${c("const")} app ${g("=")} express()`,
    `  app.use(express.${w("json")}())`,
    "",
    `  ${c("const")} morlock ${g("=")} createMorlock({`,
    `    name:    ${y('"my-app"')},`,
    `    baseUrl: ${y('"https://my-app.com"')},`,
    `    commands: {`,
    `      ${dim("/* your commands — defined on the next screen */")}`,
    `    },`,
    `  })`,
    "",
    `  app.${w("use")}(morlock.${w("express")}())`,
    `  app.listen(${c("3000")})`,
  ];

  for (const line of code) {
    console.log(line);
    await sleep(45);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  Morlock exposes ${c("/.well-known/morlock")} automatically.`);
  console.log("");
  console.log(`  ${dim("Other adapters:")}  morlock.${w("nextjs")}()   morlock.${w("fetch")}()   ${dim("(Workers / Bun / Deno)")}`);
  console.log("");
  await waitForEnter();
}

async function screenCommands(): Promise<void> {
  clearScreen();
  header(3, 5, "Define your first command");

  console.log(`  Commands are what AI agents can ${b("do")} on your site.`);
  console.log(`  ${dim("Each command has a description, typed params, a safety level, and a handler.")}`);
  console.log("");
  hr();
  console.log("");

  const rawName = await prompt(`  ${g("?")}  Name your first command ${dim("(e.g. search, getUser, listPosts)")}  `);
  const cmdName = rawName.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "search";

  console.log("");
  await sleep(200);

  // All commands default to "unsafe" if safety is omitted. Teaching a read
  // example here avoids the new user's first request hitting a 409.
  const code = [
    `  ${dim("// inside createMorlock({ commands: { ... } })")}`,
    "",
    `  ${c(cmdName)}: {`,
    `    description: ${y(`"What this command does, in one sentence."`)},`,
    `    safety:      ${y('"read"')},  ${dim("// read | write | unsafe")}`,
    `    params: {`,
    `      query: { type: ${y('"string"')}, required: ${c("true")} },`,
    `    },`,
    `    handler: ${c("async")} ({ query }) ${g("=>")} {`,
    `      ${dim("// your logic here")}`,
    `      ${c("return")} { results: [] }`,
    `    },`,
    `  },`,
  ];

  for (const line of code) {
    console.log(line);
    await sleep(45);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  ${c(cmdName)} is a ${c("read")} command — no auth or idempotency key needed.`);
  console.log("");
  console.log(`  ${dim("Write commands require auth. Unsafe commands also require an")}`);
  console.log(`  ${dim("X-Morlock-Idempotency-Key header. Add safety: \"write\" | \"unsafe\" to opt in.")}`);
  console.log("");
  await waitForEnter();
}

async function screenManifest(): Promise<void> {
  clearScreen();
  header(4, 5, "Your manifest goes live");

  console.log(`  Morlock serves your manifest at ${c("/.well-known/morlock")}.`);
  console.log(`  ${dim("Agents read this to discover what your site can do.")}`);
  console.log("");
  hr();
  console.log("");

  console.log(`  ${g("$")} ${w("curl https://my-app.com/.well-known/morlock")}`);
  console.log("");
  await sleep(400);

  // This mirrors the real spec v0.2 manifest shape. No made-up fields.
  const manifest = [
    `  ${y("{")}`,
    `    ${c('"morlock"')}:  ${y('"0.2"')},`,
    `    ${c('"name"')}:     ${y('"my-app"')},`,
    `    ${c('"baseUrl"')}:  ${y('"https://my-app.com"')},`,
    `    ${c('"endpoint"')}: ${y('"https://my-app.com/.well-known/morlock"')},`,
    `    ${c('"auth"')}:     { ${c('"type"')}: ${y('"none"')} },`,
    `    ${c('"commands"')}: {`,
    `      ${c('"search"')}: {`,
    `        ${c('"description"')}: ${y('"..."')},`,
    `        ${c('"safety"')}:      ${y('"read"')},`,
    `        ${c('"params"')}:      { ${c('"query"')}: { ${c('"type"')}: ${y('"string"')}, ${c('"required"')}: ${c("true")} } }`,
    `      }`,
    `    }`,
    `  ${y("}")}`,
  ];

  for (const line of manifest) {
    console.log(line);
    await sleep(50);
  }

  console.log("");
  hr();
  console.log("");
  console.log(`  ${g("\u2713")}  Any agent speaking the Morlock protocol can find this.`);
  console.log(`  ${dim("No scraping. No browser. No vision model. Just a clean HTTP call.")}`);
  console.log("");
  await waitForEnter();
}

async function screenVerify(): Promise<void> {
  clearScreen();
  header(5, 5, "Verify it end-to-end");

  console.log("  Once your site is deployed, prove it works.");
  console.log(`  ${dim("Two quick checks, no dashboard needed.")}`);
  console.log("");
  hr();
  console.log("");

  console.log(`  ${b(w("1. Check the manifest is live"))}`);
  console.log("");
  console.log(`     ${g("$")} ${w("curl https://my-app.com/.well-known/morlock")}`);
  console.log("");
  console.log(`     ${dim("Should return JSON with \"morlock\": \"0.2\".")}`);
  console.log("");
  console.log(`  ${b(w("2. Probe it with the CLI"))}`);
  console.log("");
  console.log(`     ${g("$")} ${w("npx @morlock/cli ping my-app.com")}`);
  console.log("");
  console.log(`     ${dim("Prints the command list and highlights any manifest issues.")}`);
  console.log("");
  console.log(`  ${b(w("3. Invoke a command"))}`);
  console.log("");
  console.log(`     ${g("$")} ${w("curl -X POST https://my-app.com/.well-known/morlock \\")}`);
  console.log(`         ${w("-H \"Content-Type: application/json\" \\")}`);
  console.log(`         ${w("-d '{\"command\": \"search\", \"args\": {\"query\": \"hello\"}}'")}`);
  console.log("");
  console.log(`     ${dim("Should return { ok: true, result: { ... } }.")}`);
  console.log("");
  hr();
  console.log("");
  console.log(`  ${dim("Full docs:")}  ${w("https://github.com/morlock-protocol/morlock")}`);
  console.log(`  ${dim("Spec v0.2:")} ${w("https://github.com/morlock-protocol/morlock/blob/main/spec/v0.2.md")}`);
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
    await screenVerify();
    clearScreen();
    console.log("");
    console.log(`  ${g("Done.")}  ${dim("Go build something agents can use.")}`);
    console.log("");
  } catch (e: unknown) {
    // User hit Ctrl+C / closed stdin — treat as a clean exit, not a crash.
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ERR_USE_AFTER_CLOSE") {
      process.exit(0);
    }
    throw e;
  }
}

if (require.main === module) {
  quickstart();
}
