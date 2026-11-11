import { start, showSetupNeeded } from "./app.js";
import config from "./firebase-config.js";

if (window.OLT_BACKEND) {
  // Local testing only: a fake backend injected by a test page.
  start(window.OLT_BACKEND);
} else if (!config.apiKey || config.apiKey.startsWith("PASTE")) {
  showSetupNeeded();
} else {
  try {
    const { create } = await import("./backend-firebase.js");
    start(create(config));
  } catch (e) {
    console.error(e);
    showSetupNeeded();
  }
}
