import { io, Socket } from "socket.io-client";

const SOCKET_URL = 
    import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  window.location.origin; // ✅ production fallback (no :4000)

export const socket: 
    Socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"], // allow upgrade
  withCredentials: true,
  autoConnect: false,
});