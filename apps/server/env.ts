try {
  process.loadEnvFile();
} catch {
  // no .env file present; fall back to the process environment
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Run ./sync-env.sh from the repo root (or add it to apps/server/.env).",
  );
  process.exit(1);
}

export const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ?? "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!process.env.TURN_KEY_ID || !process.env.TURN_KEY_SECRET) {
  console.warn(
    "TURN_KEY_ID/TURN_KEY_SECRET are not set. Falling back to PeerJS's default " +
      "(unreliable) public TURN relay for cross-network calls.",
  );
}

export const turnKeyId = process.env.TURN_KEY_ID;
export const turnKeySecret = process.env.TURN_KEY_SECRET;
