async function responseJson(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export async function fetchModels() {
  return responseJson(await fetch('/api/models'), 'Nelze načíst seznam modelů.');
}

export async function uploadModel(formData) {
  return responseJson(await fetch('/api/models', { method: 'POST', body: formData }), 'Model se nepodařilo nahrát.');
}

export async function saveModel(model) {
  return responseJson(await fetch(`/api/models/${encodeURIComponent(model.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(model)
  }), 'Konfiguraci se nepodařilo uložit.');
}

export async function fetchModelPermissions({ storageId, article, rawFile } = {}) {
  const url = storageId
    ? `/api/models/${encodeURIComponent(storageId)}/permissions`
    : `/api/models/permissions?article=${encodeURIComponent(article || '')}&file=${encodeURIComponent(rawFile || '')}`;
  return responseJson(await fetch(url, { cache: 'no-store' }), 'Oprávnění modelu se nepodařilo ověřit.');
}

export async function regenerateModelThumbnail(modelId, view) {
  const options = { method: 'POST' };
  if (view) {
    options.headers = { 'content-type': 'application/json; charset=utf-8' };
    options.body = JSON.stringify(view);
  }
  return responseJson(await fetch(`/api/models/${encodeURIComponent(modelId)}/thumbnail`, options), 'Náhled modelu se nepodařilo přegenerovat.');
}

export async function deleteModel(modelId) {
  return responseJson(await fetch(`/api/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' }), 'Model se nepodařilo odstranit.');
}

export async function fetchWikiModel(article) {
  // A switch from editing to reading must reflect the revision that was just
  // published. Do not reuse a cached model definition with the previous
  // camera position.
  return responseJson(await fetch(`/api/wiki/model?title=${encodeURIComponent(article)}`, { cache: 'no-store' }), 'Model z MediaWiki se nepodařilo načíst.');
}

export async function fetchWikiIndex() {
  return responseJson(await fetch('/api/wiki/index'), 'Seznam 3D modelů z MediaWiki se nepodařilo načíst.');
}

export async function fetchWikiCategories() {
  return responseJson(await fetch('/api/wiki/categories'), 'Kategorie z MediaWiki se nepodařilo načíst.');
}
