const CONFIG_KEY = 'grocery-tracker:config';

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

function api(path) {
  return `https://api.github.com${path}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/** Verify the token/repo combination actually works before we rely on it. */
export async function testConnection(config) {
  const res = await fetch(api(`/repos/${config.owner}/${config.repo}`), {
    headers: headers(config.token),
  });
  if (!res.ok) {
    throw new Error(`Can't reach ${config.owner}/${config.repo} (${res.status}). Check the token scope and repo name.`);
  }
  const json = await res.json();
  if (json.private === false) {
    throw new Error(`${config.owner}/${config.repo} is public. Use a private repo — your grocery data (and the token permissions) shouldn't be world-readable.`);
  }
  return json;
}

/** Fetch the current data file. Returns { data, sha } or { data: null, sha: null } if it doesn't exist yet. */
export async function loadData(config) {
  const res = await fetch(
    api(`/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${config.branch}`),
    { headers: headers(config.token) }
  );
  if (res.status === 404) {
    return { data: null, sha: null };
  }
  if (!res.ok) {
    throw new Error(`Failed to load data file (${res.status}).`);
  }
  const json = await res.json();
  const content = fromBase64(json.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: json.sha };
}

/** Write the data file, creating it if it doesn't exist. Returns the new sha. */
export async function saveData(config, data, sha) {
  const body = {
    message: `Update grocery data — ${new Date().toISOString()}`,
    content: toBase64(JSON.stringify(data, null, 2)),
    branch: config.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    api(`/repos/${config.owner}/${config.repo}/contents/${config.path}`),
    { method: 'PUT', headers: { ...headers(config.token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to save data (${res.status}): ${err.message || 'unknown error'}`);
  }
  const json = await res.json();
  return json.content.sha;
}

export function emptyData() {
  return {
    schemaVersion: 1,
    settings: {
      periodType: 'monthly',
      budgetInputType: 'monthly',
      budgetAmount: 150,
      budgetMode: 'even',
      customWeights: [],
      marginalFactor: 0.6,
      periodAnchorDate: new Date().toISOString().slice(0, 10),
    },
    people: [],
    items: [],
    purchases: [],
  };
}
