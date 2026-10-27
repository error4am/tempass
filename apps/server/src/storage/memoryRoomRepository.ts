import type { StoredRoom } from "../domain/types";
import type { RoomRepository } from "./roomRepository";

export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, StoredRoom>();

  create(room: StoredRoom): void {
    if (this.rooms.has(room.id)) {
      throw new Error("Room ID already exists");
    }

    this.rooms.set(room.id, room);
  }

  find(roomId: string): StoredRoom | undefined {
    return this.rooms.get(roomId);
  }

  delete(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  all(): Iterable<StoredRoom> {
    return this.rooms.values();
  }
}
