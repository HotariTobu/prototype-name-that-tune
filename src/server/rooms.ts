import type { RoomState, RoomSettings, Player, Song, RoundState } from "../shared/types.ts";

const rooms = new Map<string, RoomState>();
const socketToRoom = new Map<string, string>();
const socketToSession = new Map<string, string>();
// roomCode -> (sessionId -> nickname)
const roomNicknames = new Map<string, Map<string, string>>();
// roomCode -> next auto-assigned player number
const nextPlayerNumber = new Map<string, number>();
// roomCode -> Set<sessionId> — players present when game started
const gameParticipants = new Map<string, Set<string>>();

function generateCode(): string {
  let code: string;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

const DEFAULT_SETTINGS: RoomSettings = {
  totalRounds: 0,
  durationSteps: [1, 2, 4, 8, 16],
  playlistId: "",
  playlistName: "",
};

function getSavedNickname(code: string, sessionId: string): string {
  return roomNicknames.get(code)?.get(sessionId) ?? "";
}

function saveNickname(code: string, sessionId: string, nickname: string): void {
  if (!nickname) return;
  if (!roomNicknames.has(code)) roomNicknames.set(code, new Map());
  roomNicknames.get(code)!.set(sessionId, nickname);
}

function assignNickname(code: string, sessionId: string): string {
  const saved = getSavedNickname(code, sessionId);
  if (saved) return saved;
  const num = nextPlayerNumber.get(code) ?? 1;
  nextPlayerNumber.set(code, num + 1);
  return `Player ${num}`;
}

export function createRoom(hostSocketId: string, sessionId: string): RoomState {
  const code = generateCode();
  nextPlayerNumber.set(code, 1);
  const nickname = assignNickname(code, sessionId);
  const room: RoomState = {
    code,
    phase: "lobby",
    players: [{ id: hostSocketId, nickname, score: 0, isHost: true, handicapSeconds: 0 }],
    settings: { ...DEFAULT_SETTINGS },
    round: null,
  };
  rooms.set(code, room);
  socketToRoom.set(hostSocketId, code);
  socketToSession.set(hostSocketId, sessionId);
  return room;
}

export function joinRoom(code: string, socketId: string, sessionId: string): RoomState | string {
  const room = rooms.get(code);
  if (!room) return "Room not found";
  if (room.players.some((p) => p.id === socketId)) return "Already in room";

  if (room.phase !== "lobby") {
    const participants = gameParticipants.get(code);
    if (!participants?.has(sessionId)) return "Game already in progress";
  }

  if (room.players.length >= 20) return "Room is full";

  const nickname = assignNickname(code, sessionId);
  room.players.push({ id: socketId, nickname, score: 0, isHost: false, handicapSeconds: 0 });
  socketToRoom.set(socketId, code);
  socketToSession.set(socketId, sessionId);
  return room;
}

export function setNickname(code: string, socketId: string, nickname: string): RoomState | string {
  const room = rooms.get(code);
  if (!room) return "Room not found";
  const player = room.players.find((p) => p.id === socketId);
  if (!player) return "Not in room";
  if (room.players.some((p) => p.id !== socketId && p.nickname === nickname)) return "Nickname already taken";
  player.nickname = nickname;

  const sessionId = socketToSession.get(socketId);
  if (sessionId) saveNickname(code, sessionId, nickname);

  return room;
}

export function leaveRoom(socketId: string): { room: RoomState; wasHost: boolean } | null {
  const code = socketToRoom.get(socketId);
  if (!code) return null;
  const room = rooms.get(code);
  if (!room) return null;

  const player = room.players.find((p) => p.id === socketId);
  const sessionId = socketToSession.get(socketId);
  if (player && sessionId) {
    saveNickname(code, sessionId, player.nickname);
  }

  socketToRoom.delete(socketId);
  socketToSession.delete(socketId);
  const wasHost = player?.isHost ?? false;
  room.players = room.players.filter((p) => p.id !== socketId);

  if (room.players.length === 0) {
    rooms.delete(code);
    roomNicknames.delete(code);
    nextPlayerNumber.delete(code);
    gameParticipants.delete(code);
    return null;
  }

  if (wasHost && room.players.length > 0) {
    room.players[0]!.isHost = true;
  }

  return { room, wasHost };
}

export function saveGameParticipants(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const participants = new Set<string>();
  for (const player of room.players) {
    const sessionId = socketToSession.get(player.id);
    if (sessionId) participants.add(sessionId);
  }
  gameParticipants.set(code, participants);
}

export function isGameParticipant(code: string, sessionId: string): boolean {
  return gameParticipants.get(code)?.has(sessionId) ?? false;
}

export function getRoom(code: string): RoomState | undefined {
  return rooms.get(code);
}

export function getRoomBySocket(socketId: string): RoomState | undefined {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : undefined;
}

export function updateSettings(code: string, settings: Partial<RoomSettings>): RoomState | null {
  const room = rooms.get(code);
  if (!room) return null;
  Object.assign(room.settings, settings);
  return room;
}

export function isHost(socketId: string, room: RoomState): boolean {
  return room.players.some((p) => p.id === socketId && p.isHost);
}

export function setHandicap(code: string, socketId: string, seconds: number): RoomState | string {
  const room = rooms.get(code);
  if (!room) return "Room not found";
  if (room.phase !== "lobby") return "Can only change handicap in lobby";
  const player = room.players.find((p) => p.id === socketId);
  if (!player) return "Not in room";
  if (typeof seconds !== "number" || isNaN(seconds) || seconds < 0 || seconds > 30) return "Handicap must be between 0 and 30 seconds";
  player.handicapSeconds = seconds;
  return room;
}
