import wiki3dLogo from '../assets/wiki3d-logo.svg';

let headerText = '3D prohlížeč';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export function setBranding({ headerText: configuredHeaderText } = {}) {
  headerText = typeof configuredHeaderText === 'string' ? configuredHeaderText.trim() : '3D prohlížeč';
}

export function brandMarkup({ interactive = false } = {}) {
  const name = headerText ? `<span class="brand-name">${escapeHtml(headerText)}</span>` : '';
  const contents = `<img class="brand-logo" src="${wiki3dLogo}" alt="" />${name}`;

  if (!interactive) return `<div class="brand">${contents}</div>`;

  return `<button type="button" class="brand brand-button" data-action="home" title="Zpět na 3D rozcestník">${contents}</button>`;
}

/** Inline SVG prevents the settings control from being rendered as a system emoji. */
export function settingsIconMarkup() {
  return '<svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.24 7.24 0 0 0-1.63-.94L14.37 2.8a.5.5 0 0 0-.49-.4h-3.84a.5.5 0 0 0-.49.4l-.36 2.52c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.64 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.3-.07.62-.07.94s.03.64.07.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.31.64.22l2.39-.96c.49.39 1.04.71 1.63.95l.36 2.51c.04.24.24.41.49.41h3.84c.25 0 .45-.17.49-.41l.36-2.51c.59-.24 1.14-.56 1.63-.95l2.39.96c.24.09.51.01.64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.04-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" fill="currentColor"/></svg>';
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function wikiSessionIndicatorMarkup(user, { userPageUrl = '', loginUrl = '' } = {}) {
  const signedIn = Boolean(user?.name);
  const title = signedIn
    ? `Přihlášen do MediaWiki jako ${user.name}`
    : 'Uživatel není přihlášen do MediaWiki';
  const loginTarget = safeHttpUrl(loginUrl);
  const attributes = `class="wiki-session-indicator${signedIn ? ' is-signed-in' : loginTarget ? ' is-login' : ''}" data-wiki-session-indicator title="${escapeHtml(title)}"`;
  const name = signedIn ? escapeHtml(user.name) : '';

  if (signedIn && userPageUrl) {
    return `<a ${attributes} href="${escapeHtml(userPageUrl)}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }
  if (loginTarget) {
    return `<a ${attributes} href="${escapeHtml(loginTarget)}" target="_blank" rel="noopener noreferrer">Přihlásit se</a>`;
  }
  return `<span ${attributes}>${name}</span>`;
}
