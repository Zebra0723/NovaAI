# Galaxy's preview site

A static site (no build step) that explains Galaxy and lets people try every member in
their browser: Galaxy Link, Nova, Orbit, Nebula (real hand tracking from the camera, in the
browser), Zenith, the Trainer and Medic.

## Deploy on Vercel

Import the NovaAI repository at vercel.com/new and press Deploy. The `vercel.json` at the
repo root serves this folder as it is, with nothing to build or install. Or, from this repo:

```
npx vercel --prod
```

## Try it locally

```
cd site && python3 -m http.server 8080
```
then open http://localhost:8080. The camera and microphone trials need `localhost` or https.

Nothing on the site talks to anyone's Galaxy. The trials are previews that run in the
browser; Nebula's loads Google's MediaPipe hand tracker from jsDelivr.
