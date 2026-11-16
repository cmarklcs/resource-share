# One Less Thing! Tickets

Live at <https://cmarklcs.github.io/resource-share/tickets/>.

Teachers get a set number of tickets, such as "Leave at 3:30" or "Take off a lunch duty". They request to use one on a weekday at least 24 hours ahead, an admin approves it once coverage is arranged, and the ticket comes off their balance.

## How it works

- **Teachers** sign in with their school Google account. They see how many of each ticket they have left, request one for a day, and follow the status of their requests: waiting, approved, denied or cancelled. They can cancel a request until that day, and the ticket returns to their balance.
- **Admins** are listed in the Sheet's `settings` tab. When they sign in, they get three more tabs:
  - **To approve:** waiting requests, soonest day first, with Approve and Deny.
  - **Coverage:** approved tickets grouped by day.
  - **Teachers:** tickets left for each teacher.
- **Emails** (optional): admins get one for each new request or cancelled approval. Teachers get one when a request is approved or denied. They're sent from the account that owns the script.
- **Rules are enforced by the Apps Script** (`apps-script.gs`), not by the page. The script:
  - asks Google to confirm each sign-in and accepts only your school's domain;
  - refuses weekends and requests made later than 24 hours before the deadline time on that day;
  - refuses a request when the teacher has none of that ticket left;
  - lets only admins approve, deny or see everyone's requests.
- **Data** lives in a private Google Sheet with three tabs:

| Tab | What's in it |
|---|---|
| `tickets` | One row per ticket type: `id`, `name`, `allowance` (how many each teacher gets), `active` (yes/no) |
| `requests` | Every request: who, which ticket, which day, status, and who decided |
| `settings` | Admins, your school domain, the deadline time, the period start date, emails on/off |

## One-time setup (about 15 minutes)

### 1. Get a Google sign-in Client ID
This lets the page show "Sign in with Google". If your school's IT controls Google Cloud, you may need them to do this step or allow it.

1. Go to <https://console.cloud.google.com>, signed in with your school account, and create a new project (e.g. "One Less Thing Tickets").
2. Open **APIs & Services → OAuth consent screen**, also called **Google Auth Platform**, and click **Get started**:
   - App name: *One Less Thing Tickets*. Support email: yours.
   - Audience: **Internal**. This limits sign-in to your school's accounts.
   - Finish and create.
3. Open **Clients → Create client**:
   - Application type: **Web application**
   - **Authorized JavaScript origins → Add URI:** `https://cmarklcs.github.io`
   - Leave redirect URIs empty, then click **Create**.
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`. It isn't a secret.

### 2. Make the Sheet and script
1. Create a new Google Sheet (e.g. "Tickets") and keep it private.
2. Go to **Extensions → Apps Script**, delete the sample code, paste all of `apps-script.gs` (copy it from the *Raw* view on GitHub), and save.
3. Choose `setup` in the function menu and click **Run**. Approve the permissions; it asks to send email and contact Google. The three tabs appear, with your four ticket types at 2 each.

### 3. Fill in the `settings` tab
| key | value |
|---|---|
| `client_id` | The Client ID from step 1 |
| `allowed_domain` | Your school's email domain (the part after @) |
| `admin_emails` | Your email, plus any other admins, comma-separated |
| `period_start` | First day that counts (e.g. `2026-08-01`). Change it to reset everyone's balance. |
| `deadline_time` | `08:00` means a request for Wednesday must be made by Tuesday 8:00 AM |
| `notify` | `yes` or `no` for emails |
| `page_url` | `https://cmarklcs.github.io/resource-share/tickets/` (used in emails) |

Edit the `tickets` tab to change names or allowances, or to add ticket types. Give each new row a short unique `id` with no spaces. Don't change the `id` of a ticket type that's in use. To retire a type, set `active` to `no`.

### 4. Deploy
1. Click **Deploy → New deployment → gear icon → Web app**.
2. Set Execute as: **Me**. Who has access: **Anyone**. Then click **Deploy**.
3. Copy the **Web app URL**, which ends in `/exec`.
4. Put the URL in `API_URL` at the top of `app.js`, then commit and push.

### Changing the script later
Use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. That keeps the same URL.
