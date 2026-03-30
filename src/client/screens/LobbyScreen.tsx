import { useState } from "react";
import Fuse from "fuse.js";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback.ts";
import { useRoomSettings } from "../hooks/useRoomSettings.ts";
import type { RoomState, Song } from "../../shared/types.ts";

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

export function LobbyScreen({ room, isHost, mySocketId, onSetNickname, onSetHandicap, onUpdateSettings, onSendLobbySongs, onStart, onLeave, musicKit, lobbySongs }: Props) {
  const myPlayer = room.players.find((p) => p.id === mySocketId);
  const [nickname, setNickname] = useState(myPlayer?.nickname ?? "");
  const [nicknameError, setNicknameError] = useState("");
  const [handicap, setHandicap] = useState(myPlayer?.handicapSeconds ?? 0);
  const settings = useRoomSettings(room.settings, lobbySongs.length, onUpdateSettings);

  // Playlist selection state
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [libraryPlaylists, setLibraryPlaylists] = useState<any[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [playlistSource, setPlaylistSource] = useState<"library" | "public">("library");
  const effectiveSource = musicKit.authorized ? playlistSource : "public";
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [searchError, setSearchError] = useState("");

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

  const handleSelectPlaylist = async (playlist: any) => {
    setLoadingSongs(true);
    const fetchedSongs = effectiveSource === "library"
      ? await musicKit.getLibraryPlaylistSongs(playlist.id)
      : await musicKit.getPlaylistSongs(playlist.id);
    setLoadingSongs(false);
    onUpdateSettings({ playlistId: playlist.id, playlistName: playlist.name });
    onSendLobbySongs(fetchedSongs);
    settings.setRounds(fetchedSongs.length);
    setPlaylistSearch("");
    setPlaylists([]);
  };

  const handleSwitchToLibrary = async () => {
    setPlaylistSource("library");
    setPlaylistSearch("");
    setSearchError("");
    if (libraryPlaylists.length === 0) {
      setLoadingLibrary(true);
      const fetched = await musicKit.getLibraryPlaylists();
      setLibraryPlaylists(fetched);
      setPlaylists(fetched);
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

  const handleUrlLoad = async (url: string) => {
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return;
    setSearchError("");
    setLoadingSongs(true);
    try {
      const fetchedSongs = await musicKit.getPlaylistSongs(playlistId);
      if (fetchedSongs.length === 0) {
        setSearchError("No songs found in this playlist");
        setLoadingSongs(false);
        return;
      }
      onUpdateSettings({ playlistId, playlistName: `Playlist (${playlistId})` });
      onSendLobbySongs(fetchedSongs);
      settings.setRounds(fetchedSongs.length);
      setPlaylistSearch("");
      setPlaylists([]);
    } catch (e: any) {
      setSearchError(e?.message || "Failed to load playlist");
    } finally {
      setLoadingSongs(false);
    }
  };

  const debouncedSearchPublic = useDebouncedCallback((term: string) => {
    musicKit.searchPlaylists(term).then(setPlaylists);
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
            {loadingSongs && <p className="text-sm text-gray-500">Loading songs...</p>}

            {!loadingSongs && playlists.length > 0 && (
              <ul className="space-y-1 max-h-60 overflow-y-auto border rounded p-2 bg-white">
                {playlists.map((pl) => (
                  <li key={pl.id}>
                    <button
                      onClick={() => handleSelectPlaylist(pl)}
                      className="w-full text-left p-2 hover:bg-gray-100 rounded"
                    >
                      {pl.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {lobbySongs.length > 0 && (
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
            {room.settings.totalRounds > 0 && (
              <p className="text-sm">Rounds: <span className="font-mono">{room.settings.totalRounds}</span></p>
            )}
            <p className="text-sm">Wrong answer lockout: <span className="font-mono">{room.settings.penaltyLockoutSeconds > 0 ? `${room.settings.penaltyLockoutSeconds}s` : "off"}</span></p>
            <p className="text-sm">Max attempts: <span className="font-mono">{room.settings.penaltyMaxAttempts > 0 ? room.settings.penaltyMaxAttempts : "unlimited"}</span></p>
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
