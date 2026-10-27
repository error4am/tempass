export function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

export function joinApiUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function apiUrl(path: string): string {
  return joinApiUrl(API_BASE_URL, path);
}
