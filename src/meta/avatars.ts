// Captains: 8-direction billboard sheets cut by scripts/charles-frames.py and
// scripts/avatar-frames.py. The id travels with the player (profile, co-op spec).
export interface Avatar { id: string; name: string; sheet: string; portrait: string }

export const AVATARS: Avatar[] = [
  { id: 'charles', name: 'Charles', sheet: 'charles/sheet.png', portrait: 'charles/portrait.png' },
  ...['hannes', 'saida', 'olle'].map(id => ({
    id, name: id[0].toUpperCase() + id.slice(1), sheet: `avatars/${id}/sheet.png`, portrait: `avatars/${id}/portrait.png`,
  })),
];

export const avatarOf = (id: string | undefined): Avatar => AVATARS.find(a => a.id === id) ?? AVATARS[0];
