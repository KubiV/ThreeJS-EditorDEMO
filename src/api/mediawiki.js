import { model3dTagFromModel } from './model3d-format.js';

export function createModel3dTag(model, camera) {
  return model3dTagFromModel(model, camera);
}

export async function publishToMediaWiki({ endpoint, title, text, oauthToken }) {
  const response = await fetch('/api/wiki/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ endpoint, title, text, oauthToken })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Uložení do WikiSkript se nezdařilo.');
  return body;
}

export async function fetchWikiConfig() {
  const response = await fetch('/api/wiki/config');
  if (!response.ok) throw new Error('Konfiguraci MediaWiki se nepodařilo načíst.');
  return response.json();
}

export async function fetchWikiStatus() {
  const response = await fetch('/api/wiki/status');
  if (!response.ok) throw new Error('Stav připojení k MediaWiki se nepodařilo načíst.');
  return response.json();
}

function wikiApiUrl(endpoint) {
  const url = new URL(endpoint);
  // A MediaWiki API must explicitly whitelist the viewer origin.  The browser
  // carries the HttpOnly session cookie, but JavaScript never reads it.
  url.searchParams.set('origin', window.location.origin);
  return url.toString();
}

function usesLocalSessionBridge(endpoint) {
  try {
    const apiUrl = new URL(endpoint);
    // Cookies are scoped to a host, not a port. Requests from the editor on
    // localhost:3000 therefore carry the local MediaWiki cookie to the
    // same-origin Node endpoint, which can safely forward it to localhost:8000.
    return apiUrl.hostname.toLocaleLowerCase() === window.location.hostname.toLocaleLowerCase()
      && apiUrl.origin !== window.location.origin;
  } catch {
    return false;
  }
}

async function requestWikiSessionBridge(parameters) {
  const response = await fetch('/api/wiki/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ format: 'json', ...parameters })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body.error?.info || body.error || 'Ověření uživatelské MediaWiki relace se nezdařilo.');
    if (body.error?.code || body.code) error.code = body.error?.code || body.code;
    throw error;
  }
  return body;
}

async function wikiSessionRequest(endpoint, parameters) {
  // Do not first attempt a cross-origin browser fetch for the bundled local
  // MediaWiki. Safari reports a failed FetchEvent for that request even though
  // the application can use the same-host server bridge directly.
  if (usesLocalSessionBridge(endpoint)) return requestWikiSessionBridge(parameters);

  const response = await fetch(wikiApiUrl(endpoint), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ format: 'json', ...parameters })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body.error?.info || 'MediaWiki API odmítlo požadavek uživatele.');
    if (body.error?.code) error.code = body.error.code;
    throw error;
  }
  return body;
}

export async function fetchWikiSessionUser(endpoint) {
  if (!endpoint) return null;
  const body = await wikiSessionRequest(endpoint, {
    action: 'query',
    meta: 'userinfo',
    uiprop: 'groups|rights'
  });
  const info = body.query?.userinfo;
  // MediaWiki represents anonymous visitors with an `anon` property whose
  // value may be an empty string. Testing its truthiness would therefore turn
  // an anonymous IPv4/IPv6 address into an apparently logged-in user.
  const isAnonymous = !info
    || Object.prototype.hasOwnProperty.call(info, 'anon')
    || !Number.isInteger(Number(info.id))
    || Number(info.id) <= 0;
  if (isAnonymous || !info.name) return null;
  return {
    name: info.name,
    groups: Array.isArray(info.groups) ? info.groups : [],
    rights: Array.isArray(info.rights) ? info.rights : []
  };
}

export async function publishWithWikiSession({ endpoint, title, text, summary = 'Aktualizace 3D modelu ve vieweru', createOnly = false }) {
  const user = await fetchWikiSessionUser(endpoint);
  if (!user) throw new Error('Pro úpravy se nejprve přihlaste do MediaWiki.');
  if (!user.rights.includes('edit')) throw new Error(`Uživatel ${user.name} nemá na wiki právo upravovat stránky.`);
  const tokenResponse = await wikiSessionRequest(endpoint, { action: 'query', meta: 'tokens' });
  const token = tokenResponse.query?.tokens?.csrftoken;
  if (!token) throw new Error('MediaWiki neposkytla CSRF token pro uložení.');
  const edited = await wikiSessionRequest(endpoint, {
    action: 'edit',
    title,
    text,
    summary,
    token,
    ...(createOnly ? { createonly: '1' } : {})
  });
  return { ...edited, publishedTitle: title, user };
}
