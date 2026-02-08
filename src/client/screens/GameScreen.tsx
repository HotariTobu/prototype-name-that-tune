import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
    playSong: (song: Song, duration: number) => Promise<void>;
    playFullSong: (song: Song) => Promise<void>;
    stop: () => void;
  };
  songs: Song[];
  wrongAnswer: string | null;
}

export function GameScreen({
  room, round, reveal, playSongEvent, isHost, mySocketId,
  onPlay, onAnswer, onExtend, onGiveUp, onNext, onEnd, onLeave,
  musicKit, songs, wrongAnswer,
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Song[]>([]);
  const [playing, setPlaying] = useState(false);
  const [wrongFeedback, setWrongFeedback] = useState<string | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery("");
    setSuggestions([]);
    setPlaying(false);
    setWrongFeedback(null);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (isHost) musicKit.stop();
  }, [round.roundNumber]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      musicKit.stop();
    };
  }, []);

  useEffect(() => {
    if (wrongAnswer) {
      setWrongFeedback(wrongAnswer);
      const timer = setTimeout(() => setWrongFeedback(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [wrongAnswer]);

  // Show "Playing..." for non-host players
  useEffect(() => {
    if (!playSongEvent || isHost) return;
    setPlaying(true);
    const timer = setTimeout(() => setPlaying(false), playSongEvent.duration * 1000);
    return () => clearTimeout(timer);
  }, [playSongEvent, isHost]);

  // Play full song on reveal (host only), loop until next round
  useEffect(() => {
    if (!reveal || !isHost) return;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    setPlaying(true);
    musicKit.playFullSong(reveal.song);
  }, [reveal]);

  const duration = room.settings.durationSteps[round.currentStepIndex] ?? 1;
  const currentSong = songs[round.roundNumber - 1];

  const startPlayback = (song: Song, durationSec: number) => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    setPlaying(true);
    musicKit.playSong(song, durationSec);
    stopTimerRef.current = setTimeout(() => setPlaying(false), durationSec * 1000);
  };

  const handlePlay = () => {
    if (!currentSong || playing) return;
    startPlayback(currentSong, duration);
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
          {playing && <span className="ml-2 text-blue-600 font-bold">Playing...</span>}
        </div>

        {isHost && !reveal && (
          <div className="flex gap-2">
            <button
              onClick={handlePlay}
              disabled={playing}
              className="bg-blue-600 text-white px-4 py-2 rounded flex-1 disabled:opacity-50"
            >
              Play
            </button>
            <button
              onClick={handleExtend}
              disabled={playing || round.currentStepIndex >= room.settings.durationSteps.length - 1}
              className="bg-orange-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Extend
            </button>
            <button
              onClick={onGiveUp}
              disabled={playing}
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
                </span>
                <span className="font-mono">{p.score}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
