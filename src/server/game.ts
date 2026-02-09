import type { RoomState, Song, RoundState } from "../shared/types.ts";

let roomSongs = new Map<string, Song[]>();
let lobbySongs = new Map<string, Song[]>();

interface PendingAnswer {
  timerId: ReturnType<typeof setTimeout>;
  socketId: string;
  songId: string;
  songTitle: string;
  roomCode: string;
  roundNumber: number;
}

const pendingAnswers = new Map<string, Map<string, PendingAnswer>>();

export function addPendingAnswer(roomCode: string, socketId: string, pending: PendingAnswer): void {
  cancelPendingAnswer(roomCode, socketId);
  if (!pendingAnswers.has(roomCode)) {
    pendingAnswers.set(roomCode, new Map());
  }
  pendingAnswers.get(roomCode)!.set(socketId, pending);
}

export function cancelPendingAnswer(roomCode: string, socketId: string): boolean {
  const roomPending = pendingAnswers.get(roomCode);
  if (!roomPending) return false;
  const pending = roomPending.get(socketId);
  if (!pending) return false;
  clearTimeout(pending.timerId);
  roomPending.delete(socketId);
  if (roomPending.size === 0) pendingAnswers.delete(roomCode);
  return true;
}

export function cancelAllPendingAnswers(roomCode: string): string[] {
  const roomPending = pendingAnswers.get(roomCode);
  if (!roomPending) return [];
  const cancelledSocketIds: string[] = [];
  for (const [socketId, pending] of roomPending) {
    clearTimeout(pending.timerId);
    cancelledSocketIds.push(socketId);
  }
  pendingAnswers.delete(roomCode);
  return cancelledSocketIds;
}

export function setLobbySongs(roomCode: string, songs: Song[]): void {
  lobbySongs.set(roomCode, songs);
}

export function getLobbySongs(roomCode: string): Song[] | undefined {
  return lobbySongs.get(roomCode);
}

export function startGame(room: RoomState, songs: Song[]): RoundState {
  room.phase = "playing";
  room.players.forEach((p) => (p.score = 0));
  roomSongs.set(room.code, songs);
  return startRound(room, 1);
}

export function startRound(room: RoomState, roundNumber: number): RoundState {
  cancelAllPendingAnswers(room.code);
  const round: RoundState = {
    roundNumber,
    currentStepIndex: 0,
    song: null,
    revealedSong: null,
    answered: {},
    winnerId: null,
  };
  room.round = round;
  return round;
}

export function getRoomSongs(roomCode: string): Song[] | undefined {
  return roomSongs.get(roomCode);
}

export function getSongForRound(roomCode: string, roundNumber: number): Song | undefined {
  const songs = roomSongs.get(roomCode);
  if (!songs) return undefined;
  return songs[(roundNumber - 1) % songs.length];
}

export function submitAnswer(
  room: RoomState,
  socketId: string,
  songId: string,
  songTitle: string
): { correct: boolean; alreadyWon: boolean } {
  const round = room.round;
  if (!round) return { correct: false, alreadyWon: false };
  if (round.winnerId) return { correct: false, alreadyWon: true };
  round.answered[socketId] = songTitle;

  const correctSong = getSongForRound(room.code, round.roundNumber);
  if (!correctSong) return { correct: false, alreadyWon: false };

  if (songId === correctSong.id) {
    round.winnerId = socketId;
    const player = room.players.find((p) => p.id === socketId);
    if (player) player.score += 1;
    return { correct: true, alreadyWon: false };
  }

  return { correct: false, alreadyWon: false };
}

export function extendDuration(room: RoomState): number | null {
  const round = room.round;
  if (!round) return null;
  const steps = room.settings.durationSteps;
  if (round.currentStepIndex < steps.length - 1) {
    round.currentStepIndex += 1;
  }
  return steps[round.currentStepIndex] ?? null;
}

export function canAdvanceRound(room: RoomState): boolean {
  if (!room.round) return false;
  if (room.settings.totalRounds === 0) return true;
  return room.round.roundNumber < room.settings.totalRounds;
}

export function endGame(room: RoomState): void {
  room.phase = "finished";
  cancelAllPendingAnswers(room.code);
  roomSongs.delete(room.code);
  lobbySongs.delete(room.code);
}

export function resetToLobby(room: RoomState): void {
  room.phase = "lobby";
  room.round = null;
  room.players.forEach((p) => (p.score = 0));
  cancelAllPendingAnswers(room.code);
  roomSongs.delete(room.code);
  lobbySongs.delete(room.code);
}
