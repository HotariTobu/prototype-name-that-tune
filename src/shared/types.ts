export interface Player {
  id: string;
  nickname: string;
  score: number;
  isHost: boolean;
  handicapSeconds: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  previewUrl: string;
}

export type RoomPhase = "lobby" | "playing" | "paused" | "finished";

export interface RoomSettings {
  totalRounds: number;
  durationSteps: number[];
  scoringScheme: number[];
  playlistId: string;
  playlistName: string;
}

export interface RoundWinner {
  playerId: string;
  nickname: string;
  points: number;
}

export interface RoundState {
  roundNumber: number;
  currentStepIndex: number;
  song: Song | null;
  revealedSong: Song | null;
  answered: Record<string, string>;
  winners: RoundWinner[];
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  players: Player[];
  settings: RoomSettings;
  round: RoundState | null;
}

export interface ClientToServerEvents {
  "room:create": (data: {}, callback: (res: { ok: true; code: string } | { ok: false; error: string }) => void) => void;
  "room:check": (data: { code: string }, callback: (res: { exists: boolean }) => void) => void;
  "room:join": (data: { code: string }, callback: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  "room:leave": () => void;
  "room:nickname": (data: { nickname: string }, callback: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  "room:handicap": (data: { seconds: number }, callback: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  "room:settings": (data: Partial<RoomSettings>) => void;
  "lobby:songs": (data: { songs: Song[] }) => void;
  "game:start": () => void;
  "game:play": () => void;
  "game:answer": (data: { songId: string; songTitle: string }) => void;
  "game:extend": () => void;
  "game:closeAnswers": () => void;
  "game:next": () => void;
  "game:end": () => void;
  "game:back-to-lobby": () => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "room:error": (error: string) => void;
  "game:round": (round: RoundState) => void;
  "game:scored": (data: { playerId: string; nickname: string; points: number; position: number }) => void;
  "game:reveal": (data: { song: Song; winners: RoundWinner[] }) => void;
  "game:finished": (data: { players: Player[] }) => void;
  "game:extended": (data: { currentStepIndex: number }) => void;
  "game:play-song": (data: { songIndex: number; duration: number }) => void;
  "game:wrong-answer": (data: { songTitle: string }) => void;
  "lobby:songs": (data: { songs: Song[] }) => void;
  "game:songs": (data: { songs: Song[] }) => void;
}
