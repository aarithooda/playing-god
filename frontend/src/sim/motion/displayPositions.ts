// The positions the scene draws THIS frame, shared by everything that has to agree with what the eye sees (the meshes, the
// camera that follows one, the name tags). Written once per frame by the motion driver inside the canvas; read by id.
// Absent id = nothing buffered for it: the reader falls back to the committed state it was given.
import type { ScenePosition } from "../renderTransform";

export class DisplayPositions {
  private positions = new Map<string, ScenePosition>();

  get(id: string): ScenePosition | undefined {
    return this.positions.get(id);
  }

  replace(next: Map<string, ScenePosition>): void {
    this.positions = next;
  }

  clear(): void {
    if (this.positions.size) this.positions = new Map();
  }
}
