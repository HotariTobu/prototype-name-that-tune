import { useState, useEffect, useCallback, useMemo } from "react";
import Fuse from "fuse.js";
import type { RoomState, RoundState, Song } from "../../shared/types.ts";

interface Props {
  room: RoomState;
  round: RoundState;
  reveal: { song: Song; winnerId: string | null; winnerNickname: string | null } | null;
  playSongEvent: { songIndex: number; duration: number } | null;
  isHost: boolean;
  mySocketId: string | undefined;
  onPlay: () => void;
  onAnswer: (songId: string, songTitle: string) => void;
  onExtend: () => void;
  onGiveUp: () => void;
  onNext: () => void;
  onEnd: () => void;
  onLeave: () => void;
  musicKit: {
    searchSongs: (term: string) => Promise<Song[]>;
    playSong: (song: Song, duration: number) => void;
    playFullSong: (song: Song) => void;
    stop: () => void;
    playing: boolean;
  };
  songs: Song[];
  wrongAnswer: string | null;
  answerPending: { songTitle: string; submittedAt: number } | null;
}

export function GameScreen({
  room, round, reveal, playSongEvent, isHost, mySocketId,
  onPlay, onAnswer, onExtend, onGiveUp, onNext, onEnd, onLeave,
  musicKit, songs, wrongAnswer, answerPending,
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Song[]>([]);
  const [remotePlayingIndicator, setRemotePlayingIndicator] = useState(false);
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const [pendingCountdown, setPendingCountdown] = useState<number | null>(null);

  const isPlaying = isHost ? musicKit.playing : remotePlayingIndicator;

  useEffect(() => {
    setQuery("");
    setSuggestions([]);
    setWrongFeedback(null);
    if (isHost) musicKit.stop();
  }, [round.roundNumber]);

  useEffect(() => {
    return () => { musicKit.stop(); };
  }, []);

  useEffect(() => {
    if (wrongAnswer) {
      setWrongFeedback(wrongAnswer);
      const timer = setTimeout(() => setWrongFeedback(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [wrongAnswer]);

  const myPlayer = room.players.find((p) => p.id === mySocketId);
  const myHandicap = myPlayer?.handicapSeconds ?? 0;

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

  // Show "Playing..." for non-host players (timer-based, no actual audio)
  useEffect(() => {
    if (!playSongEvent || isHost) return;
    setRemotePlayingIndicator(true);
    const timer = setTimeout(() => setRemotePlayingIndicator(false), playSongEvent.duration * 1000);
    return () => clearTimeout(timer);
  }, [playSongEvent, isHost]);

  // Play full song on reveal (host only), loop until next round
  useEffect(() => {
    if (!reveal || !isHost) return;
    musicKit.playFullSong(reveal.song);
  }, [reveal]);

  const duration = room.settings.durationSteps[round.currentStepIndex] ?? 1;
  const currentSong = songs[round.roundNumber - 1];

  const handlePlay = () => {
    if (!currentSong || isPlaying) return;
    musicKit.playSong(currentSong, duration);
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

  const handleSearch = useCallback((term: string) => {
    setQuery(term);
    if (term.length < 1) {
      setSuggestions([]);
      return;
    }
    setSuggestions(fuse.search(term, { limit: 10 }).map((r) => r.item));
  }, [fuse]);

  const handleSelect = (song: Song) => {
    if (reveal) return;
    onAnswer(song.id, song.title);
    setSuggestions([]);
    setQuery("");
  };

  return (
    <div className="flex flex-col min-h-screen p-4 gap-4">
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
              disabled={isPlaying}
              className="bg-blue-600 text-white px-4 py-2 rounded flex-1 disabled:opacity-50"
            >
              Play
            </button>
            <button
              onClick={handleExtend}
              disabled={isPlaying || round.currentStepIndex >= room.settings.durationSteps.length - 1}
              className="bg-orange-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Extend
            </button>
            <button
              onClick={onGiveUp}
              disabled={isPlaying}
              className="bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Give Up
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
          {reveal.winnerNickname ? (
            <p className="text-green-600 font-bold">{reveal.winnerNickname} got it!</p>
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
        <div className="space-y-2">
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
          {wrongFeedback && (
            <p className="text-center text-red-500 font-bold">
              Wrong: {wrongFeedback}
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
        </div>
      )}

      <div className="mt-auto">
        <button onClick={onLeave} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
          &larr; Back to Home
        </button>
        <h3 className="font-bold text-sm mb-1">Scoreboard</h3>
        <ul className="text-sm space-y-1">
          {[...room.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {p.nickname}
                  {p.id === mySocketId ? " (you)" : ""}
                  {p.handicapSeconds > 0 && (
                    <span className="ml-1 text-xs text-gray-400">+{p.handicapSeconds}s</span>
                  )}
                </span>
                <span className="font-mono">{p.score}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
