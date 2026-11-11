# One Less Thing!

Live at <https://cmarklcs.github.io/resource-share/one-less-thing/>.

## How it works

- **Teachers** open the link and submit. No login. Each browser gets a private random key, so "What you've shared" shows their own entries on that device. Teachers see "Share yours" and "The list" only.
- **Admin** clicks the faint lock icon at the bottom right and enters the admin passcode. The Master list tab appears. The sign-in lasts 6 hours or until **Sign out**.
- **Data** lives in a private Google Sheet. The page never reads the Sheet directly. It goes through an Apps Script web app (`apps-script.gs`) that decides what each request may see:

| Data (Sheet tab) | Who can read | Who can change |
|---|---|---|
| `responses` (submissions) | Admin; each browser its own | Anyone can add |
| `list` (The list) | Everyone | Admin |
| `setaside` | Admin | Admin |

- The passcode is stored only in the script's private settings, never in the page, so reading the page's code doesn't reveal it. After 10 wrong passcodes, sign-in pauses for 10 minutes.
- Teachers' names and emails are never collected. The `owner` column holds a scrambled version of each browser's key, not anything identifying.

## One-time setup (about 5 minutes)

1. **Make the Sheet.** Create a new Google Sheet (e.g. "One Less Thing responses"). Keep it private.
2. **Add the script.** In the Sheet: *Extensions → Apps Script*. Delete what's there, paste all of `apps-script.gs`, and save.
3. **Create the tabs.** In the editor's function menu choose `setup` and click **Run**. Approve the permissions prompt (it's your own script). Three tabs appear: `responses`, `list`, `setaside`.
4. **Set the passcode.** *Project Settings (gear) → Script properties → Add script property*: name `ADMIN_PASSCODE`, value a passcode only you know (use something long). Save.
5. **Deploy.** *Deploy → New deployment → type: Web app*. Execute as: **Me**. Who has access: **Anyone**. Deploy, then copy the **Web app URL** (ends in `/exec`).
6. **Connect the page.** Put that URL in `API_URL` at the top of `main.js`, commit and push.
7. Open the page, click the lock at the bottom right, and enter your passcode.

### Changing the script later
After editing the script, use *Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy*. That keeps the same URL.

### Changing the passcode
Edit `ADMIN_PASSCODE` in Script properties. Anyone already signed in stays signed in until their 6 hours run out.

### Working in the Sheet directly
You can read every submission in the `responses` tab at any time. Avoid editing the `id` columns; the page uses them to link submissions to list items.
