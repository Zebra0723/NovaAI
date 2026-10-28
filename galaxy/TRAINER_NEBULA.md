# Galaxy Trainer × Nebula: the workout protocol

Galaxy Trainer designs Nebula's nightly workout; Nebula runs it on its own hand simulator
(`NebulaSim`) and reports back. Twenty-four minutes overnight (a test session: twelve).

## Nebula's side

1. **Advertise** the power `gesture_training` in Nebula's hello to Galaxy Link.
2. **Receive** the workout through the inbox long-poll (`GET /v1/inbox?wait=25`) as an item with
   `kind: "workout"`, `taskId` = the workout id (`p_…`), and `text` = JSON:

```json
{
  "type": "gesture_workout",
  "version": 1,
  "minutes": 21,
  "sessionId": "s_…",
  "focus": [{ "gesture": "thumbs_up", "weight": 0.4, "why": "misses it when the wrist turns" }],
  "conditions": [{ "name": "off-angle", "amount": 0.6 }, { "name": "low light", "amount": 0.4 }],
  "negatives": ["drinking", "typing", "waving to someone on a call"],
  "mix": { "perfect": 0.15 },
  "difficulty": "wider wrist angles than last time"
}
```

   - `focus.gesture` uses Nebula's own gesture names; skip any it doesn't know.
   - `conditions` are real-world imperfections to synthesise, each 0 to 1. Map the names onto what the
     simulator can do (motion blur, speed, lighting, occlusion, frame edge, off-angle, distance, tremor,
     half-formed, left hand, second person) and ignore the rest.
   - `negatives`: everyday movements that must **not** fire.
   - `mix.perfect`: the share of textbook gestures; the rest are imperfect.
3. **Run** it on-device for at most `minutes`, under the rules Nebula already has: only while the Mac
   is idle overnight, never while the user is using it, and keep a new model only if it beats the
   current one on the fixed test set.
4. **Answer** with `POST /v1/practice/<id>/answer` and body `{"answer": "<JSON string>"}`:

```json
{
  "overall": 0.89,
  "gestures": [
    { "name": "thumbs_up", "accuracy": 0.86, "samples": 640, "falseFires": 3, "missed": 87, "worstConditions": ["off-angle", "low light"] }
  ],
  "negatives": [{ "name": "drinking", "falseFires": 2, "samples": 200 }],
  "model": { "replaced": true, "before": 0.86, "after": 0.89 },
  "notes": "one or two plain sentences on what it saw"
}
```

   Accuracy is 0 to 1, on the workout's own simulated samples. The trainer waits `minutes + 4`
   minutes for the answer; after that the workout is closed.

The trainer reads the results into the 1:1 (a per-gesture chart in Galaxy Trainer), scores the night
by `overall`, and designs the next workout around whatever is weakest. No two workouts are the same.
