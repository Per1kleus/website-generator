/**
 * Runs once, before the first request is served.
 *
 * The desktop application keeps the user's own API keys in their profile
 * rather than in environment variables they would have to set from a terminal.
 * Loading them here means every feature reads `process.env` exactly as it does
 * on a hosted deployment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyStoredSettings } = await import("@/server/settings");
  applyStoredSettings();
}
