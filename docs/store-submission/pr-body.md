A phone-side remote access plugin for DeepSeek Harness.

- `package.json` already declares a `dsh.bundle` manifest (`"bundle": { "patch": "./cordis.yml" }`), so it installs with `dsh plugin add`.
- What it does: on the desktop it serves a QR pairing page; the phone scans it and gets the native DSH UI over the home LAN, or through a Cloudflare quick tunnel when you are away. It also adds a floating ball on the desktop that shows a message feed and approval prompts with sound.
- Category: `remote` (LAN / tunnel access to a local DSH install).
- No obfuscated code and no install-time network calls; the management page only listens on loopback.

Screenshots and docs: https://github.com/ssy-in/dsh-my-phone
