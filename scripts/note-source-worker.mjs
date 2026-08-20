const baseUrl = (process.env.NOTE_SOURCE_WORKER_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const secret = process.env.SESSION_SECRET;
const idleDelayMs = 3_000;

if (!secret) {
  console.error('[note source worker] SESSION_SECRET não configurado; worker não iniciado.');
  process.exit(1);
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run() {
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/api/internal/note-source-worker`, {
        method: 'POST',
        headers: { 'x-note-source-worker-secret': secret },
      });
      const data = await response.json().catch(() => ({ processed: false }));
      if (!response.ok) {
        console.warn(`[note source worker] Endpoint respondeu ${response.status}; tentando novamente.`);
        await pause(idleDelayMs);
      } else if (!data.processed) {
        await pause(idleDelayMs);
      }
    } catch {
      // The web server may still be starting or restarting.
      await pause(idleDelayMs);
    }
  }
}

void run();