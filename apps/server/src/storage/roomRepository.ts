import type { StoredRoom } from "../domain/types";

export interface RoomRepository {
  create(room: StoredRoom): void;
  find(roomId: string): StoredRoom | undefined;
  delete(roomId: string): boolean;
  all(): Iterable<StoredRoom>;
}
