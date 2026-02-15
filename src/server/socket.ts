import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.ts";
import { createRoom, joinRoom, leaveRoom, getRoom, getRoomBySocket, updateSettings, isHost, setNickname, setHandicap, saveGameParticipants, isGameParticipant, getSessionId, setSessionId } from "./rooms.ts";
import { startGame, submitAnswer, extendDuration, canAdvanceRound, startRound, getSongForRound, endGame, resetToLobby, getRoomSongs, setLobbySongs, getLobbySongs, addPendingAnswer, cancelPendingAnswer, cancelAllPendingAnswers } from "./game.ts";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    // Resolve or generate sessionId
    const clientSessionId = (socket.handshake.auth as { sessionId?: string }).sessionId;
    const sessionId = clientSessionId || crypto.randomUUID();
    setSessionId(socket.id, sessionId);
    socket.emit("session:id", sessionId);
    console.log(`connected: ${socket.id} (session: ${sessionId})`);

    socket.on("room:create", (_data, cb) => {
      const room = createRoom(socket.id, sessionId);
      socket.join(room.code);
      cb({ ok: true, code: room.code });
      io.to(room.code).emit("room:state", room);
    });

    socket.on("room:check", ({ code }, cb) => {
      const room = getRoom(code);
      if (!room) {
        cb({ exists: false });
        return;
      }
      if (room.phase === "lobby") {
        cb({ exists: true });
        return;
      }
      // During game, only allow participants to see the room
      cb({ exists: isGameParticipant(code, sessionId) });
    });

    socket.on("room:join", ({ code }, cb) => {
      const result = joinRoom(code, socket.id, sessionId);
      if (typeof result === "string") {
        cb({ ok: false, error: result });
        return;
      }
      socket.join(result.code);
      cb({ ok: true });
      io.to(result.code).emit("room:state", result);

      // If in lobby, send lobby songs to the joining player
      if (result.phase === "lobby") {
        const songs = getLobbySongs(result.code);
        if (songs) socket.emit("lobby:songs", { songs });
      }

      // If game is in progress, send current state to the rejoining player
      if (result.phase === "playing" && result.round) {
        const songs = getRoomSongs(result.code);
        if (songs) socket.emit("game:songs", { songs });
        socket.emit("game:round", result.round);
      }
    });

    socket.on("room:leave", () => {
      const result = leaveRoom(socket.id);
      if (result) {
        socket.leave(result.room.code);
        io.to(result.room.code).emit("room:state", result.room);
      }
    });

    socket.on("room:nickname", ({ nickname }, cb) => {
      const room = getRoomBySocket(socket.id);
      if (!room) {
        cb({ ok: false, error: "Not in a room" });
        return;
      }
      if (!nickname.trim()) {
        cb({ ok: false, error: "Nickname is required" });
        return;
      }
      const result = setNickname(room.code, socket.id, nickname.trim());
      if (typeof result === "string") {
        cb({ ok: false, error: result });
        return;
      }
      cb({ ok: true });
      io.to(result.code).emit("room:state", result);
    });

    socket.on("room:handicap", ({ seconds }, cb) => {
      const room = getRoomBySocket(socket.id);
      if (!room) {
        cb({ ok: false, error: "Not in a room" });
        return;
      }
      const result = setHandicap(room.code, socket.id, seconds);
      if (typeof result === "string") {
        cb({ ok: false, error: result });
        return;
      }
      cb({ ok: true });
      io.to(result.code).emit("room:state", result);
    });

    socket.on("lobby:songs", ({ songs }) => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room) || room.phase !== "lobby") return;
      setLobbySongs(room.code, songs);
      io.to(room.code).emit("lobby:songs", { songs });
    });

    socket.on("room:settings", (settings) => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room)) return;
      updateSettings(room.code, settings);
      io.to(room.code).emit("room:state", room);
    });

    socket.on("game:start", ({ songs }) => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room)) return;
      saveGameParticipants(room.code);
      const round = startGame(room, songs);
      io.to(room.code).emit("game:songs", { songs });
      io.to(room.code).emit("room:state", room);
      io.to(room.code).emit("game:round", round);
    });

    socket.on("game:play", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room) || !room.round) return;
      const song = getSongForRound(room.code, room.round.roundNumber);
      if (!song) return;
      const duration = room.settings.durationSteps[room.round.currentStepIndex] ?? 1;
      io.to(room.code).emit("game:play-song", {
        songIndex: room.round.roundNumber - 1,
        duration,
      });
    });

    socket.on("game:answer", ({ songId, songTitle }) => {
      const room = getRoomBySocket(socket.id);
      if (!room || !room.round) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      const roundNumber = room.round.roundNumber;
      const delayMs = player.handicapSeconds * 1000;

      const timerId = setTimeout(() => {
        cancelPendingAnswer(room.code, socket.id);
        const currentRoom = getRoomBySocket(socket.id);
        if (!currentRoom || !currentRoom.round || currentRoom.round.roundNumber !== roundNumber) return;

        const result = submitAnswer(currentRoom, socket.id, songId, songTitle);
        if (result.correct) {
          const player = currentRoom.players.find((p) => p.id === socket.id);
          io.to(currentRoom.code).emit("game:scored", {
            playerId: socket.id,
            nickname: player?.nickname ?? "",
            points: result.points,
            position: result.position,
          });
          io.to(currentRoom.code).emit("room:state", currentRoom);

          if (result.allSlotsFilled) {
            cancelAllPendingAnswers(currentRoom.code);
            const song = getSongForRound(currentRoom.code, currentRoom.round.roundNumber);
            io.to(currentRoom.code).emit("game:reveal", {
              song: song!,
              winners: currentRoom.round.winners,
            });
          }
        } else if (result.reason === "wrong") {
          socket.emit("game:wrong-answer", { songTitle });
        }
      }, delayMs);

      addPendingAnswer(room.code, socket.id, {
        timerId,
        socketId: socket.id,
        songId,
        songTitle,
        roomCode: room.code,
        roundNumber,
      });
    });

    socket.on("game:extend", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room) || !room.round) return;
      const duration = extendDuration(room);
      if (duration !== null) {
        io.to(room.code).emit("game:extended", { currentStepIndex: room.round!.currentStepIndex });
      }
    });

    socket.on("game:closeAnswers", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room) || !room.round) return;

      cancelAllPendingAnswers(room.code);
      const song = getSongForRound(room.code, room.round.roundNumber);
      if (song) {
        io.to(room.code).emit("game:reveal", {
          song,
          winners: room.round.winners,
        });
      }
    });

    socket.on("game:next", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room)) return;

      if (!room.round) return;

      if (canAdvanceRound(room)) {
        const round = startRound(room, room.round.roundNumber + 1);
        io.to(room.code).emit("game:round", round);
      } else {
        endGame(room);
        io.to(room.code).emit("game:finished", { players: room.players });
        io.to(room.code).emit("room:state", room);
      }
    });

    socket.on("game:end", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room)) return;
      endGame(room);
      io.to(room.code).emit("game:finished", { players: room.players });
      io.to(room.code).emit("room:state", room);
    });

    socket.on("game:back-to-lobby", () => {
      const room = getRoomBySocket(socket.id);
      if (!room || !isHost(socket.id, room)) return;
      resetToLobby(room);
      io.to(room.code).emit("room:state", room);
    });

    socket.on("disconnect", () => {
      console.log(`disconnected: ${socket.id}`);
      const room = getRoomBySocket(socket.id);
      if (room) cancelPendingAnswer(room.code, socket.id);
      const result = leaveRoom(socket.id);
      if (result) {
        io.to(result.room.code).emit("room:state", result.room);
      }
    });
  });
}
