import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;

export const socket: Socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"], // allow upgrade
  withCredentials: true,
  autoConnect: false,
});