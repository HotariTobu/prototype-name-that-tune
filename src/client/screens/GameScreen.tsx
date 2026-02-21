import { useState, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import type { RoomState, RoundState, Song, RoundWinner } from "../../shared/types.ts";

interface Props {
  room: RoomState;
  round: RoundState;
  reveal: { song: Song; winners: RoundWinner[] } | null;
  playSongEvent: { songIndex: number; duration: number } | null;
  scoredPlayers: RoundWinner[];
  isHost: boolean;
  mySocketId: string | undefined;
  onPlay: () => void;
  onAnswer: (songId: string, songTitle: string) => void;
  onExtend: () => void;
  onCloseAnswers: () => void;
  onNext: () => void;
  onEnd: () => void;
  onLeave: () => void;
  musicKit: {
    playSong: (duration: number) => void;
    stop: () => void;
    playing: boolean;
    preparing: boolean;
    loading: boolean;
    cleanup: () => void;
  };
  songs: Song[];
  wrongAnswer: string | null;
  answerPending: { songTitle: string; submittedAt: number } | null;
}

export function GameScreen({
  room, round, reveal, playSongEvent, scoredPlayers, isHost, mySocketId,
  onPlay, onAnswer, onExtend, onCloseAnswers, onNext, onEnd, onLeave,
  musicKit, songs, wrongAnswer, answerPending,
}: Props) {
  const [pendingCountdown, setPendingCountdown] = useState<number | null>(null);

  const isPlaying = isHost ? musicKit.playing : playSongEvent !== null;

  useEffect(() => {
    return () => { musicKit.cleanup(); };
  }, []);

  const myPlayer = room.players.find((p) => p.id === mySocketId);
  const myHandicap = myPlayer?.handicapSeconds ?? 0;
  const myScore = scoredPlayers.find((w) => w.playerId === mySocketId);

  useEffect(() => {
    if (!answerPending || myHandicap <= 0) {
      setPendingCountdown(null);
      return;
    }
    const endTime = answerPending.submittedAt + myHandicap * 1000;
    const update = () => {
      const remaining = Math.max(0, (endTime - Date.now()) / 1000);
      setPendingCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    };
    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [answerPending, myHandicap]);

  const duration = room.settings.durationSteps[round.currentStepIndex] ?? 1;

  const songReady = !musicKit.preparing && !musicKit.loading;

  const handlePlay = () => {
    if (isPlaying || !songReady) return;
    musicKit.playSong(duration);
    onPlay();
  };

  const handleExtend = () => {
    if (round.currentStepIndex >= room.settings.durationSteps.length - 1) return;
    onExtend();
  };

  const fuse = useMemo(
    () => new Fuse(songs, { keys: ["title"], threshold: 0.4 }),
    [songs]
  );

  return (
    <div className="flex flex-col min-h-screen p-4 gap-4">
      {room.phase === "paused" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 text-center max-w-sm mx-4">
            <h2 className="text-xl font-bold mb-2">Game Paused</h2>
            <p className="text-gray-600">Waiting for the host to reconnect...</p>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">
          Round {round.roundNumber}{room.settings.totalRounds > 0 ? `/${room.settings.totalRounds}` : ""}
        </h2>
        <div className="text-right">
          {isHost && (
            <button onClick={onEnd} className="text-sm text-red-500 underline">
              End Game
            </button>
          )}
        </div>
      </div>

      <div className="bg-gray-100 rounded p-3">
        <div className="text-sm mb-2">
          Duration: {duration}s
          {isPlaying && <span className="ml-2 text-blue-600 font-bold">Playing...</span>}
        </div>

        {isHost && !reveal && (
          <div className="flex gap-2">
            <button
              onClick={handlePlay}
              disabled={isPlaying || !songReady}
              className="bg-blue-600 text-white px-4 py-2 rounded flex-1 disabled:opacity-50"
            >
              {musicKit.preparing ? "Preparing..." : musicKit.loading ? "Loading..." : "Play"}
            </button>
            <button
              onClick={handleExtend}
              disabled={isPlaying || !songReady || round.currentStepIndex >= room.settings.durationSteps.length - 1}
              className="bg-orange-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Extend
            </button>
            <button
              onClick={onCloseAnswers}
              disabled={isPlaying}
              className="bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Close Answers
            </button>
          </div>
        )}
      </div>

      {reveal ? (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            {reveal.song.artworkUrl && (
              <img src={reveal.song.artworkUrl} alt="" className="w-16 h-16 rounded" />
            )}
            <div>
              <p className="font-bold text-lg">{reveal.song.title}</p>
              <p className="text-gray-500">{reveal.song.artist}</p>
            </div>
          </div>
          {reveal.winners.length > 0 ? (
            <ul className="space-y-1 mt-1">
              {reveal.winners.map((w, i) => (
                <li key={w.playerId} className="text-green-600 font-bold">
                  {i + 1}. {w.nickname} (+{w.points}pt{w.points !== 1 ? "s" : ""})
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No one got it</p>
          )}
          {isHost && (
            <button
              onClick={onNext}
              className="mt-3 bg-blue-600 text-white px-6 py-2 rounded"
            >
              {room.settings.totalRounds === 0 || round.roundNumber < room.settings.totalRounds ? "Next Round" : "See Results"}
            </button>
          )}
        </div>
      ) : (
        <SearchSection
          key={round.roundNumber}
          songs={songs}
          fuse={fuse}
          scoredPlayers={scoredPlayers}
          myScore={myScore}
          answerPending={answerPending}
          pendingCountdown={pendingCountdown}
          myHandicap={myHandicap}
          wrongAnswer={wrongAnswer}
          reveal={reveal}
          onAnswer={onAnswer}
        />
      )}

      <div className="mt-auto">
        <button onClick={onLeave} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
          &larr; Back to Home
        </button>
        <h3 className="font-bold text-sm mb-1">Scoreboard</h3>
        <ul className="text-sm space-y-1">
          {(() => {
            const sorted = [...room.players].sort((a, b) => b.score - a.score);
            const getRank = (i: number): number => i === 0 || sorted[i]!.score !== sorted[i - 1]!.score ? i + 1 : getRank(i - 1);
            return sorted.map((p, i) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  <span className="font-mono text-xs text-gray-400 w-5 inline-block">{getRank(i)}.</span>
                  {p.nickname}
                  {p.id === mySocketId ? " (you)" : ""}
                  {p.handicapSeconds > 0 && (
                    <span className="ml-1 text-xs text-gray-400">+{p.handicapSeconds}s</span>
                  )}
                </span>
                <span className="font-mono">{p.score}</span>
              </li>
            ));
          })()}
        </ul>
      </div>
    </div>
  );
}

function SearchSection({
  songs, fuse, scoredPlayers, myScore, answerPending, pendingCountdown,
  myHandicap, wrongAnswer, reveal, onAnswer,
}: {
  songs: Song[];
  fuse: Fuse<Song>;
  scoredPlayers: RoundWinner[];
  myScore: RoundWinner | undefined;
  answerPending: { songTitle: string; submittedAt: number } | null;
  pendingCountdown: number | null;
  myHandicap: number;
  wrongAnswer: string | null;
  reveal: { song: Song; winners: RoundWinner[] } | null;
  onAnswer: (songId: string, songTitle: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Song[]>([]);

  const handleSearch = (term: string) => {
    setQuery(term);
    if (term.length < 1) {
      setSuggestions([]);
      return;
    }
    setSuggestions(fuse.search(term, { limit: 10 }).map((r) => r.item));
  };

  const handleSelect = (song: Song) => {
    if (reveal) return;
    onAnswer(song.id, song.title);
    setSuggestions([]);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      {scoredPlayers.length > 0 && (
        <div className="space-y-1">
          {scoredPlayers.map((w, i) => (
            <div key={w.playerId} className="bg-green-50 border border-green-200 rounded p-2 text-center text-sm">
              <span className="text-green-700 font-bold">{w.nickname}</span> scored {w.points}pt{w.points !== 1 ? "s" : ""}! ({i + 1}{i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"})
            </div>
          ))}
        </div>
      )}
      {myScore ? (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 text-center">
          <p className="text-blue-700 font-bold text-lg">You scored {myScore.points} point{myScore.points !== 1 ? "s" : ""}!</p>
        </div>
      ) : (
        <>
          {answerPending && pendingCountdown !== null && pendingCountdown > 0 && (
            <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-center">
              <p className="text-yellow-700 text-sm">
                "{answerPending.songTitle}" — checking in {pendingCountdown.toFixed(1)}s
              </p>
              <div className="mt-1 h-1.5 bg-yellow-200 rounded overflow-hidden">
                <div
                  className="h-full bg-yellow-500 transition-all duration-100"
                  style={{ width: `${(pendingCountdown / myHandicap) * 100}%` }}
                />
              </div>
            </div>
          )}
          {wrongAnswer && (
            <p className="text-center text-red-500 font-bold">
              Wrong: {wrongAnswer}
            </p>
          )}
          <input
            type="text"
            placeholder="Type the song title..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="border p-2 rounded w-full"
            autoFocus
          />
          {suggestions.length > 0 && (
            <ul className="border rounded max-h-60 overflow-y-auto">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => handleSelect(s)}
                    className="w-full text-left p-2 hover:bg-blue-50 flex items-center gap-2"
                  >
                    {s.artworkUrl && (
                      <img src={s.artworkUrl} alt="" className="w-10 h-10 rounded" />
                    )}
                    <div>
                      <p className="font-medium">{s.title}</p>
                      <p className="text-sm text-gray-500">{s.artist}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
