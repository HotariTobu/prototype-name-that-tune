import { useState, useEffect, useRef } from "react";
import type { RoomState, Song } from "../../shared/types.ts";

interface Props {
  room: RoomState;
  isHost: boolean;
  mySocketId: string | undefined;
  onSetNickname: (nickname: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSetHandicap: (seconds: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  onUpdateSettings: (settings: any) => void;
  onSendLobbySongs: (songs: Song[]) => void;
  onStart: (songs: Song[]) => void;
  onLeave: () => void;
  musicKit: {
    configured: boolean;
    authorized: boolean;
    error: string | null;
    configure: () => Promise<void>;
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
  const [songs, setSongs] = useState<Song[]>([]);
  const [unlimited, setUnlimited] = useState(room.settings.totalRounds === 0);
  const [rounds, setRounds] = useState(room.settings.totalRounds || 10);
  const [durationStepsInput, setDurationStepsInput] = useState(room.settings.durationSteps.join(", "));
  const [handicap, setHandicap] = useState(myPlayer?.handicapSeconds ?? 0);

  // Playlist dialog state
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [playlistSource, setPlaylistSource] = useState<"search" | "library" | "url">("search");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [libraryFilter, setLibraryFilter] = useState("");

  const handleSetNickname = async () => {
    if (!nickname.trim()) {
      setNicknameError("Nickname is required");
      return;
    }
    setNicknameError("");
    const res = await onSetNickname(nickname.trim());
    if (!res.ok) {
      setNicknameError(res.error);
    }
  };

  useEffect(() => {
    if (isHost && !musicKit.configured) {
      musicKit.configure();
    }
  }, [isHost]);

  const openPlaylistDialog = () => {
    dialogRef.current?.showModal();
  };

  const closePlaylistDialog = () => {
    dialogRef.current?.close();
  };

  const handleSearchPlaylists = async () => {
    if (!playlistSearch.trim()) return;
    const results = await musicKit.searchPlaylists(playlistSearch.trim());
    setPlaylists(results);
  };

  const handleSelectPlaylist = async (playlist: any) => {
    setLoadingSongs(true);
    const fetchedSongs = playlistSource === "library"
      ? await musicKit.getLibraryPlaylistSongs(playlist.id)
      : await musicKit.getPlaylistSongs(playlist.id);
    setSongs(fetchedSongs);
    setLoadingSongs(false);
    onUpdateSettings({ playlistId: playlist.id, playlistName: playlist.name });
    onSendLobbySongs(fetchedSongs);
    closePlaylistDialog();
  };

  const handleSwitchToLibrary = async () => {
    setPlaylistSource("library");
    setPlaylists([]);
    setLibraryFilter("");
    if (!musicKit.authorized) return;
    setLoadingLibrary(true);
    const libraryPlaylists = await musicKit.getLibraryPlaylists();
    setPlaylists(libraryPlaylists);
    setLoadingLibrary(false);
  };

  const handleSwitchToSearch = () => {
    setPlaylistSource("search");
    setPlaylists([]);
  };

  const handleSwitchToUrl = () => {
    setPlaylistSource("url");
    setPlaylists([]);
    setUrlError("");
  };

  function extractPlaylistId(url: string): string | null {
    const match = url.match(/(pl\.[a-zA-Z0-9_-]+)/);
    return match ? match[1]! : null;
  }

  const handleUrlSubmit = async () => {
    setUrlError("");
    const id = extractPlaylistId(playlistUrl);
    if (!id) {
      setUrlError("Invalid playlist URL. Expected a URL containing pl.xxxxx");
      return;
    }
    setLoadingSongs(true);
    try {
      const fetchedSongs = await musicKit.getPlaylistSongs(id);
      if (fetchedSongs.length === 0) {
        setUrlError("No songs found in this playlist");
        setLoadingSongs(false);
        return;
      }
      setSongs(fetchedSongs);
      onUpdateSettings({ playlistId: id, playlistName: `Playlist (${id})` });
      onSendLobbySongs(fetchedSongs);
      closePlaylistDialog();
    } catch (e: any) {
      setUrlError(e?.message || "Failed to load playlist");
    } finally {
      setLoadingSongs(false);
    }
  };

  const handleStart = () => {
    if (songs.length === 0) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    const parsedSteps = durationStepsInput
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);
    const steps = parsedSteps.length > 0 ? parsedSteps : [1, 2, 4, 8, 16];
    onUpdateSettings({
      totalRounds: unlimited ? 0 : Math.min(rounds, shuffled.length),
      durationSteps: steps,
    });
    onStart(shuffled);
  };

  // Use lobbySongs for display (shared with all players)
  const displaySongs = lobbySongs.length > 0 ? lobbySongs : songs;

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

      <div className="bg-white border rounded p-4 w-full max-w-md">
        <h2 className="font-bold mb-2">Your Nickname</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSetNickname()}
            maxLength={20}
            className="border p-2 rounded flex-1"
          />
          <button
            onClick={handleSetNickname}
            disabled={!nickname.trim() || nickname.trim() === myPlayer?.nickname}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Set
          </button>
        </div>
        {nicknameError && <p className="text-red-500 text-sm mt-1">{nicknameError}</p>}
      </div>

      <div className="bg-white border rounded p-4 w-full max-w-md">
        <h2 className="font-bold mb-2">Handicap Delay</h2>
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
            onChange={(e) => setHandicap(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono w-10 text-center">{handicap}s</span>
          <button
            onClick={() => onSetHandicap(handicap)}
            disabled={handicap === (myPlayer?.handicapSeconds ?? 0)}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            Set
          </button>
        </div>
      </div>

      <div className="bg-gray-100 rounded p-4 w-full max-w-md">
        <h2 className="font-bold mb-2">Players ({room.players.length})</h2>
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

      {/* Song list - visible to all players */}
      {displaySongs.length > 0 && (
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold">Songs ({displaySongs.length})</h2>
            {isHost && musicKit.configured && (
              <button onClick={openPlaylistDialog} className="text-sm text-blue-600 underline">
                Change Playlist
              </button>
            )}
          </div>
          <ul className="space-y-1 max-h-60 overflow-y-auto border rounded p-2 bg-white">
            {displaySongs.map((song, i) => (
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

      {isHost && (
        <div className="w-full max-w-md space-y-4">
          {musicKit.error && (
            <p className="text-red-500 text-sm">{musicKit.error}</p>
          )}

          {!musicKit.configured ? (
            <p className="text-gray-500 text-sm">Configuring MusicKit...</p>
          ) : (
            <div className="space-y-2">
              {!musicKit.authorized ? (
                <button onClick={musicKit.authorize} className="bg-pink-600 text-white px-4 py-2 rounded w-full">
                  Authorize Apple Music
                </button>
              ) : (
                <button onClick={musicKit.unauthorize} className="text-sm text-gray-500 underline self-end">
                  Sign out of Apple Music
                </button>
              )}
              {displaySongs.length === 0 && (
                <button onClick={openPlaylistDialog} className="bg-blue-600 text-white px-4 py-2 rounded w-full">
                  Select Playlist
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="block font-bold">
              Duration steps (seconds, comma-separated)
              <input
                type="text"
                value={durationStepsInput}
                onChange={(e) => setDurationStepsInput(e.target.value)}
                placeholder="1, 2, 4, 8, 16"
                className="border p-2 rounded w-full font-normal mt-1"
              />
            </label>
            <label className="flex items-center gap-2 font-bold">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => setUnlimited(e.target.checked)}
              />
              Unlimited rounds (host ends manually)
            </label>
            {!unlimited && (
              <label className="block font-bold">
                Rounds: {rounds}
                <input
                  type="range"
                  min={1}
                  max={Math.max(songs.length, 20)}
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            )}
          </div>

          <button
            onClick={handleStart}
            disabled={songs.length === 0}
            className="bg-green-600 text-white px-6 py-3 rounded w-full text-lg font-bold disabled:opacity-50"
          >
            Start Game
          </button>
        </div>
      )}

      {!isHost && displaySongs.length === 0 && (
        <p className="text-gray-500">Waiting for the host to select a playlist...</p>
      )}
      {!isHost && displaySongs.length > 0 && (
        <p className="text-gray-500">Waiting for the host to start the game...</p>
      )}

      {/* Playlist selection dialog (host only) */}
      <dialog
        ref={dialogRef}
        className="rounded-lg p-0 w-full max-w-md backdrop:bg-black/50"
        onClick={(e) => { if (e.target === dialogRef.current) closePlaylistDialog(); }}
      >
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">Select Playlist</h2>
            <button onClick={closePlaylistDialog} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>

          <div className="flex border-b">
            <button
              onClick={handleSwitchToSearch}
              className={`px-4 py-2 text-sm font-medium ${playlistSource === "search" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
            >
              Search
            </button>
            <button
              onClick={handleSwitchToLibrary}
              className={`px-4 py-2 text-sm font-medium ${playlistSource === "library" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
            >
              My Library
            </button>
            <button
              onClick={handleSwitchToUrl}
              className={`px-4 py-2 text-sm font-medium ${playlistSource === "url" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
            >
              URL
            </button>
          </div>

          {playlistSource === "search" && (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search playlists..."
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchPlaylists()}
                className="border p-2 rounded flex-1"
              />
              <button onClick={handleSearchPlaylists} className="bg-gray-200 px-4 py-2 rounded">
                Search
              </button>
            </div>
          )}

          {playlistSource === "library" && !musicKit.authorized && (
            <p className="text-sm text-gray-500 py-4 text-center">
              Apple Musicにログインするとライブラリのプレイリストを選択できます
            </p>
          )}

          {playlistSource === "library" && musicKit.authorized && !loadingLibrary && playlists.length > 0 && (
            <input
              type="text"
              placeholder="Filter playlists..."
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
              className="border p-2 rounded w-full"
            />
          )}

          {playlistSource === "url" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://music.apple.com/.../pl.xxxxx"
                  value={playlistUrl}
                  onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleUrlSubmit()}
                  className="border p-2 rounded flex-1 text-sm"
                />
                <button onClick={handleUrlSubmit} disabled={!playlistUrl.trim() || loadingSongs} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 text-sm">
                  Load
                </button>
              </div>
              {urlError && <p className="text-red-500 text-sm">{urlError}</p>}
            </div>
          )}

          {loadingLibrary && <p className="text-sm text-gray-500">Loading library playlists...</p>}
          {loadingSongs && <p className="text-sm text-gray-500">Loading songs...</p>}

          {!loadingSongs && playlists.length > 0 && (() => {
            const displayList = playlistSource === "library" && libraryFilter.trim()
              ? playlists.filter((pl) => (pl.name ?? "").toLowerCase().includes(libraryFilter.trim().toLowerCase()))
              : playlists;
            return displayList.length > 0 ? (
              <ul className="space-y-1 max-h-60 overflow-y-auto">
                {displayList.map((pl) => (
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
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">No matching playlists</p>
            );
          })()}
        </div>
      </dialog>
    </div>
  );
}
