export interface RoomSession {
  token: string;
  participantId: string;
  displayName: string;
}

const SESSION_KEY_PREFIX = "tempass:session:";
const DISPLAY_NAME_KEY = "tempass:display-name";

export function loadSession(roomId: string): RoomSession | null {
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}${roomId}`);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RoomSession>;

    if (
      typeof parsed.token !== "string" ||
      typeof parsed.participantId !== "string" ||
      typeof parsed.displayName !== "string"
    ) {
      return null;
    }

    return {
      token: parsed.token,
      participantId: parsed.participantId,
      displayName: parsed.displayName,
    };
  } catch {
    return null;
  }
}

export function saveSession(roomId: string, session: RoomSession): void {
  try {
    window.sessionStorage.setItem(`${SESSION_KEY_PREFIX}${roomId}`, JSON.stringify(session));
  } catch {
    // Storage can be unavailable in private browser modes. The in-memory flow still works.
  }
}

export function clearSession(roomId: string): void {
  try {
    window.sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${roomId}`);
  } catch {
    // Ignore storage failures.
  }
}

export function loadDisplayName(): string {
  try {
    return window.localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDisplayName(displayName: string): void {
  try {
    window.localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  } catch {
    // Ignore storage failures.
  }
}
