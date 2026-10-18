# Browser Lock Privacy Policy

*Last updated: October 18, 2026*

**Browser Lock does not collect, send, or share any data.**

## Data stored, only on your computer
Stored through `chrome.storage` in your Chrome profile; it never leaves your computer:
- A password hash (PBKDF2-SHA256, random salt). The password itself is never stored.
- A recovery code hash.
- Settings: auto-lock duration, the list of per-site locks, language, panic button options.
- A failed-attempt log (time and type, up to 50 entries). No photos, no location.
- The Touch ID public key, if you turn it on. The extension never accesses your fingerprint; that is the operating system's job.

## Data not collected
No analytics, tracking, ads, accounts, or network requests. The extension doesn't read web page content, history, or forms.

## Permissions and why
| Permission | Reason |
|---|---|
| `storage` | Store the password hash and settings on your computer. |
| `idle` | Auto-lock when the computer is idle or the screen locks. |
| `tabs` | Know which tabs to cover, and redirect `chrome://` tabs to the lock screen. |
| `alarms` | Check every minute whether per-site unlock permissions have expired. |
| `offscreen`, `clipboardWrite` | Clear the clipboard when the panic button is pressed. |
| Access to all sites (`<all_urls>`) | Show the lock screen over any web page. The script only hides the page and shows the lock screen; it doesn't read or change content. |

## Contact
Questions: <https://faquloh.site/>

## Changes
If this policy changes, the date above is updated and the change is recorded in the repository.
