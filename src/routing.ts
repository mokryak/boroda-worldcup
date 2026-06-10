const rawBasePath = import.meta.env.VITE_PUBLIC_BASE_PATH || import.meta.env.BASE_URL || "/";

export const basePath = normalizeBasePath(rawBasePath);

export function appHref(path: string): string {
  if (path === "/") {
    return basePath || "/";
  }
  return `${basePath}${path}`;
}

export function appUrl(path: string): string {
  return new URL(appHref(path), window.location.origin).toString();
}

export function currentAppPath(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function normalizeBasePath(value: string): string {
  if (!value || value === "./" || value === "/") {
    return "";
  }
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}
