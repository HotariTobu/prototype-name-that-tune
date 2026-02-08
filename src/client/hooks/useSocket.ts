import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomState, RoundState, Song, Player } from "../../shared/types.ts";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function getSessionId(): string {
  let id = sessionStorage.getItem("ntt-session-id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("ntt-session-id", id);
  }
  return id;
}

export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);
  const sessionId = useRef(getSessionId()).current;
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [reveal, setReveal] = useState<{ song: Song; winnerId: string | null; winnerNickname: string | null } | null>(null);
  const [playSong, setPlaySong] = useState<{ songIndex: number; duration: number } | null>(null);
  const [finished, setFinished] = useState<Player[] | null>(null);
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [lobbySongs, setLobbySongs] = useState<Song[]>([]);

  useEffect(() => {
    const socket: AppSocket = io({ transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:state", (state) => {
      setRoomState(state);
      if (state.phase === "lobby") {
        setRound(null);
        setReveal(null);
        setFinished(null);
        setSongs([]);
        setLobbySongs([]);
      } else {
        setLobbySongs([]);
      }
    });
    socket.on("lobby:songs", (data) => setLobbySongs(data.songs));
    socket.on("game:songs", (data) => setSongs(data.songs));
    socket.on("game:round", (r) => {
      setRound(r);
      setReveal(null);
      setPlaySong(null);
      setWrongAnswer(null);
    });
    socket.on("game:reveal", (data) => setReveal(data));
    socket.on("game:play-song", (data) => setPlaySong(data));
    socket.on("game:wrong-answer", (data) => setWrongAnswer(data.songTitle));
    socket.on("game:finished", (data) => setFinished(data.players));

    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback((): Promise<{ ok: true; code: string } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:create", { sessionId }, resolve);
    });
  }, []);

  const checkRoom = useCallback((code: string): Promise<{ exists: boolean }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:check", { code, sessionId }, resolve);
    });
  }, []);

  const joinRoom = useCallback((code: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:join", { code, sessionId }, resolve);
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("room:leave");
    setRoomState(null);
    setRound(null);
    setReveal(null);
    setFinished(null);
    setSongs([]);
    setLobbySongs([]);
    setPlaySong(null);
    setWrongAnswer(null);
  }, []);

  const setNickname = useCallback((nickname: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:nickname", { nickname }, resolve);
    });
  }, []);

  const updateSettings = useCallback((settings: Parameters<ClientToServerEvents["room:settings"]>[0]) => {
    socketRef.current?.emit("room:settings", settings);
  }, []);

  const sendLobbySongs = useCallback((songs: Song[]) => {
    socketRef.current?.emit("lobby:songs", { songs });
  }, []);

  const startGame = useCallback((songs: Song[]) => {
    socketRef.current?.emit("game:start", { songs });
  }, []);

  const play = useCallback(() => {
    socketRef.current?.emit("game:play");
  }, []);

  const answer = useCallback((songId: string, songTitle: string) => {
    socketRef.current?.emit("game:answer", { songId, songTitle });
  }, []);

  const extend = useCallback(() => {
    socketRef.current?.emit("game:extend");
  }, []);

  const backToLobby = useCallback(() => {
    socketRef.current?.emit("game:back-to-lobby");
  }, []);

  const giveUp = useCallback(() => {
    socketRef.current?.emit("game:giveup");
  }, []);

  const next = useCallback(() => {
    socketRef.current?.emit("game:next");
  }, []);

  const endGame = useCallback(() => {
    socketRef.current?.emit("game:end");
  }, []);

  return {
    socket: socketRef.current,
    connected,
    roomState,
    round,
    reveal,
    playSong,
    finished,
    wrongAnswer,
    songs,
    lobbySongs,
    createRoom,
    checkRoom,
    joinRoom,
    leaveRoom,
    setNickname,
    updateSettings,
    sendLobbySongs,
    startGame,
    play,
    answer,
    extend,
    giveUp,
    next,
    endGame,
    backToLobby,
  };
}
