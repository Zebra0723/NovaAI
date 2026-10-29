#!/usr/bin/env bun
// Builds Galaxy Link's consumer edition into dist/consumer, and refuses to finish if
// anything of yours is in it.
//
//   bun scripts/consumer/build.ts             build and check
//   bun scripts/consumer/build.ts --check     only check an existing dist/consumer
//
// 1. Copies the source with the owner-only parts cut out (scripts/consumer/strip.ts).
// 2. Type-checks that copy, so a cut never leaves something broken behind.
// 3. Bundles galaxyd, the Trainer and Medic (minified, so no comments) for the app.
// 4. Scans everything that would ship for your name, Comet, Teach, contacts and the like
//    (scripts/consumer/privacy.ts). Any hit and the build fails.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { isOwnerFile, strip } from "./strip";
import { scan } from "./privacy";

const ROOT = join(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist", "consumer");
const TREE = join(DIST, "tree");
const COPY = ["src", "web", "package.json", "tsconfig.json"];
const TEXT = /\.(ts|js|css|html|json)$/;

export interface ConsumerConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function readConfig(): ConsumerConfig {
  const file = join(ROOT, "consumer", "config.json");
  const c = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return {
    supabaseUrl: process.env.GALAXY_SUPABASE_URL ?? c.supabaseUrl ?? "",
    supabaseAnonKey: process.env.GALAXY_SUPABASE_ANON_KEY ?? c.supabaseAnonKey ?? "",
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

/** The source, with the owner-only parts cut out, into `to`. */
export function makeTree(to = TREE): string[] {
  rmSync(to, { recursive: true, force: true });
  const written: string[] = [];
  for (const top of COPY) {
    const from = join(ROOT, top);
    const files = statSync(from).isDirectory() ? walk(from) : [from];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (isOwnerFile(rel)) continue;
      const dest = join(to, rel);
      mkdirSync(dirname(dest), { recursive: true });
      if (TEXT.test(file)) writeFileSync(dest, strip(readFileSync(file, "utf8"), rel));
      else cpSync(file, dest);
      written.push(rel);
    }
  }
  if (!existsSync(join(to, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(to, "node_modules"), "dir");
  return written;
}

export function typecheck(tree = TREE) {
  const r = spawnSync("bunx", ["tsc", "--noEmit", "-p", tree], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`the consumer edition doesn't type-check:\n${r.stdout}${r.stderr}`);
}

export async function bundle(tree = TREE, config = readConfig()) {
  const out = join(DIST, "app");
  rmSync(out, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(tree, "src/consumer/galaxyd.ts"), join(tree, "src/trainer/main.ts"), join(tree, "src/medic/main.ts")],
    outdir: join(out, "bin"),
    target: "bun",
    minify: true,
    naming: "[dir]/[name].[ext]",
    root: join(tree, "src"),
    // The SDK ships its own Claude Code; it's copied in beside the bundle, never bundled.
    external: ["@anthropic-ai/claude-agent-sdk"],
    define: {
      "process.env.GALAXY_EDITION": JSON.stringify("consumer"),
      "process.env.GALAXY_SUPABASE_URL": JSON.stringify(config.supabaseUrl),
      "process.env.GALAXY_SUPABASE_ANON_KEY": JSON.stringify(config.supabaseAnonKey),
    },
  });
  if (!result.success) throw new Error(`bundling failed:\n${result.logs.join("\n")}`);
  // The app's pages: one minified script and stylesheet (no comments), the page and its fonts.
  const web = join(out, "web");
  const page = await Bun.build({ entrypoints: [join(tree, "web/js/main.js")], outdir: join(web, "js"), target: "browser", format: "esm", minify: true });
  if (!page.success) throw new Error(`bundling the app's pages failed:\n${page.logs.join("\n")}`);
  // Styles: comments out (the fonts are referenced by URL, so no bundling).
  writeFileSync(join(web, "app.css"), readFileSync(join(tree, "web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n/g, "\n"));
  cpSync(join(tree, "web/index.html"), join(web, "index.html"));
  if (existsSync(join(tree, "web/fonts"))) cpSync(join(tree, "web/fonts"), join(web, "fonts"), { recursive: true });
  return out;
}

if (import.meta.main) {
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly) {
    const files = makeTree();
    console.log(`consumer: ${files.length} files, owner-only parts cut`);
    typecheck();
    console.log("consumer: type-checks");
    const out = await bundle();
    console.log(`consumer: bundled into ${relative(ROOT, out)}`);
    if (!readConfig().supabaseUrl) console.warn("consumer: no Supabase project set yet (consumer/config.json); accounts won't work until it is");
  }
  const hits = scan(join(DIST, "app"));
  if (hits.length) {
    console.error(`consumer: NOT SAFE TO SHIP. Found ${hits.length} thing(s) that are yours:`);
    for (const h of hits.slice(0, 40)) console.error(`  ${h.file}: ${h.what} (${h.sample})`);
    process.exit(1);
  }
  console.log("consumer: privacy check passed: nothing of yours in it");
}
