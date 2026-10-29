// Cuts your Galaxy's owner-only parts out of a source file for the consumer edition.
//
// In any .ts, .js or .css file:
//
//   // #owner                      (or /* #owner */ in CSS)
//   ...only in your Galaxy: Comet, Teach, anything about you...
//   // #consumer  ...the consumer edition's line instead, if it needs one...
//   // #end                        (or /* #end */)
//
// Your Galaxy runs the files as they are (the markers and #consumer lines are comments);
// the consumer build keeps everything outside the blocks, drops what's inside, and
// switches the #consumer lines on. Whole files that are owner-only are listed in OWNER_FILES.

export const OWNER_FILES = [
  // Teach: nowhere in the consumer edition.
  "src/teach.ts",
  "src/teach/",
  "web/js/teach.js",
  // Your own tools and data.
  "src/importers.ts",
  "src/cli.ts",
  "scripts/demo.ts",
  "test/",
  "TRAINER_NEBULA.md",
];

const OPEN = /^\s*(?:\/\/|\/\*)\s*#owner\b.*$/;
const CLOSE = /^\s*(?:\/\/|\/\*)\s*#end\b.*$/;
const ALT = /^(\s*)(?:\/\/|\/\*)\s*#consumer\s?(.*?)(?:\s*\*\/)?\s*$/;

export function isOwnerFile(path: string): boolean {
  const p = path.replaceAll("\\", "/");
  return OWNER_FILES.some((f) => (f.endsWith("/") ? p.includes("/" + f) || p.startsWith(f) : p.endsWith("/" + f) || p === f));
}

/** The consumer edition of one file's text. Throws on a block that isn't closed. */
export function strip(text: string, name = "file"): string {
  const out: string[] = [];
  let depth = 0;
  let openedAt = 0;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (OPEN.test(line)) {
      if (depth) throw new Error(`${name}:${i + 1}: #owner inside #owner`);
      depth = 1;
      openedAt = i + 1;
      return;
    }
    if (CLOSE.test(line)) {
      if (!depth) throw new Error(`${name}:${i + 1}: #end without #owner`);
      depth = 0;
      return;
    }
    if (depth) {
      const alt = ALT.exec(line);
      if (alt) out.push(alt[1] + alt[2]);
      return;
    }
    out.push(line);
  });
  if (depth) throw new Error(`${name}:${openedAt}: #owner is never closed`);
  return out.join("\n");
}
