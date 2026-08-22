function noticeStack() {
  let stack = document.querySelector('.notice-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'notice-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  return stack;
}

/** Short-lived notices stack above persistent workflow instructions. */
export function showToast(message, type = 'info') {
  const stack = noticeStack();
  const toast = document.createElement('div');
  toast.className = 'toast is-visible';
  toast.dataset.type = type;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  stack.insertBefore(toast, stack.querySelector('.persistent-notice'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 3600);
}

/** A workflow instruction remains visible until its caller explicitly clears it. */
export function showPersistentNotice(id, message, type = 'info') {
  const stack = noticeStack();
  let notice = stack.querySelector(`[data-notice-id="${CSS.escape(id)}"]`);
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'persistent-notice';
    notice.dataset.noticeId = id;
    notice.setAttribute('role', 'status');
    stack.append(notice);
  }
  notice.dataset.type = type;
  notice.textContent = message;
}

export function hidePersistentNotice(id) {
  document.querySelector(`[data-notice-id="${CSS.escape(id)}"]`)?.remove();
}
