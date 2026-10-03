import { describe, expect, it } from 'vitest';
import { frameFor } from '../src/render/three/charles';

describe('Charles bobblehead frame', () => {
  it('faces the way the truck drives, seen from the locked camera', () => {
    expect(frameFor(Math.PI / 2)).toBe(0); // driving toward the camera: face
    expect(frameFor(0)).toBe(2); // driving screen-right: right profile
    expect(frameFor(-Math.PI / 2)).toBe(4); // driving away: back of the head
    expect(frameFor(Math.PI)).toBe(6); // driving screen-left: left profile
    expect(frameFor(-Math.PI / 4)).toBe(3);
  });
});
