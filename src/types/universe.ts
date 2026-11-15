export interface KeepsakeManifestItem {
  id: string;
  url: string;
  radius: number;
  initialPosition: [number, number, number];
}

export type CompanionId = 'froakie' | 'deerling';

export type GestureKind = 'tap' | 'drag';
