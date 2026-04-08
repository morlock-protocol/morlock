import { g, c, dim, w, LOGO } from "../ui";

export function badge(domain?: string): void {
  if (!domain) {
    console.log("");
    console.log(`  ${LOGO}  ${dim("badge")}`);
    console.log("");
    console.log(`  ${dim("Usage:")}  morlock badge ${c("<domain>")}`);
    console.log(`  ${dim("e.g.:")}   morlock badge acme.com`);
    console.log("");
    process.exit(1);
  }

  const clean = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const badgeUrl = `https://morlocks.dev/badge/${clean}`;
  const markdown = `![Morlock-ready](${badgeUrl})`;

  console.log("");
  console.log(`  ${LOGO}  ${dim("badge")}`);
  console.log("");
  console.log(`  ${g("\u2713")}  Badge markdown for ${c(clean)}:`);
  console.log("");
  console.log(`  ${w(markdown)}`);
  console.log("");
  console.log(`  ${dim("Paste this into your README. It lights up green when")}`);
  console.log(`  ${dim("your /.well-known/morlock endpoint is healthy.")}`);
  console.log("");
}

if (require.main === module) {
  badge(process.argv[2]);
}
