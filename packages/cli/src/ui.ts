// ─────────────────────────────────────────────────────────────────────────────
// Morlock CLI — Shared UI primitives
//
// The Morlocks run the machinery. The CLI should sound like it.
// ─────────────────────────────────────────────────────────────────────────────

import * as readline from "readline";

export const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  white:   "\x1b[97m",
  gray:    "\x1b[90m",
  bgBlack: "\x1b[40m",
};

export const g   = (s: string): string => `${C.green}${s}${C.reset}`;
export const c   = (s: string): string => `${C.cyan}${s}${C.reset}`;
export const y   = (s: string): string => `${C.yellow}${s}${C.reset}`;
export const dim = (s: string): string => `${C.dim}${C.gray}${s}${C.reset}`;
export const b   = (s: string): string => `${C.bold}${s}${C.reset}`;
export const w   = (s: string): string => `${C.white}${s}${C.reset}`;
export const red = (s: string): string => `${C.red}${s}${C.reset}`;

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export function clearScreen(): void { process.stdout.write("\x1bc"); }

export function typewrite(text: string, delay = 18): Promise<void> {
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

export async function printLines(lines: string[], opts: { lineDelay?: number; typeFirst?: boolean } = {}): Promise<void> {
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

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, (answer: string) => { rl.close(); resolve(answer.trim()); });
  });
}

export function hr(): void { console.log(dim("\u2500".repeat(56))); }

export function header(step: number, total: number, title: string): void {
  console.log("");
  console.log(dim(`  step ${step} of ${total}`));
  console.log(`  ${b(w(title))}`);
  console.log("");
}

export async function waitForEnter(label = "Press Enter to continue"): Promise<void> {
  await prompt(`  ${dim(`[ ${label} ]`)} `);
}

export const LOGO = `${g("\u2593\u2593")} ${b(w("Morlock"))}`;

export const SPINNER_FRAMES = ["\u280B","\u2819","\u2839","\u2838","\u283C","\u2834","\u2826","\u2827","\u2807","\u280F"];
