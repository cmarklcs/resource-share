# One Less Thing!

Live at <https://cmarklcs.github.io/resource-share/one-less-thing/>.

## How it works

- **Teachers** open the link and submit. No login: Firebase gives each browser an anonymous ID so "What you've shared" works on that device. Teachers see "Share yours" and "The list" only.
- **Admin** clicks the faint lock icon at the bottom right and signs in with Google. If that Google account is listed in `firestore.rules`, the Master list tab appears. Anyone else is told they don't have admin access and is signed back out.
- **Security** is enforced by Firebase on the server (`firestore.rules`), not by hiding things in the page. Even someone who reads the page's code can't read other people's submissions.

| Data | Who can read | Who can write |
|---|---|---|
| `responses/{id}` (submissions) | Admin, plus each person their own | Each person, their own only |
| `list` (The list) | Everyone | Admin |
| `triage` (set-aside items) | Admin | Admin |

## One-time setup (about 10 minutes)

1. **Create a Firebase project.** Go to <https://console.firebase.google.com>, choose *Add project*, and name it (e.g. `one-less-thing`). Google Analytics is not needed.
2. **Turn on sign-in.** *Build → Authentication → Get started → Sign-in method*: enable **Anonymous** and **Google**.
3. **Allow your GitHub Pages address.** *Authentication → Settings → Authorized domains → Add domain*: `cmarklcs.github.io`.
4. **Create the database.** *Build → Firestore Database → Create database*, production mode, any nearby location.
5. **Set the security rules.** *Firestore Database → Rules*: paste the contents of `firestore.rules`, replace `ADMIN_EMAIL_HERE` with your Google account email (add more admins as extra `'email'` entries, comma-separated), then **Publish**.
6. **Connect the page.** *Project settings (gear) → Your apps → Web (`</>`)*, register an app, and copy the `firebaseConfig` values into `firebase-config.js`. Commit and push. These values are safe to make public.
7. Open the page, click the lock at the bottom right, and sign in. The Master list should appear.

### Adding or removing an admin
Edit the email list in the Firestore **Rules** tab and publish. Keep `firestore.rules` in this folder in step with it.

### Limiting who can submit (optional)
Right now anyone with the link can submit. To limit submissions to school Google accounts, ask for a change that switches teachers from anonymous sign-in to Google sign-in restricted to your school domain.
