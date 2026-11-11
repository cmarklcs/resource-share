import { start, showSetupNeeded } from "./app.js";
import { create } from "./backend-sheets.js";

// The Apps Script web app URL (Deploy → Manage deployments → Web app URL).
// It is safe to make public: the script checks every request.
const API_URL = "";

if (window.OLT_BACKEND) {
  // Local testing only: a fake backend injected by a test page.
  start(window.OLT_BACKEND);
} else if (!API_URL) {
  showSetupNeeded();
} else {
  start(create({ API_URL }));
}
