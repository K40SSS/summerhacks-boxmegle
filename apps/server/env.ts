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
