#!/usr/bin/env bun
// galaxyd: Galaxy Link. Runs on its own under launchd, so it's there
// whichever of Comet, Nova, Orbit, Nebula and Zenith happen to be running.

import { writeFileSync } from "node:fs";
import { Link } from "./link";
import { configuredPort, ensureHome, paths, readOrCreateToken } from "./paths";
import { serve } from "./server";
import { Store } from "./store";

ensureHome();
const token = readOrCreateToken();
const port = configuredPort();
const store = new Store(paths.db);
const link = new Link(store);
const server = serve({ link, token, port });
writeFileSync(paths.port, String(server.port) + "\n");
console.log(`galaxyd: listening on 127.0.0.1:${server.port}, state in ${paths.home}`);

const stop = () => {
  server.stop(true);
  store.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
