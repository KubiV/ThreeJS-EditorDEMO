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

/** Decorative, inline SVGs shared by textual action controls. */
export function actionIconMarkup(name) {
  const paths = {
    add: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m14 5-7 7 7 7M7 12h12"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
    cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
    copy: '<rect x="9" y="9" width="10" height="11" rx="1"/><path d="M15 9V5H5v11h4"/>',
    delete: '<path d="M4 7h16M10 11v5M14 11v5M9 7l1-2h4l1 2M6 7l1 13h10l1-13"/>',
    edit: '<path d="m4 16.5-.5 4 4-.5L19 8.5l-3.5-3.5L4 16.5Z"/><path d="m13.5 7 3.5 3.5"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeOff: '<path d="m3 3 18 18M10.6 6.3A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a18.3 18.3 0 0 1-3.4 4.1M6.1 6.1A18.2 18.2 0 0 0 2.5 12S6 18 12 18c.5 0 1 0 1.5-.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    fit: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/><path d="M8 8h8v8H8z"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v6H5V5h6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18 12a6 6 0 0 0-10.6-3.9L4 12m16 0-3.4 3.9A6 6 0 0 1 6 12"/>',
    rotate: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6"/>',
    save: '<path d="M5 4h12l2 2v14H5Z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    upload: '<path d="M12 16V4M8 8l4-4 4 4M5 14v6h14v-6"/>',
    view: '<path d="M3 5h18v14H3Z"/><path d="m9 9 3-3 3 3M12 6v9M9 12l3 3 3-3"/>'
  };
  return `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
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
