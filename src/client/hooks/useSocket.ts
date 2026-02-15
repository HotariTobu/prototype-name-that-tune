import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomState, RoundState, Song, Player, RoundWinner } from "../../shared/types.ts";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const socketRef = useRef<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [reveal, setReveal] = useState<{ song: Song; winners: RoundWinner[] } | null>(null);
  const [scoredPlayers, setScoredPlayers] = useState<RoundWinner[]>([]);
  const [playSong, setPlaySong] = useState<{ songIndex: number; duration: number } | null>(null);
  const [finished, setFinished] = useState<Player[] | null>(null);
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [lobbySongs, setLobbySongs] = useState<Song[]>([]);
  const [answerPending, setAnswerPending] = useState<{ songTitle: string; submittedAt: number } | null>(null);

  useEffect(() => {
    const socket: AppSocket = io({
      transports: ["websocket"],
      auth: { sessionId: sessionStorage.getItem("ntt-session-id") || undefined },
    });
    socketRef.current = socket;

    socket.on("session:id", (id) => {
      sessionStorage.setItem("ntt-session-id", id);
    });
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
        setScoredPlayers([]);
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
      setAnswerPending(null);
      setScoredPlayers([]);
    });
    socket.on("game:scored", (data) => {
      setScoredPlayers((prev) => [...prev, { playerId: data.playerId, nickname: data.nickname, points: data.points }]);
      setAnswerPending((prev) => prev && data.playerId === socket.id ? null : prev);
    });
    socket.on("game:reveal", (data) => {
      setReveal(data);
      setAnswerPending(null);
    });
    socket.on("game:extended", (data) => {
      setRound((prev) => prev ? { ...prev, currentStepIndex: data.currentStepIndex } : prev);
    });
    socket.on("game:play-song", (data) => setPlaySong(data));
    socket.on("game:wrong-answer", (data) => {
      setWrongAnswer(data.songTitle);
      setAnswerPending(null);
    });
    socket.on("game:finished", (data) => setFinished(data.players));

    return () => {
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback((): Promise<{ ok: true; code: string } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:create", {}, resolve);
    });
  }, []);

  const checkRoom = useCallback((code: string): Promise<{ exists: boolean }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:check", { code }, resolve);
    });
  }, []);

  const joinRoom = useCallback((code: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:join", { code }, resolve);
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
    setAnswerPending(null);
    setScoredPlayers([]);
  }, []);

  const setNickname = useCallback((nickname: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:nickname", { nickname }, resolve);
    });
  }, []);

  const setHandicap = useCallback((seconds: number): Promise<{ ok: true } | { ok: false; error: string }> => {
    return new Promise((resolve) => {
      socketRef.current?.emit("room:handicap", { seconds }, resolve);
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
    const myPlayer = roomState?.players.find((p) => p.id === socketRef.current?.id);
    if (myPlayer && myPlayer.handicapSeconds > 0) {
      setAnswerPending({ songTitle, submittedAt: Date.now() });
    }
  }, [roomState]);

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
    setHandicap,
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
    answerPending,
    scoredPlayers,
  };
}
