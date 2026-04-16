import * as https from "https";
import * as http from "http";
import {
  C, g, c, dim, b, w, red,
  sleep, hr, LOGO, SPINNER_FRAMES,
} from "../ui";

interface Manifest {
  morlock?: string;
  name?: string;
  commands?: Record<string, unknown>;
  tagline?: string;
  agentName?: string;
}

// Follow up to 3 redirects. Sites commonly 301 apex → www or http → https;
// refusing to follow would give false negatives on otherwise-healthy Morlock
// deployments. Bounded to prevent redirect loops.
function fetch(url: string, hops = 0): Promise<{ status: number; body: string; finalUrl: string }> {
  if (hops > 3) return Promise.reject(new Error("too many redirects"));
  const mod = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 8000 }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && typeof loc === "string") {
        res.resume(); // drain
        const next = loc.startsWith("http") ? loc : new URL(loc, url).toString();
        resolve(fetch(next, hops + 1));
        return;
      }
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve({ status, body: data, finalUrl: url }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function normalizeUrl(input: string): string {
  let url = input.replace(/\/+$/, "");
  if (!url.startsWith("http")) url = `https://${url}`;
  return url;
}

function confetti(): string {
  const chars = ["\u2728", "\u2605", "\u25C6", "\u2726", "\u00B7"];
  let line = "";
  for (let i = 0; i < 28; i++) {
    line += chars[Math.floor(Math.random() * chars.length)] + " ";
  }
  return line;
}

export async function ping(siteArg?: string): Promise<void> {
  if (!siteArg) {
    console.log("");
    console.log(`  ${LOGO}  ${dim("ping")}`);
    console.log("");
    console.log(`  ${dim("Usage:")}  morlock ping ${c("<domain>")}`);
    console.log(`  ${dim("e.g.:")}   morlock ping acme.com`);
    console.log("");
    process.exit(1);
  }

  const baseUrl = normalizeUrl(siteArg);
  const manifestUrl = `${baseUrl}/.well-known/morlock`;

  console.log("");
  console.log(`  ${LOGO}  ${dim("ping")}`);
  console.log("");

  // Spinner while fetching
  let fi = 0;
  const spin = setInterval(() => {
    process.stdout.write(
      `\r  ${C.cyan}${SPINNER_FRAMES[fi++ % SPINNER_FRAMES.length]}${C.reset}  ${dim(`reaching into ${siteArg}...`)}`
    );
  }, 80);

  let manifest: Manifest | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(manifestUrl);
    if (res.status !== 200) {
      error = `HTTP ${res.status}`;
    } else {
      manifest = JSON.parse(res.body);
      if (!manifest?.morlock || !manifest?.commands) {
        error = "Invalid manifest — missing morlock version or commands";
        manifest = null;
      }
    }
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "Connection failed";
  }

  clearInterval(spin);
  process.stdout.write("\r" + " ".repeat(60) + "\r");

  if (!manifest) {
    // Failure — dry, in-character
    console.log(`  ${red("\u2717")}  The machinery is silent at ${c(siteArg)}.`);
    console.log(`     ${dim(error ?? "No manifest found.")}`);
    console.log("");
    console.log(`  ${dim("Expected a manifest at")} ${c(manifestUrl)}`);
    console.log(`  ${dim("Run")} ${w("morlock quickstart")} ${dim("to set one up.")}`);
    console.log("");
    process.exit(1);
  }

  // Success — the go-live moment
  const commandCount = Object.keys(manifest.commands!).length;
  const commandNames = Object.keys(manifest.commands!).slice(0, 5);

  await sleep(200);

  console.log(`  ${dim(confetti())}`);
  console.log("");
  console.log(`  ${g("\u2593\u2593\u2593\u2593")}  ${b(w("IT'S ALIVE."))}`);
  console.log("");
  console.log(`  ${g("\u2713")}  ${w(manifest.name ?? siteArg)} is on the agentic web.`);
  console.log(`  ${g("\u2713")}  Protocol ${c(`v${manifest.morlock}`)}`);
  console.log(`  ${g("\u2713")}  ${c(String(commandCount))} command${commandCount === 1 ? "" : "s"}: ${commandNames.map(n => c(n)).join(", ")}${commandCount > 5 ? dim(` +${commandCount - 5} more`) : ""}`);

  if (manifest.tagline) {
    console.log(`  ${g("\u2713")}  ${dim(`"${manifest.tagline}"`)}`);
  }
  if (manifest.agentName) {
    console.log(`  ${g("\u2713")}  Agent name: ${c(manifest.agentName)}`);
  }

  console.log("");
  console.log(`  ${dim(confetti())}`);
  console.log("");
  hr();
  console.log("");
  console.log(`  ${dim("Agents can now find you at")} ${c(manifestUrl)}`);
  console.log(`  ${dim("The Morlocks are running your machinery. The Eloi will never know.")}`);
  console.log("");
}

if (require.main === module) {
  ping(process.argv[2]);
}
