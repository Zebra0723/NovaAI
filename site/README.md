# Galaxy's preview site

A static site (no build step) that explains Galaxy and lets people try every member in
their browser: Galaxy Link, Comet, Nova, Orbit, Nebula (real hand tracking from the camera,
in the browser), Zenith, the Trainer and Medic. It's a preview only: nothing on it can reach
anyone's real Galaxy, and every person in the demos is made up.

## Deploy on Vercel

Import the NovaAI repository at vercel.com/new and press Deploy. The `vercel.json` at the
repo root serves this folder as it is, with nothing to build or install. Or, from this repo:

```
npx vercel --prod
```

## Deploy every commit automatically

Link the folder to a Vercel project and connect it to GitHub, once:

```
npm i -g vercel
cd ~/GalaxyAI/NovaAI
vercel login
vercel link          # pick or create the project
vercel git connect   # connects this GitHub repo (install the Vercel GitHub app if asked)
```

From then on every push gets a preview deployment, and pushes to the production branch go
live. Set which branch that is in the project's Settings → Git → Production Branch (or merge
into main). Commits that don't touch `site/` or `vercel.json` are skipped (`ignoreCommand`).

## Try it locally

```
cd site && python3 -m http.server 8080
```
then open http://localhost:8080. The camera and microphone trials need `localhost` or https.

Nothing on the site talks to anyone's Galaxy. The trials are previews that run in the
browser; Nebula's loads Google's MediaPipe hand tracker from jsDelivr.
