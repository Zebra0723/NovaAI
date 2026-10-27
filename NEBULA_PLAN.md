# NebulaAI: the plan

Nebula is GalaxyAI's fourth body: gesture control for the Mac. In the Galaxy's terms Comet is text, Orbit is voice, Nova is sight, Zenith is time, and Nebula is touch.

## Turning it on
- **fn+F1** arms and disarms it. Holding fn makes the key send F1, so the hotkey is plain F1 (`kVK_F1`).
- **Approval mode**: when a Galaxy body is waiting on the user's yes or no, the camera arms itself for 60 seconds, then turns off.
- **Auto-off**: after 5 minutes with no hand in view, on screen lock or lid close, or on a wave.
- The camera is never on otherwise. The green camera light is the indicator.

## Privacy
- Apple Vision hand pose runs on the Mac: 21 points per hand.
- Frames live in memory for one detection and are never saved or sent.
- Face *rectangles* only, never landmarks or identity, and only to place "finger to lips" and "hand to ear".

## Scope rule
Window gestures act only on the frontmost window. If a gesture means nothing in that app, nothing happens: no desktop switching, no other apps.

The exceptions are the Galaxy gestures and the volume knob, which changes the Mac's volume.

## v1 gestures

| Gesture | Exact movement | Action |
|---|---|---|
| Open palm | Flat hand, fingers together, palm to the screen, held still ½s | Play/pause media in the frontmost window |
| Thumbs up | Fist, thumb up, held ½s | Approve the pending Galaxy approval |
| Thumbs down | Fist, thumb down, held ½s | Reject it |
| Peace sign | Index and middle up in a V, palm to the screen, held ½s | Summon Nova (the same as ⌃Space) |
| Finger to lips | Index finger up, held against the lips ½s | Mute Orbit until unmuted (`orbit mute`) |
| Hand to ear | Cupped hand behind the ear, held ½s | Unmute Orbit (`orbit unmute`) |
| Swipe left/right | Open flat hand moved quickly sideways, about shoulder width | Previous/next in the frontmost window: browser tabs, Keynote slides, Preview pages, Spotify/Music tracks |
| Scroll | Index and middle together and up (like two fingers on a trackpad), palm to the screen, hand moved up/down; curl the fingers or drop the hand to stop | Scroll the frontmost window, trackpad-style, speed following the hand |
| Volume knob | Thumb and index pinched as if holding a small knob, then a wrist twist: clockwise for up, counter-clockwise for down | Mac volume |
| Wave | Open hand waved side to side 2–3 times | Disarm |

There is no held-palm "stop AI" gesture. Esc still stops Nova.

## v1.1: pointer mode
1. **Start**: a "finger gun" (index at the screen, thumb up, others curled) held 1s. A ring appears around the cursor.
2. **Move**: the cursor follows relatively, like a trackpad, smoothed.
3. **Click**: drop the thumb onto the index finger. Twice quickly is a double click.
4. **Drag**: drop the thumb and keep it down while moving; lift it to release.
5. **Right click**: keep the thumb down 1s without moving.
6. **Point and ask**: a peace sign while in pointer mode summons Nova about what is under the cursor.
7. **Exit**: open the hand flat, or drop the arm for 1s.

## Custom gestures (the AI part)
The user creates gestures in the Nebula app:
1. They describe what they want in the app.
2. Claude designs it: the exact movement (chosen so it doesn't clash with existing gestures) and the exact action.
3. The reply goes to the user through **Comet** (iMessage), via Galaxy Link.
4. The user follows up in the app, and the follow-up reply also goes through Comet.
5. The user taps Save.

Saved gestures run on the Mac with zero tokens. Tokens are spent only while creating or changing a gesture.

## Galaxy
- Joins Galaxy Link as body `nebula`, greeting Galaxy Chat with an intro on first connect.
- Gives thumbs up/down on approvals.
- Uses Orbit's mute file to mute and unmute it.
- Summons Nova.
- Sends custom-gesture replies through Comet.

## App
A menu bar app plus a window with these sections:
- **Gestures**: the list, with each gesture's movement and action and an on/off switch.
- **Create**: the AI gesture builder.
- **Practice**: a live hand skeleton while armed.
- **Settings**: auto-off, approval mode, sensitivity.

It gets its own look, as sleek as Nova and Orbit.app. No emojis, no illustrations, excellent typography.
