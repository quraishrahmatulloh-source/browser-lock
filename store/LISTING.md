# Chrome Web Store listing

## Name
Browser Lock

## Short summary (max 132 characters)
Lock Chrome with a password or Touch ID. Every tab stays hidden until you unlock. No account, no network.

## Description
Browser Lock locks Chrome with a password. When Chrome opens, every tab is hidden and a lock window appears. Pages only show again after the right password.

FEATURES
• Locked every time Chrome starts
• Auto-lock when the computer is idle or the screen locks
• Touch ID / fingerprint (optional)
• Per-site lock: ask for the password again on your bank or email even when Chrome is unlocked
• Panic button: one shortcut to lock, minimize windows, and clear the clipboard
• Failed-attempt log with a badge on the icon
• Recovery code in case you forget the password
• English and Indonesian

PRIVACY
No account, no ads, no tracking, no network. The password is stored as a hash (PBKDF2) on your computer only. The extension never reads page content.

SECURITY
The password is typed in an extension-owned frame, not exposed to the web page, so site scripts can't snoop. Wrong attempts are rate-limited (5 tries, then increasing waits).

LIMITS (honest)
This is browser-level cover, not system-level security. The extension can be disabled at chrome://extensions. Incognito and other Chrome profiles aren't covered. On a shared computer, also lock the computer screen.

## Category
Productivity / Privacy

## Permission justifications (for the review form)
- storage: store the password hash and settings locally.
- idle: auto-lock when idle or when the screen locks.
- tabs: know which tabs to cover, redirect chrome:// tabs to the lock screen.
- alarms: periodically check per-site lock expiry.
- offscreen + clipboardWrite: clear the clipboard on the panic button.
- host permission <all_urls>: show the lock screen on any web page (without reading page content).
- No remote code. All scripts are in the package.

## Single purpose
Lock the Chrome browser with a password or biometrics until the owner unlocks it.
