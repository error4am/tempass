import {
  apiErrorSchema,
  publicRoomSchema,
  roomAccessResponseSchema,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type PublicRoom,
  type RoomAccessResponse,
} from "@tempass/shared";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("NETWORK", "Could not reach the Tempass server", 0);
  }

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);

    if (parsed.success) {
      throw new ApiError(parsed.data.code, parsed.data.message, response.status);
    }

    throw new ApiError("INTERNAL", "The server returned an unexpected response", response.status);
  }

  return body;
}

export async function createRoom(input: CreateRoomRequest): Promise<RoomAccessResponse> {
  const body = await request("/api/rooms", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const parsed = roomAccessResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError("INTERNAL", "The server returned an unexpected response", 500);
  }

  return parsed.data;
}

export async function getRoom(roomId: string): Promise<PublicRoom> {
  const body = await request(`/api/rooms/${encodeURIComponent(roomId)}`);
  const parsed = publicRoomSchema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError("INTERNAL", "The server returned an unexpected response", 500);
  }

  return parsed.data;
}

export async function joinRoom(
  roomId: string,
  input: JoinRoomRequest,
): Promise<RoomAccessResponse> {
  const body = await request(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const parsed = roomAccessResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError("INTERNAL", "The server returned an unexpected response", 500);
  }

  return parsed.data;
}
