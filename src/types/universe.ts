export interface KeepsakeManifestItem {
  id: string;
  name?: string;
  url: string;
  radius: number;
  initialPosition: [number, number, number];
  scale?: number;
}

export type CompanionId = 'froakie' | 'deerling';

export type GestureKind = 'tap' | 'drag';

export interface LetterItem {
  id: number;
  front: string;
  back: string;
  backDesign: number;
  width: number;
  height: number;
  aspectRatio: number;
}
