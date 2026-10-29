# Galaxy for other people (the consumer edition)

The DMGs other people install. They get Galaxy Link (with Trainer and Medic inside it), Nova,
Nebula, Orbit and Zenith. They don't get Comet or Teach, which don't exist in this edition at
all, and nothing that knows you.

- **Nothing of yours.** The consumer build cuts every owner-only part out of the source (see
  "How it's kept clean" below), then scans everything it would ship for your name, Comet,
  Teach, your Comet Mac user, contacts, phone numbers and Gmail addresses, plus any private
  words you list. If anything is found, the build fails.
- **Accounts.** Everyone signs up for a Galaxy account the first time they open Galaxy Link,
  and that one account works for every member. Each account's memories and training are kept
  in Supabase, and row-level security means nobody can ever see anyone else's.
- **Claude is on you.** Members reach Claude through your Supabase function (`claude`), which
  holds your Anthropic API key. Each account has a daily allowance, so nobody can run up your
  bill.
- **Your own Galaxy is untouched.** The consumer edition lives in its own folder
  (`~/Library/Application Support/Galaxy Consumer`), on its own port (7750), with its own
  bundle IDs and launchd labels.

## One-time setup (you)

1. **Supabase.** Make a free project at supabase.com. Then, in this folder:
   ```
   brew install supabase/tap/supabase
   cd galaxy/consumer
   supabase login
   supabase link --project-ref <your project ref>
   supabase db push
   supabase secrets set ANTHROPIC_API_KEY=<a key from console.anthropic.com>
   supabase functions deploy claude --no-verify-jwt
   supabase functions deploy device-key
   ```
   You can change the allowance with `supabase secrets set DAILY_TOKEN_LIMIT=3000000`. By
   default that's 3 million tokens per account per day, Sonnet and Haiku only.
2. **Put the project's URL and anon key in `consumer/config.json`.** Both are in Supabase under
   Project Settings → API. The anon key is meant to be public; the service key never goes here.
3. **Your private words** (optional, never committed): put things only you would know, one per
   line, in `~/.config/galaxy/private-words`, and the build will refuse to ship any of them.
   For example your email, family names, your school, your phone number.

## Building

```
bun scripts/consumer/build.ts
```
This makes `dist/consumer/app` (the bundled galaxyd, Trainer and Medic, plus the app's pages),
checks that it type-checks, and runs the privacy scan.

To try it on a Mac without Supabase, run `bun scripts/consumer/fake-service.ts`. Then build with
`GALAXY_SUPABASE_URL=http://127.0.0.1:7790 GALAXY_SUPABASE_ANON_KEY=anon`.

## How it's kept clean

In any source file, owner-only code goes between markers:

```ts
// #owner
const order = ["comet", "orbit", "nova"];
// #consumer const order = ["orbit", "nova"];
// #end
```

Your Galaxy runs the file as it is, because the markers and `#consumer` lines are only
comments. The consumer build drops everything inside the block and switches on the
`#consumer` lines. Files that are owner-only as a whole (Teach, the importers, the CLI) are
listed in `scripts/consumer/strip.ts`. When you add something about yourself or Comet, put it
in a block. If you forget, the privacy scan stops the build and tells you where.
