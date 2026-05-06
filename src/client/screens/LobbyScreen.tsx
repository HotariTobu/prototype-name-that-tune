import { useState, useEffect, useRef } from "react";
import Fuse from "fuse.js";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback.ts";
import { useRoomSettings } from "../hooks/useRoomSettings.ts";
import type { RoomState, Song, PlaylistRef } from "../../shared/types.ts";

interface PlaylistChoice {
  id: string;
  name: string;
}

interface Props {
  room: RoomState;
  isHost: boolean;
  mySocketId: string | undefined;
  onSetNickname: (nickname: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSetHandicap: (seconds: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  onUpdateSettings: (settings: any) => void;
  onSendLobbySongs: (songs: Song[]) => void;
  onStart: () => void;
  onLeave: () => void;
  musicKit: {
    authorized: boolean;
    error: string | null;
    authorize: () => Promise<void>;
    unauthorize: () => Promise<void>;
    searchPlaylists: (term: string) => Promise<any[]>;
    getPlaylistSongs: (id: string) => Promise<Song[]>;
    getLibraryPlaylists: () => Promise<any[]>;
    getLibraryPlaylistSongs: (id: string) => Promise<Song[]>;
  };
  lobbySongs: Song[];
}

function combineSelectedSongs(
  playlists: PlaylistRef[],
  cache: Record<string, Song[]>,
): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const p of playlists) {
    const songs = cache[p.id];
    if (!songs) continue;
    for (const s of songs) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

export function LobbyScreen({ room, isHost, mySocketId, onSetNickname, onSetHandicap, onUpdateSettings, onSendLobbySongs, onStart, onLeave, musicKit, lobbySongs }: Props) {
  const myPlayer = room.players.find((p) => p.id === mySocketId);
  const [nickname, setNickname] = useState(myPlayer?.nickname ?? "");
  const [nicknameError, setNicknameError] = useState("");
  const [handicap, setHandicap] = useState(myPlayer?.handicapSeconds ?? 0);
  const settings = useRoomSettings(room.settings, lobbySongs.length, onUpdateSettings);

  // Playlist source state
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [playlists, setPlaylists] = useState<PlaylistChoice[]>([]);
  const [libraryPlaylists, setLibraryPlaylists] = useState<PlaylistChoice[]>([]);
  const [addedPlaylists, setAddedPlaylists] = useState<PlaylistChoice[]>([]);
  const [playlistSource, setPlaylistSource] = useState<"library" | "public">("library");
  const effectiveSource = musicKit.authorized ? playlistSource : "public";
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Per-playlist song cache + lazy fetch state
  const [playlistSongsCache, setPlaylistSongsCache] = useState<Record<string, Song[]>>({});
  const [loadingPlaylistIds, setLoadingPlaylistIds] = useState<Set<string>>(new Set());
  const [errorPlaylistIds, setErrorPlaylistIds] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Source-by-id, used to know which API to fetch from
  // Library and Public have disjoint id namespaces in practice, but track explicitly.
  const sourceByIdRef = useRef<Record<string, "library" | "public">>({});

  const selectedPlaylists = room.settings.playlists;
  const selectedIds = new Set(selectedPlaylists.map((p) => p.id));

  // Re-send combined songs whenever selection or cache changes (after the first mount).
  // Skip if any selected playlist hasn't been fetched yet — wait until cache catches up,
  // so we don't transiently overwrite server lobby songs with a partial set.
  const initialMountRef = useRef(true);
  useEffect(() => {
    if (!isHost) return;
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    const allFetched = selectedPlaylists.every((p) => playlistSongsCache[p.id]);
    if (!allFetched) return;
    const combined = combineSelectedSongs(selectedPlaylists, playlistSongsCache);
    onSendLobbySongs(combined);
  }, [selectedPlaylists, playlistSongsCache, isHost]);

  const debouncedSetNickname = useDebouncedCallback((name: string) => {
    if (!name || name === myPlayer?.nickname) return;
    setNicknameError("");
    onSetNickname(name).then((res) => {
      if (!res.ok) setNicknameError(res.error);
    });
  }, 500);

  const debouncedSetHandicap = useDebouncedCallback((value: number) => {
    if (value === (myPlayer?.handicapSeconds ?? 0)) return;
    onSetHandicap(value);
  }, 300);

  function extractPlaylistId(input: string): string | null {
    const match = input.match(/(pl\.[a-zA-Z0-9_-]+)/);
    return match ? match[1]! : null;
  }

  async function fetchPlaylistSongs(playlistId: string, source: "library" | "public") {
    if (playlistSongsCache[playlistId]) return;
    if (loadingPlaylistIds.has(playlistId)) return;
    sourceByIdRef.current[playlistId] = source;
    setLoadingPlaylistIds((prev) => {
      const next = new Set(prev);
      next.add(playlistId);
      return next;
    });
    setErrorPlaylistIds((prev) => {
      if (!(playlistId in prev)) return prev;
      const next = { ...prev };
      delete next[playlistId];
      return next;
    });
    try {
      const songs = source === "library"
        ? await musicKit.getLibraryPlaylistSongs(playlistId)
        : await musicKit.getPlaylistSongs(playlistId);
      setPlaylistSongsCache((prev) => ({ ...prev, [playlistId]: songs }));
    } catch (e: any) {
      setErrorPlaylistIds((prev) => ({ ...prev, [playlistId]: e?.message || "Failed to load songs" }));
    } finally {
      setLoadingPlaylistIds((prev) => {
        const next = new Set(prev);
        next.delete(playlistId);
        return next;
      });
    }
  }

  function togglePlaylistSelection(playlist: PlaylistChoice, source: "library" | "public") {
    const wasSelected = selectedIds.has(playlist.id);
    const nextPlaylists: PlaylistRef[] = wasSelected
      ? selectedPlaylists.filter((p) => p.id !== playlist.id)
      : [...selectedPlaylists, { id: playlist.id, name: playlist.name }];

    // Clamp totalRounds to new song count from currently-cached selection
    const provisionalCombined = combineSelectedSongs(nextPlaylists, playlistSongsCache);
    onUpdateSettings({ playlists: nextPlaylists, totalRounds: provisionalCombined.length });
    settings.setRounds(provisionalCombined.length);

    if (!wasSelected) {
      fetchPlaylistSongs(playlist.id, source);
    }
  }

  function toggleExpanded(playlist: PlaylistChoice, source: "library" | "public") {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playlist.id)) {
        next.delete(playlist.id);
      } else {
        next.add(playlist.id);
        fetchPlaylistSongs(playlist.id, source);
      }
      return next;
    });
  }

  const handleSwitchToLibrary = async () => {
    setPlaylistSource("library");
    setPlaylistSearch("");
    setSearchError("");
    if (libraryPlaylists.length === 0) {
      setLoadingLibrary(true);
      const fetched = await musicKit.getLibraryPlaylists();
      const choices = fetched.map((p: any) => ({ id: p.id, name: p.name }));
      setLibraryPlaylists(choices);
      setPlaylists(choices);
      setLoadingLibrary(false);
    } else {
      setPlaylists(libraryPlaylists);
    }
  };

  const handleSwitchToPublic = () => {
    setPlaylistSource("public");
    setPlaylists([]);
    setPlaylistSearch("");
    setSearchError("");
  };

  const handleUrlLoad = (url: string) => {
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return;
    setSearchError("");
    const name = `Playlist (${playlistId})`;
    const choice: PlaylistChoice = { id: playlistId, name };

    setAddedPlaylists((prev) => prev.some((p) => p.id === playlistId) ? prev : [...prev, choice]);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(playlistId);
      return next;
    });
    if (!selectedIds.has(playlistId)) {
      togglePlaylistSelection(choice, "public");
    } else {
      // already selected, just kick off fetch if missing
      fetchPlaylistSongs(playlistId, "public");
    }
    setPlaylistSearch("");
  };

  const debouncedSearchPublic = useDebouncedCallback((term: string) => {
    musicKit.searchPlaylists(term).then((results: any[]) => {
      setPlaylists(results.map((p) => ({ id: p.id, name: p.name })));
    });
  }, 500);

  const debouncedUrlLoad = useDebouncedCallback((url: string) => {
    handleUrlLoad(url);
  }, 500);

  const handlePlaylistSearchChange = (value: string) => {
    setPlaylistSearch(value);
    const trimmed = value.trim();
    if (!trimmed) {
      if (effectiveSource === "library") setPlaylists(libraryPlaylists);
      else setPlaylists([]);
      return;
    }
    if (extractPlaylistId(value)) {
      debouncedUrlLoad(value);
      return;
    }
    if (effectiveSource === "library") {
      const fuse = new Fuse(libraryPlaylists, { keys: ["name"], threshold: 0.4 });
      setPlaylists(fuse.search(trimmed).map((r) => r.item));
      return;
    }
    debouncedSearchPublic(trimmed);
  };

  const handleStart = () => {
    if (lobbySongs.length === 0) return;
    onStart();
  };

  // Build the visible playlist list = candidates from current tab + URL-pasted ones,
  // de-duplicated. URL-pasted items appear first (they are most recently added).
  const visiblePlaylists: PlaylistChoice[] = (() => {
    const seen = new Set<string>();
    const out: PlaylistChoice[] = [];
    for (const p of addedPlaylists) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    for (const p of playlists) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  })();

  const renderPlaylistRow = (playlist: PlaylistChoice) => {
    const checked = selectedIds.has(playlist.id);
    const expanded = expandedIds.has(playlist.id);
    const loading = loadingPlaylistIds.has(playlist.id);
    const error = errorPlaylistIds[playlist.id];
    const songs = playlistSongsCache[playlist.id];
    const source = sourceByIdRef.current[playlist.id] ?? effectiveSource;

    return (
      <li key={playlist.id} className="border rounded bg-white">
        <div className="flex items-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePlaylistSelection(playlist, source); }}
            aria-label={checked ? "Deselect playlist" : "Select playlist"}
            className={`flex items-center justify-center w-10 h-10 shrink-0 ${checked ? "text-blue-600" : "text-gray-300"} hover:text-blue-700`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded border-2 ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-gray-400 bg-white"}`}>
              {checked && (
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor" aria-hidden>
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0Z" />
                </svg>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleExpanded(playlist, source)}
            className="flex-1 text-left p-2 hover:bg-gray-50 rounded-r flex items-center justify-between"
          >
            <span className="truncate">{playlist.name}</span>
            <span className={`ml-2 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
          </button>
        </div>
        {expanded && (
          <div className="border-t px-2 py-2">
            {loading && (
              <ul className="space-y-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gray-200 rounded animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                      <div className="h-2.5 bg-gray-200 rounded animate-pulse w-1/2" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!loading && error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}
            {!loading && !error && songs && songs.length === 0 && (
              <p className="text-sm text-gray-500">No songs in this playlist.</p>
            )}
            {!loading && !error && songs && songs.length > 0 && (
              <ul className="space-y-1 max-h-60 overflow-y-auto">
                {songs.map((song, i) => (
                  <li key={song.id} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-400 w-6 text-right shrink-0">{i + 1}</span>
                    {song.artworkUrl && (
                      <img src={song.artworkUrl} alt="" className="w-8 h-8 rounded shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{song.title}</p>
                      <p className="truncate text-gray-500 text-xs">{song.artist}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col items-center min-h-screen p-4 gap-4">
      <div className="w-full max-w-md">
        <button onClick={onLeave} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Home
        </button>
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Room: {room.code}</h1>
        <p className="text-gray-500 text-sm">Share this code with other players</p>
      </div>

      {/* User Settings */}
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold">User Settings</h2>
        <div className="bg-white border rounded p-4">
          <h3 className="font-bold mb-2">Nickname</h3>
          <input
            type="text"
            placeholder="Enter nickname"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); debouncedSetNickname(e.target.value.trim()); }}
            maxLength={20}
            className="border p-2 rounded w-full"
          />
          {nicknameError && <p className="text-red-500 text-sm mt-1">{nicknameError}</p>}
        </div>

        <div className="bg-white border rounded p-4">
          <h3 className="font-bold mb-2">Handicap Delay</h3>
          <p className="text-gray-500 text-sm mb-2">
            Add a delay before your answers are processed.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={30}
              step={0.1}
              value={handicap}
              onChange={(e) => { const v = Number(e.target.value); setHandicap(v); debouncedSetHandicap(v); }}
              className="flex-1"
            />
            <span className="font-mono w-10 text-center">{handicap}s</span>
          </div>
        </div>
      </div>

      {/* Room Settings */}
      <div className="w-full max-w-md space-y-3">
        <h2 className="text-lg font-bold">Room Settings</h2>

        <div className="bg-gray-100 rounded p-4">
          <h3 className="font-bold mb-2">Players ({room.players.length})</h3>
          <ul className="space-y-1">
            {room.players.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span className={p.nickname ? "" : "text-gray-400 italic"}>
                  {p.nickname || "No name yet"}
                  {p.handicapSeconds > 0 && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">+{p.handicapSeconds}s</span>
                  )}
                </span>
                {p.isHost && <span className="text-xs bg-yellow-200 px-2 py-0.5 rounded">Host</span>}
              </li>
            ))}
          </ul>
        </div>

        {isHost && (
          <div className="space-y-3">
            {musicKit.error && (
              <p className="text-red-500 text-sm">{musicKit.error}</p>
            )}
            {!musicKit.authorized ? (
              <button onClick={async () => { await musicKit.authorize(); handleSwitchToLibrary(); }} className="bg-pink-600 text-white px-4 py-2 rounded w-full">
                Authorize Apple Music
              </button>
            ) : (
              <button onClick={musicKit.unauthorize} className="text-sm text-gray-500 underline self-end">
                Sign out of Apple Music
              </button>
            )}

            {musicKit.authorized ? (
              <div className="flex border-b">
                <button
                  onClick={handleSwitchToLibrary}
                  className={`px-4 py-2 text-sm font-medium ${playlistSource === "library" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
                >
                  My Library
                </button>
                <button
                  onClick={handleSwitchToPublic}
                  className={`px-4 py-2 text-sm font-medium ${playlistSource === "public" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
                >
                  Public
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Sign in to Apple Music to select playlists from your library
              </p>
            )}

            <input
              type="text"
              placeholder="Search or paste playlist URL"
              value={playlistSearch}
              onChange={(e) => handlePlaylistSearchChange(e.target.value)}
              className="border p-2 rounded w-full"
            />

            {searchError && <p className="text-red-500 text-sm">{searchError}</p>}
            {loadingLibrary && <p className="text-sm text-gray-500">Loading library playlists...</p>}

            {visiblePlaylists.length > 0 && (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {visiblePlaylists.map(renderPlaylistRow)}
              </ul>
            )}

            {selectedPlaylists.length > 0 && (
              <p className="text-xs text-gray-500">
                Selected {selectedPlaylists.length} playlist{selectedPlaylists.length === 1 ? "" : "s"} • {lobbySongs.length} song{lobbySongs.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}

        {!isHost && lobbySongs.length > 0 && (
          <div>
            <h3 className="font-bold mb-2">Songs ({lobbySongs.length})</h3>
            <ul className="space-y-1 max-h-60 overflow-y-auto border rounded p-2 bg-white">
              {lobbySongs.map((song, i) => (
                <li key={song.id} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-6 text-right shrink-0">{i + 1}</span>
                  {song.artworkUrl && (
                    <img src={song.artworkUrl} alt="" className="w-8 h-8 rounded shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{song.title}</p>
                    <p className="truncate text-gray-500 text-xs">{song.artist}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isHost ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block font-bold">
                Duration steps (seconds, comma-separated)
                <input
                  type="text"
                  value={settings.durationStepsInput}
                  onChange={(e) => settings.setDurationStepsInput(e.target.value)}
                  placeholder="1, 2, 4, 8, 16"
                  className="border p-2 rounded w-full font-normal mt-1"
                />
              </label>
              <label className="block font-bold">
                Scoring (points by finish order, comma-separated)
                <input
                  type="text"
                  value={settings.scoringInput}
                  onChange={(e) => settings.setScoringInput(e.target.value)}
                  placeholder="4, 2, 1"
                  className="border p-2 rounded w-full font-normal mt-1"
                />
                <span className="text-xs text-gray-500 font-normal">e.g. "4, 2, 1" = 1st gets 4pts, 2nd gets 2pts, 3rd gets 1pt</span>
              </label>
              {lobbySongs.length > 0 && (
                <label className="block font-bold">
                  Rounds: {settings.rounds}
                  <input
                    type="range"
                    min={1}
                    max={lobbySongs.length}
                    value={settings.rounds}
                    onChange={(e) => settings.setRounds(Number(e.target.value))}
                    className="w-full"
                  />
                </label>
              )}
              <label className="block font-bold">
                Wrong answer lockout (seconds, 0 = off): {settings.penaltyLockout}
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={settings.penaltyLockout}
                  onChange={(e) => settings.setPenaltyLockout(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <label className="block font-bold">
                Max attempts per round (0 = unlimited): {settings.penaltyMaxAttempts}
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={settings.penaltyMaxAttempts}
                  onChange={(e) => settings.setPenaltyMaxAttempts(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>

            <button
              onClick={handleStart}
              disabled={lobbySongs.length === 0}
              className="bg-green-600 text-white px-6 py-3 rounded w-full text-lg font-bold disabled:opacity-50"
            >
              Start Game
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">Duration steps: <span className="font-mono">{room.settings.durationSteps.join(", ")}s</span></p>
            <p className="text-sm">Scoring: <span className="font-mono">{room.settings.scoringScheme.join(", ")}</span></p>
            <p className="text-sm">Rounds: <span className="font-mono">{room.settings.totalRounds}</span></p>
            <p className="text-sm">Wrong answer lockout: <span className="font-mono">{room.settings.penaltyLockoutSeconds}s</span></p>
            <p className="text-sm">Max attempts: <span className="font-mono">{room.settings.penaltyMaxAttempts}</span></p>
          </div>
        )}

        {!isHost && lobbySongs.length === 0 && (
          <p className="text-gray-500">Waiting for the host to select a playlist...</p>
        )}
        {!isHost && lobbySongs.length > 0 && (
          <p className="text-gray-500">Waiting for the host to start the game...</p>
        )}
      </div>

    </div>
  );
}
