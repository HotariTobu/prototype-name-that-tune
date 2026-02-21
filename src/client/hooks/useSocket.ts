import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomState, RoundState, Song, RoundWinner } from "../../shared/types.ts";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketCallbacks {
  onLobbySongs?: (songs: Song[]) => void;
  onGameSongs?: (songs: Song[]) => void;
  onGameRound?: (round: RoundState) => void;
  onReveal?: () => void;
}

export function useSocket(callbacks?: SocketCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const socketRef = useRef<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [scoredPlayers, setScoredPlayers] = useState<RoundWinner[]>([]);
  const [playSong, setPlaySong] = useState<{ songIndex: number; duration: number } | null>(null);
  const [wrongAnswer, setWrongAnswer] = useState<string | null>(null);
  const [lobbySongs, setLobbySongs] = useState<Song[]>([]);
  const [answerPending, setAnswerPending] = useState<{ songTitle: string; submittedAt: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Ensure session cookie is set before connecting
    fetch("/api/session").then(() => {
      if (cancelled) return;

      const socket: AppSocket = io({
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));
      socket.on("room:error", () => {
        setRoomState(null);
        setRound(null);
        setLobbySongs([]);
        setPlaySong(null);
        setWrongAnswer(null);
        setAnswerPending(null);
        setScoredPlayers([]);
      });
      socket.on("room:state", (state) => {
        setRoomState(state);
        if (state.phase === "lobby") {
          setRound(null);
          setScoredPlayers([]);
        }
      });
      socket.on("lobby:songs", (data) => {
        setLobbySongs(data.songs);
        callbacksRef.current?.onLobbySongs?.(data.songs);
      });
      socket.on("game:songs", (data) => {
        callbacksRef.current?.onGameSongs?.(data.songs);
      });
      socket.on("game:round", (r) => {
        setRound(r);
        setPlaySong(null);
        setWrongAnswer(null);
        setAnswerPending(null);
        setScoredPlayers([]);
        callbacksRef.current?.onGameRound?.(r);
      });
      socket.on("game:scored", (data) => {
        setScoredPlayers((prev) => [...prev, { playerId: data.playerId, nickname: data.nickname, points: data.points }]);
        setAnswerPending((prev) => prev && data.playerId === socket.id ? null : prev);
      });
      socket.on("game:reveal", (data) => {
        setRound(prev => prev ? { ...prev, revealedSong: data.song, winners: data.winners } : prev);
        setAnswerPending(null);
        callbacksRef.current?.onReveal?.();
      });
      socket.on("game:extended", (data) => {
        setRound((prev) => prev ? { ...prev, currentStepIndex: data.currentStepIndex } : prev);
      });
      let playSongTimer: ReturnType<typeof setTimeout> | null = null;
      let wrongAnswerTimer: ReturnType<typeof setTimeout> | null = null;
      socket.on("game:play-song", (data) => {
        if (playSongTimer) clearTimeout(playSongTimer);
        setPlaySong(data);
        playSongTimer = setTimeout(() => setPlaySong(null), data.duration * 1000);
      });
      socket.on("game:wrong-answer", (data) => {
        if (wrongAnswerTimer) clearTimeout(wrongAnswerTimer);
        setWrongAnswer(data.songTitle);
        setAnswerPending(null);
        wrongAnswerTimer = setTimeout(() => setWrongAnswer(null), 2000);
      });
      socket.on("game:finished", () => {
        // State handled by room:state (phase=finished). Nothing to do here.
      });
    });

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
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

  const startGame = useCallback(() => {
    socketRef.current?.emit("game:start");
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

  const closeAnswers = useCallback(() => {
    socketRef.current?.emit("game:closeAnswers");
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
    playSong,
    wrongAnswer,
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
    closeAnswers,
    next,
    endGame,
    backToLobby,
    answerPending,
    scoredPlayers,
  };
}
