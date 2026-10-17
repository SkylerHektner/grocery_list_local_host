// Placeholder bootstrap: proves the static server, ES modules and the API are wired up.
// T4 replaces this with the real app shell (routing, shortcuts, store).

const status = document.querySelector('[data-testid="health-status"]');

async function checkHealth() {
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    const body = await res.json();
    if (!res.ok || body.ok !== true) throw new Error(body.error ?? `HTTP ${res.status}`);
    status.textContent = `Server OK · version ${body.version}`;
    status.dataset.state = 'ok';
  } catch (err) {
    status.textContent = `Server unreachable: ${err.message}`;
    status.dataset.state = 'error';
  }
}

checkHealth();
