/**
 * Manages draggable splitters / resize handles (width and height) for the left tag draft panel
 * and the right sidebar inspector, including syncing CSS variables and
 * updating Three.js scene dimensions on resize.
 */

const STORAGE_LEFT_WIDTH = 'wiki3d_left_panel_width';
const STORAGE_LEFT_HEIGHT = 'wiki3d_left_panel_height';
const STORAGE_SIDEBAR_WIDTH = 'wiki3d_sidebar_width';
const STORAGE_SIDEBAR_HEIGHT = 'wiki3d_sidebar_height';

const MIN_LEFT_WIDTH = 280;
const MAX_LEFT_WIDTH = 480;
const DEFAULT_LEFT_WIDTH = 350;

const MIN_LEFT_HEIGHT = 220;

const MIN_SIDEBAR_WIDTH = 300;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_SIDEBAR_WIDTH = 360;
const COLLAPSED_SIDEBAR_WIDTH = 48;

const MIN_SIDEBAR_HEIGHT = 240;

let currentLeftWidth = DEFAULT_LEFT_WIDTH;
let currentLeftHeight = null;
let currentSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
let currentSidebarHeight = null;
let isSidebarCollapsed = false;
let sceneManagerGetter = null;

function loadStoredDimensions() {
  try {
    const storedLeftW = Number(localStorage.getItem(STORAGE_LEFT_WIDTH));
    if (Number.isFinite(storedLeftW) && storedLeftW >= MIN_LEFT_WIDTH && storedLeftW <= MAX_LEFT_WIDTH) {
      currentLeftWidth = storedLeftW;
    }
    const storedLeftH = Number(localStorage.getItem(STORAGE_LEFT_HEIGHT));
    if (Number.isFinite(storedLeftH) && storedLeftH >= MIN_LEFT_HEIGHT) {
      currentLeftHeight = Math.min(storedLeftH, window.innerHeight - 40);
    }
    const storedSidebarW = Number(localStorage.getItem(STORAGE_SIDEBAR_WIDTH));
    if (Number.isFinite(storedSidebarW) && storedSidebarW >= MIN_SIDEBAR_WIDTH && storedSidebarW <= MAX_SIDEBAR_WIDTH) {
      currentSidebarWidth = storedSidebarW;
    }
    const storedSidebarH = Number(localStorage.getItem(STORAGE_SIDEBAR_HEIGHT));
    if (Number.isFinite(storedSidebarH) && storedSidebarH >= MIN_SIDEBAR_HEIGHT) {
      currentSidebarHeight = Math.min(storedSidebarH, window.innerHeight - 32);
    }
  } catch {
    // LocalStorage might be restricted; keep default values
  }
}

export function applyDimensionVariables() {
  const root = document.documentElement;
  root.style.setProperty('--left-panel-width', `${currentLeftWidth}px`);
  if (currentLeftHeight) {
    root.style.setProperty('--left-panel-height', `${currentLeftHeight}px`);
  } else {
    root.style.setProperty('--left-panel-height', 'calc(100vh - 190px)');
  }

  root.style.setProperty('--sidebar-width', `${currentSidebarWidth}px`);
  if (currentSidebarHeight) {
    root.style.setProperty('--sidebar-height', `${currentSidebarHeight}px`);
  } else {
    root.style.setProperty('--sidebar-height', 'calc(100% - 110px)');
  }

  root.style.setProperty('--sidebar-collapsed-width', `${COLLAPSED_SIDEBAR_WIDTH}px`);
  root.style.setProperty('--sidebar-current-width', `${isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : currentSidebarWidth}px`);
}

function triggerSceneResize() {
  const sceneManager = sceneManagerGetter?.();
  if (sceneManager?.resize) {
    sceneManager.resize();
  }
  window.dispatchEvent(new Event('resize'));
}

export function syncSidebarCollapsedState(collapsed) {
  isSidebarCollapsed = Boolean(collapsed);
  const viewer = document.querySelector('.viewer');
  if (viewer) {
    viewer.classList.toggle('is-sidebar-collapsed', isSidebarCollapsed);
  }
  applyDimensionVariables();
  triggerSceneResize();
}

function createHandle(parent, className, title) {
  let handle = parent.querySelector(`.${className}`);
  if (!handle) {
    handle = document.createElement('div');
    handle.className = `resize-handle ${className}`;
    handle.setAttribute('aria-hidden', 'true');
    handle.title = title;
    parent.appendChild(handle);
  }
  return handle;
}

export function attachLeftPanelResizer(container = document) {
  const panel = container.querySelector?.('.tag-draft-panel') || document.querySelector('.tag-draft-panel');
  if (!panel) return;

  const rightHandle = createHandle(panel, 'resize-handle-draft-right', 'Změnit šířku panelu (táhněte myší)');
  const bottomHandle = createHandle(panel, 'resize-handle-draft-bottom', 'Změnit výšku panelu (táhněte myší)');
  const cornerHandle = createHandle(panel, 'resize-handle-draft-corner', 'Změnit rozměry panelu (táhněte myší)');

  const bindHandle = (handle, mode) => {
    if (handle.dataset.bound) return;
    handle.dataset.bound = 'true';

    let startX = 0;
    let startY = 0;
    let startWidth = currentLeftWidth;
    let startHeight = currentLeftHeight || panel.getBoundingClientRect().height;
    let activePointerId = null;

    const onPointerMove = (event) => {
      if (event.pointerId !== activePointerId) return;
      if (window.innerWidth <= 900) return;

      if (mode === 'width' || mode === 'both') {
        const deltaX = event.clientX - startX;
        const maxAllowedW = Math.min(MAX_LEFT_WIDTH, window.innerWidth - 80);
        currentLeftWidth = Math.max(MIN_LEFT_WIDTH, Math.min(maxAllowedW, Math.round(startWidth + deltaX)));
      }

      if (mode === 'height' || mode === 'both') {
        const deltaY = event.clientY - startY;
        const maxAllowedH = window.innerHeight - 40;
        currentLeftHeight = Math.max(MIN_LEFT_HEIGHT, Math.min(maxAllowedH, Math.round(startHeight + deltaY)));
      }

      applyDimensionVariables();
      triggerSceneResize();
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;

      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing', 'is-resizing-ns', 'is-resizing-ew', 'is-resizing-nwse');
      const viewer = document.querySelector('.viewer');
      if (viewer) viewer.classList.remove('is-left-resizing');

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      try {
        localStorage.setItem(STORAGE_LEFT_WIDTH, String(currentLeftWidth));
        if (currentLeftHeight) {
          localStorage.setItem(STORAGE_LEFT_HEIGHT, String(currentLeftHeight));
        }
      } catch {
        // Ignore storage errors
      }

      triggerSceneResize();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || window.innerWidth <= 900) return;
      event.preventDefault();
      event.stopPropagation();

      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startWidth = rect.width || currentLeftWidth;
      startHeight = rect.height || currentLeftHeight || 380;

      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      if (mode === 'width') document.body.classList.add('is-resizing-ew');
      else if (mode === 'height') document.body.classList.add('is-resizing-ns');
      else document.body.classList.add('is-resizing-nwse');

      const viewer = document.querySelector('.viewer');
      if (viewer) viewer.classList.add('is-left-resizing');

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  };

  bindHandle(rightHandle, 'width');
  bindHandle(bottomHandle, 'height');
  bindHandle(cornerHandle, 'both');
}

export function attachSidebarResizer(container = document) {
  const host = container.querySelector?.('#sidebar-host') || document.querySelector('#sidebar-host');
  if (!host) return;

  const leftHandle = createHandle(host, 'resize-handle-sidebar-left', 'Změnit šířku panelu (táhněte myší)');
  const bottomHandle = createHandle(host, 'resize-handle-sidebar-bottom', 'Změnit výšku panelu (táhněte myší)');
  const cornerHandle = createHandle(host, 'resize-handle-sidebar-corner', 'Změnit rozměry panelu (táhněte myší)');

  const bindHandle = (handle, mode) => {
    if (handle.dataset.bound) return;
    handle.dataset.bound = 'true';

    let startX = 0;
    let startY = 0;
    let startWidth = currentSidebarWidth;
    let startHeight = currentSidebarHeight || host.getBoundingClientRect().height;
    let activePointerId = null;

    const onPointerMove = (event) => {
      if (event.pointerId !== activePointerId) return;
      if (window.innerWidth <= 900 || host.classList.contains('is-collapsed')) return;

      if (mode === 'width' || mode === 'both') {
        const deltaX = startX - event.clientX;
        const maxAllowedW = Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 120);
        currentSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxAllowedW, Math.round(startWidth + deltaX)));
      }

      if (mode === 'height' || mode === 'both') {
        const deltaY = event.clientY - startY;
        const maxAllowedH = window.innerHeight - 32;
        currentSidebarHeight = Math.max(MIN_SIDEBAR_HEIGHT, Math.min(maxAllowedH, Math.round(startHeight + deltaY)));
      }

      applyDimensionVariables();
      triggerSceneResize();
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;

      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing', 'is-resizing-ns', 'is-resizing-ew', 'is-resizing-nesw');
      const viewer = document.querySelector('.viewer');
      if (viewer) viewer.classList.remove('is-sidebar-resizing');

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      try {
        localStorage.setItem(STORAGE_SIDEBAR_WIDTH, String(currentSidebarWidth));
        if (currentSidebarHeight) {
          localStorage.setItem(STORAGE_SIDEBAR_HEIGHT, String(currentSidebarHeight));
        }
      } catch {
        // Ignore storage errors
      }

      triggerSceneResize();
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || window.innerWidth <= 900 || host.classList.contains('is-collapsed')) return;
      event.preventDefault();
      event.stopPropagation();

      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      const rect = host.getBoundingClientRect();
      startWidth = rect.width || currentSidebarWidth;
      startHeight = rect.height || currentSidebarHeight || (window.innerHeight - 32);

      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      if (mode === 'width') document.body.classList.add('is-resizing-ew');
      else if (mode === 'height') document.body.classList.add('is-resizing-ns');
      else document.body.classList.add('is-resizing-nesw');

      const viewer = document.querySelector('.viewer');
      if (viewer) viewer.classList.add('is-sidebar-resizing');

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  };

  bindHandle(leftHandle, 'width');
  bindHandle(bottomHandle, 'height');
  bindHandle(cornerHandle, 'both');
}

export function initPanelResizing({ getSceneManager } = {}) {
  sceneManagerGetter = getSceneManager || null;
  loadStoredDimensions();
  applyDimensionVariables();

  const host = document.querySelector('#sidebar-host');
  if (host) {
    syncSidebarCollapsedState(host.classList.contains('is-collapsed'));
    attachSidebarResizer(document);
  }
  attachLeftPanelResizer(document);
}
