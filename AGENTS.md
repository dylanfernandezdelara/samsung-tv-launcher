# Agent guide: install this launcher on a Samsung TV

You're helping a person put this launcher on their Samsung (Tizen) TV. Work through the steps in
order; each has a check. Do everything you can from the computer and ask the person only for the
steps marked **(person)**. Keep messages short.

## Ground rules

- The TV and this computer must be on the same Wi-Fi.
- Never commit or share `tv.json`, `tv-token.json`, `launcher/config.local.js`, or certificate files (`*.p12`, `author.*`, `distributor.*`). They're gitignored; keep it that way.
- Ask before installing software (Rosetta, Tizen Studio) or downloading assets.
- The person signs in to Samsung themselves. Never handle their password.

## Steps

**1. Find the TV.** `npm install`, then `npm run find-tv`.
Check: `tv.json` has an IP. If nothing is found, ask the person to turn the TV on and confirm the Wi-Fi.

**2. Pair the remote API.** `npm run pair` triggers an **Allow** prompt on the TV **(person: press Allow)**.
Check: `tv-token.json` exists.

**3. Developer Mode.** Ask the person to open **Apps → App Settings** on the TV (the settings page inside Apps, not the main Settings menu) **(person)**. Then send `npm run key -- KEY_1 KEY_2 KEY_3 KEY_4 KEY_5`.
A "Developer Mode" pop-up should open. The person switches it **On**; you can type the computer's IP (printed by find-tv) with `npm run key -- KEY_1 KEY_9 KEY_2` etc., using `KEY_RIGHT` between the four boxes. Then OK.
Check: `curl -s http://<tv-ip>:8001/api/v2/` shows `"developerMode":"1"` and the right `developerIP`.
If the pop-up doesn't open: confirm they're on the App Settings page; try again with slower keys (`KEY_DELAY_MS=1200 npm run key -- ...`).

**4. Full restart.** **(person: unplug the TV for 60 seconds, then turn it on.)** The power button only sleeps it.
Check: `nc -z <tv-ip> 26101` succeeds. If not, it wasn't a full restart.

**5. Tizen tools.** Need `~/tizen-studio/tools/sdb` and `~/tizen-studio/tools/ide/bin/tizen`. If missing, install the Tizen Studio CLI (on Apple Silicon, Rosetta first) and the Samsung extensions; commands are in README step 1.
Check: `~/tizen-studio/tools/sdb connect <tv-ip>` then `~/tizen-studio/tools/sdb devices` lists the TV.

**6. Certificate.** Open `~/tizen-studio/tools/certificate-manager/Certificate-manager.app` for the person: **+ → Samsung → TV**, profile name **tv**, Samsung account sign-in, distributor privilege **Public**, TV id auto-filled **(person)**.
Check: `~/tizen-studio/tools/ide/bin/tizen security-profiles list` shows `tv`.

**7. Choose apps.** Run `npm run apps` and show the list. Ask which apps they want in the dock, then write `launcher/config.local.js` (copy `config.local.example.js`). Each tile needs `title` and `match: ['<app id>', '<name>']`; set `bg` to a brand-ish gradient. For a console or cable box, add `{ title, source: 'HDMIn' }`. Ask for a city if they want weather, and set `weather.latitude/longitude`.

**8. Assets (optional, ask first).** `npm run logos` for the default apps' logos. For other apps, use the app's own icon (`image: 'icon', fit: 'cover'`) or a drawn tile. Wallpapers: the person drops images in `wallpapers-src/`, then `npm run wallpapers`; otherwise built-in gradients are used.

**9. Install.** `npm run deploy`.
Check: the launcher appears on the TV. For a closer look: `npm run debug`, then `node tools/tv-debug.js shot shot.png` and look at the screenshot.

**10. Verify.** `npm run test-tv` (after `npm run debug`). Expect all key checks to PASS and ~0 janky frames.

**11. Power-on.** The launcher reopens itself after power-on and after leaving apps. If the TV has **Autorun Last App** (Settings → General & Privacy → Start Screen Option), have the person turn it on. If power-on briefly shows "cable disconnected" or static, ask if a soundbar is on an HDMI ARC port and set `idleSource: 'HDMI<n>'` in `config.local.js` (shows black instead). List inputs with `npm run debug`, then `node tools/tv-debug.js eval "..."` using `tizen.systeminfo.getPropertyValue('VIDEOSOURCE', ...)`.
Check: turn the TV off and on (`npm run key -- KEY_POWER`, wait 10 s, again); the launcher is in front (`curl -s http://<tv-ip>:8001/api/v2/applications/<app id>` shows `"visible":true`).

**12. Phone remote (optional, ask first).** Needs a Mac with Xcode, `xcodegen`, and an Apple developer account. In `remote/`: copy `Local.example.xcconfig` to `Local.xcconfig` with the person's team id and a bundle id, `xcodegen`, then build to their iPhone (`xcodebuild ... -allowProvisioningUpdates`, `xcrun devicectl device install app`). The person enables Developer Mode on the iPhone, enters the TV's IP in the app, and presses **Allow** on the TV.

## If something's off

| Symptom | Fix |
|---|---|
| 12345 does nothing | Must be on **Apps → App Settings**, not the Apps grid or TV Settings |
| `sdb` can't connect / port 26101 closed | Developer Mode needs a full restart (unplug); Host PC IP must be this computer's |
| `sdb shell ...` prints `closed` | Normal on retail TVs; use the tools here instead of a shell |
| `debug.sh` finds no port | Retry; it closes the app first, and the TV needs a few seconds |
| Install fails with a certificate error | Profile must be a **Samsung** certificate with this TV's id; re-create it |
| Logo looks blurry | Use an SVG logo; raster icons are capped by their pixel size |
| Tile says "not installed" | The `match` id is wrong; check `npm run apps` |
| Samsung's home stays up after leaving an app | Launcher isn't running (memory pressure or a full restart); open it once, or reinstall |
| HDMI tile bounces back to the launcher | Input viewer app id differs on this model; set `inputViewerId` in `config.local.js` |
| Phone remote says "TV is off" while it's on | Phone and TV on different networks, or the TV's IP changed (reserve it in the router) |
