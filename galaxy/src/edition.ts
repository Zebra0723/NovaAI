// Which Galaxy this is. Yours (the owner's edition, the default) runs every member,
// Comet and Teach included. The consumer edition, the one in the DMGs, is for other
// people: no Comet, no Teach, nothing of yours, an account to sign in with, and its
// own folder and port, so it never touches the Galaxy on your Mac.
//
// The DMG build bakes it in (`--define process.env.GALAXY_EDITION='"consumer"'`).

export type Edition = "owner" | "consumer";

export function edition(): Edition {
  return process.env.GALAXY_EDITION === "consumer" ? "consumer" : "owner";
}

export const isConsumer = () => edition() === "consumer";

/** Members that don't exist in the consumer edition at all (the consumer build has no names to list). */
// #owner
export const CONSUMER_ABSENT = ["comet", "teach"];
// #consumer export const CONSUMER_ABSENT: string[] = [];
// #end

/** Whether a member exists in this edition. */
export const exists = (id: string) => !(isConsumer() && CONSUMER_ABSENT.includes(id));

/** The consumer edition's account service and AI proxy (Supabase). The anon key is public by design. */
export function consumerService() {
  return {
    url: (process.env.GALAXY_SUPABASE_URL ?? "").replace(/\/+$/, ""),
    anonKey: process.env.GALAXY_SUPABASE_ANON_KEY ?? "",
  };
}
