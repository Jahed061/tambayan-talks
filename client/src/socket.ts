import { io } from "socket.io-client";

const envSocket = import.meta.env.VITE_SOCKET_URL as string | undefined;
const envApi = import.meta.env.VITE_API_URL as string | undefined;

function resolveSocketBaseUrl(): string {
  // Prefer explicit env vars
  if (envSocket?.trim()) return envSocket.trim();
  if (envApi?.trim()) return envApi.trim();

  // If no env vars, default to SAME ORIGIN (works when client+api are behind same host),
  // otherwise you must set VITE_API_URL / VITE_SOCKET_URL in Render.
  return window.location.origin;
}

export const socket = io(resolveSocketBaseUrl(), {
  auth: { token: localStorage.getItem('token') },
  transports: ["websocket", "polling"],
  withCredentials: true,
});