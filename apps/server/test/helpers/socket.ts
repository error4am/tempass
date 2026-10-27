import type {
  ChatMessage,
  ChatSendAck,
  ClientToServerEvents,
  PresenceUpdate,
  RoomSnapshot,
  ServerToClientEvents,
} from "@tempass/shared";
import { io, type Socket } from "socket.io-client";

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const DEFAULT_TIMEOUT_MS = 2_000;

export interface ConnectedSocket {
  socket: TestSocket;
  snapshot: RoomSnapshot;
}

export function connectSocket(url: string, token: string): Promise<ConnectedSocket> {
  const socket: TestSocket = io(url, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    timeout: DEFAULT_TIMEOUT_MS,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error("Timed out waiting for room:snapshot"));
    }, DEFAULT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("room:snapshot", onSnapshot);
      socket.off("connect_error", onError);
    };

    const onSnapshot = (snapshot: RoomSnapshot) => {
      cleanup();
      resolve({ socket, snapshot });
    };

    const onError = (error: Error) => {
      cleanup();
      socket.disconnect();
      reject(error);
    };

    socket.on("room:snapshot", onSnapshot);
    socket.on("connect_error", onError);
  });
}

export function waitForPresence(
  socket: TestSocket,
  predicate: (update: PresenceUpdate) => boolean,
): Promise<PresenceUpdate> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("presence:update", onPresence);
      reject(new Error("Timed out waiting for a matching presence:update"));
    }, DEFAULT_TIMEOUT_MS);

    const onPresence = (update: PresenceUpdate) => {
      if (!predicate(update)) {
        return;
      }

      clearTimeout(timer);
      socket.off("presence:update", onPresence);
      resolve(update);
    };

    socket.on("presence:update", onPresence);
  });
}

export function waitForChatMessage(
  socket: TestSocket,
  predicate: (message: ChatMessage) => boolean = () => true,
): Promise<ChatMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("chat:message", onMessage);
      reject(new Error("Timed out waiting for a matching chat:message"));
    }, DEFAULT_TIMEOUT_MS);

    const onMessage = (message: ChatMessage) => {
      if (!predicate(message)) {
        return;
      }

      clearTimeout(timer);
      socket.off("chat:message", onMessage);
      resolve(message);
    };

    socket.on("chat:message", onMessage);
  });
}

export function sendChatMessage(socket: TestSocket, payload: unknown): Promise<ChatSendAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for chat send acknowledgement"));
    }, DEFAULT_TIMEOUT_MS);

    socket.emit("chat:message", payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

export function waitForDisconnect(socket: TestSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("disconnect", onDisconnect);
      reject(new Error("Timed out waiting for disconnect"));
    }, DEFAULT_TIMEOUT_MS);

    const onDisconnect = () => {
      clearTimeout(timer);
      socket.off("disconnect", onDisconnect);
      resolve();
    };

    socket.on("disconnect", onDisconnect);
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
