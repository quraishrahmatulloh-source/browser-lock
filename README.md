# Browser Lock

A Chrome extension that locks your browser with a password. When Chrome opens, every tab stays covered until the right password is entered.
Free, no account, no internet. All data stays on your computer.

## Features
- **Locked every time Chrome opens.** Every tab is hidden and a lock screen appears. The session doesn't survive closing Chrome.
- **Auto-lock** when the computer is idle (1 minute to 1 hour) and when the computer screen locks.
- **Lock everything** or **lock one site/tab only**: the lock sticks to the web app (same origin), so it also covers other tabs of that site and reopening it after the tab is closed. Use the popup, or `⌘/Ctrl+Shift+L` (everything) and `⌘/Ctrl+Shift+Y` (this tab).
- **Touch ID / fingerprint** (optional, WebAuthn). The password stays as a backup.
- **Per-site lock**: your bank or email asks for the password again even while Chrome is unlocked, expiring every 5/15/30/60 minutes or when Chrome closes.
- **Panic button** `⌘/Ctrl+Shift+K`: lock everything, minimize all windows, clear the clipboard.
- **Failed-attempt log** with a badge on the icon.
- **Recovery code** in case you forget the password.
- **English and Indonesian** (English is the default).

## Install (not on the Chrome Web Store yet)
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. The settings page opens. Create a password and **save the recovery code**.
4. Pin the padlock icon in the toolbar (puzzle icon → pin).

## Security
- **Touch ID**: the extension never touches your fingerprint. The operating system verifies it; the extension only checks the WebAuthn (ES256) signature against a one-time challenge, requires user verification (UV), and counts fake attempts toward rate limiting.
- Passwords are stored as **PBKDF2-SHA256 (250,000 iterations)** with a random salt, never as plain text.
- Wrong attempts are rate-limited: 5 free, then 30 s, 1 min, 2 min, … up to 15 min. Recovery codes are limited the same way.
- **The password is typed right on the locked page, yet safe from site scripts.** The input lives in an extension-owned iframe (`chrome-extension://` origin), so scripts on the site can read neither its content nor the keystrokes (tested with a key-logger on the page: zero keystrokes read). If the iframe can't load, it falls back to a button that opens an extension-owned window. "Forgot password?" always opens a window so the new recovery code isn't lost when the lock screen closes.
- Page content is **hidden** (`visibility: hidden`), not just covered, and marked `inert` so it can't be focused with Tab.
- Sensitive actions (unlock, change password, settings) are only accepted from this extension's own pages. Messages from web-page scripts are rejected.
- No network requests, analytics, or tracking. All code is in this folder.

## Limits (honest)
- This is **browser-level cover**, not system-level protection. The extension can be disabled or removed at `chrome://extensions`. On a shared computer, also lock the computer screen.
- **Incognito** and **other Chrome profiles** aren't covered. For Incognito, turn on *Allow in Incognito* in the extension details. The profile menu and profile picker are Chrome UI that extensions can't reach, so they can't be locked. Install Browser Lock in every profile you want locked.
- `chrome://` pages and the Web Store can't be covered by an overlay. Those tabs are redirected to the lock page and restored after unlocking.
- `file://` pages are only covered if *Allow access to file URLs* is on for the extension.
- If you forget both the password **and** the recovery code, the only way is to remove the extension and install it again.
- The extension asks for "read and change data on all sites" because it must cover every page. It **doesn't read** page content. Check `content.js`.

## Tests
```bash
node --test tests/*.test.mjs                            # logic tests: password, per-site lock, WebAuthn (Node 20+)
CHROME_BIN="/path/to/Google Chrome for Testing" node tests/e2e.mjs   # end-to-end tests in a real Chrome (~2 min)
```
End-to-end tests need [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/), because regular Chrome (137+) disables `--load-extension`.
Icons are regenerated with `python3 tools/make_icons.py` (needs Pillow).

## Layout
`background.js` service worker (lock state, tabs, auto-lock, panic) · `content.js` page cover · `lib/auth.js` password and failure log · `lib/sites.js` per-site lock · `lib/webauthn.js` Touch ID verification · `lib/i18n.js` two languages ·
`lock.*` lock window · `options.*` settings · `popup.*` toolbar popup · `ui.css` shared styles.

## Chrome Web Store
`PRIVACY.md` (privacy policy), `store/LISTING.md` (listing text and permission justifications), and `tools/package.sh` (builds the upload-ready ZIP).

## License
MIT, see [LICENSE](LICENSE). The [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) font is licensed under the SIL Open Font License 1.1.

Made by [madebyuloh](https://faquloh.site).
