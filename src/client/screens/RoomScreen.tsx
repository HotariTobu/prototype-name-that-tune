import { useState, useEffect } from "react";
import { LobbyScreen } from "./LobbyScreen.tsx";
import { GameScreen } from "./GameScreen.tsx";
import { ResultScreen } from "./ResultScreen.tsx";
import type { Song } from "../../shared/types.ts";

interface Props {
  roomCode: string;
  navigate: (path: string) => void;
  socket: {
    connected: boolean;
    socket: { id: string | undefined } | null;
    roomState: import("../../shared/types.ts").RoomState | null;
    round: import("../../shared/types.ts").RoundState | null;
    scoredPlayers: import("../../shared/types.ts").RoundWinner[];
    playSong: { songIndex: number; duration: number } | null;
    checkRoom: (code: string) => Promise<{ exists: boolean }>;
    joinRoom: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    leaveRoom: () => void;
    setNickname: (nickname: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    setHandicap: (seconds: number) => Promise<{ ok: true } | { ok: false; error: string }>;
    updateSettings: (settings: any) => void;
    sendLobbySongs: (songs: Song[]) => void;
    startGame: () => void;
    play: () => void;
    answer: (songId: string, songTitle: string) => void;
    extend: () => void;
    closeAnswers: () => void;
    next: () => void;
    endGame: () => void;
    backToLobby: () => void;
    wrongAnswer: string | null;
    lobbySongs: Song[];
    answerPending: { songTitle: string; submittedAt: number } | null;
  };
  isHost: boolean;
  musicKit: any;
}

export function RoomScreen({ roomCode, navigate, socket, isHost, musicKit }: Props) {
  const [joinError, setJoinError] = useState("");
  const [roomExists, setRoomExists] = useState<boolean | null>(null);
  const [autoJoining, setAutoJoining] = useState(false);

  const inRoom = socket.roomState?.code === roomCode;

  // Leave room on unmount (SPA navigation away)
  useEffect(() => {
    return () => {
      socket.leaveRoom();
    };
  }, []);

  useEffect(() => {
    if (!inRoom && !autoJoining) {
      socket.checkRoom(roomCode).then((res) => {
        setRoomExists(res.exists);
        if (res.exists) {
          setAutoJoining(true);
          socket.joinRoom(roomCode).then((joinRes) => {
            setAutoJoining(false);
            if (!joinRes.ok) {
              if (joinRes.error === "Already in room") {
                // Already joined (e.g. host), wait for room:state
              } else {
                setJoinError(joinRes.error);
              }
            }
          });
        }
      });
    }
  }, [roomCode, inRoom]);

  // Not in this room yet
  if (!inRoom) {
    if (joinError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
          <h1 className="text-3xl font-bold">Cannot join room</h1>
          <p className="text-red-500">{joinError}</p>
          <button onClick={() => navigate("/")} className="text-blue-600 underline">
            Back to Home
          </button>
        </div>
      );
    }

    if (roomExists === false) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
          <h1 className="text-3xl font-bold">Room not found</h1>
          <p className="text-gray-500">Room {roomCode} does not exist or the game has already started.</p>
          <button onClick={() => navigate("/")} className="text-blue-600 underline">
            Back to Home
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Joining room...</p>
      </div>
    );
  }

  const room = socket.roomState!;

  const handleStart = () => {
    socket.startGame();
  };

  // Finished
  if (room.phase === "finished") {
    return (
      <ResultScreen
        players={room.players}
        mySocketId={socket.socket?.id}
        isHost={isHost}
        onBackToLobby={socket.backToLobby}
        onLeave={() => navigate("/")}
      />
    );
  }

  // Playing or Paused
  if ((room.phase === "playing" || room.phase === "paused") && socket.round) {
    const reveal = socket.round.revealedSong
      ? { song: socket.round.revealedSong, winners: socket.round.winners }
      : null;
    return (
      <GameScreen
        room={room}
        round={socket.round}
        reveal={reveal}
        playSongEvent={socket.playSong}
        scoredPlayers={socket.scoredPlayers}
        isHost={isHost}
        mySocketId={socket.socket?.id}
        onPlay={socket.play}
        onAnswer={socket.answer}
        onExtend={socket.extend}
        onCloseAnswers={socket.closeAnswers}
        onNext={socket.next}
        onEnd={socket.endGame}
        onLeave={() => navigate("/")}
        wrongAnswer={socket.wrongAnswer}
        answerPending={socket.answerPending}
        musicKit={musicKit}
        songs={socket.lobbySongs}
      />
    );
  }

  // Lobby (default)
  return (
    <LobbyScreen
      room={room}
      isHost={isHost}
      mySocketId={socket.socket?.id}
      onSetNickname={socket.setNickname}
      onSetHandicap={socket.setHandicap}
      onUpdateSettings={socket.updateSettings}
      onSendLobbySongs={socket.sendLobbySongs}
      onStart={handleStart}
      onLeave={() => navigate("/")}
      musicKit={musicKit}
      lobbySongs={socket.lobbySongs}
    />
  );
}
