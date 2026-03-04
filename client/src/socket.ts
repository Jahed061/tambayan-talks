import { io, Socket } from "socket.io-client";

/**
 * Resolve the Socket.IO base URL.
 * - Prefer VITE_SOCKET_URL (explicit)
 * - Fall back to VITE_API_URL
 * - If env vars are missing (common when a static site wasn't rebuilt), try a safe Render heuristic:
 *   frontend: <name>.onrender.com  -> api: <name>-api.onrender.com
 * - In dev, fall back to http://<host>:4000
 */
function resolveSocketBaseUrl(): string {
  const envSocket = import.meta.env.VITE_SOCKET_URL as string | undefined;
  const envApi = import.meta.env.VITE_API_URL as string | undefined;

  if (envSocket) return envSocket;
  if (envApi) return envApi;

  // Heuristic for Render free hosting.
  try {
    const origin = window.location.origin;
    const u = new URL(origin);

    if (u.hostname.endsWith(".onrender.com") && !u.hostname.includes("-api")) {
      return `${u.protocol}//${u.hostname.replace(".onrender.com", "-api.onrender.com")}`;
    }

    return origin;
  } catch {
    return "";
  }
}

const SOCKET_URL =
  resolveSocketBaseUrl() ||
  (import.meta.env.DEV ? `http://${window.location.hostname}:4000` : window.location.origin);

export const socket: Socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true,
  autoConnect: false,
});
