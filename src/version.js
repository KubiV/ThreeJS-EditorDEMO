/**
 * Application version and repository metadata injected at build time via Vite define.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0';
export const APP_GIT_COMMIT = typeof __APP_GIT_COMMIT__ !== 'undefined' ? __APP_GIT_COMMIT__ : '';
export const GITHUB_REPO_URL = typeof __GITHUB_REPO_URL__ !== 'undefined' ? __GITHUB_REPO_URL__ : 'https://github.com/KubiV/ThreeJS-EditorDEMO';

export function getGitHubReleasesUrl() {
  return `${GITHUB_REPO_URL}/releases`;
}

export function getGitHubReleaseUrl(version = APP_VERSION) {
  return `${GITHUB_REPO_URL}/releases/tag/v${version}`;
}

export function getGitHubCommitUrl(commit = APP_GIT_COMMIT) {
  return commit ? `${GITHUB_REPO_URL}/commit/${commit}` : GITHUB_REPO_URL;
}
