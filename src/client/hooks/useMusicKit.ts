import { useState, useCallback, useRef, useEffect } from "react";
import type { Song } from "../../shared/types.ts";

async function fetchToken(): Promise<{ token: string; expiresAt: Date }> {
  const res = await fetch("/api/token", { cache: "no-store" });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { token: data.token, expiresAt: new Date(data.expiresAt) };
}

export function useMusicKit() {
  const [configured, setConfigured] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(false);
  const musicRef = useRef<MusicKit.MusicKitInstance | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const loadPromiseRef = useRef<Promise<void>>(Promise.resolve());

  const configure = useCallback(async () => {
    setError(null);
    try {
      const { token } = await fetchToken();
      const mk = await window.MusicKit.configure({
        developerToken: token,
        app: { name: "Name That Tune", build: "0.1.0" },
      });
      musicRef.current = mk;
      setConfigured(true);
      setAuthorized(mk.isAuthorized);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MusicKit configuration failed");
    }
  }, []);

  const authorize = useCallback(async () => {
    if (!musicRef.current) return;
    try {
      await musicRef.current.authorize();
      setAuthorized(true);
    } catch (e) {
      console.error("MusicKit authorize error:", e);
    }
  }, []);

  const unauthorize = useCallback(async () => {
    if (!musicRef.current) return;
    try {
      await musicRef.current.unauthorize();
      setAuthorized(false);
    } catch (e) {
      console.error("MusicKit unauthorize error:", e);
    }
  }, []);

  useEffect(() => {
    const mk = musicRef.current;
    if (!mk) return;
    const handler = () => setAuthorized(mk.isAuthorized);
    mk.addEventListener("authorizationStatusDidChange", handler);
    return () => mk.removeEventListener("authorizationStatusDidChange", handler);
  }, [configured]);

  const searchPlaylists = useCallback(async (term: string) => {
    const mk = musicRef.current;
    if (!mk) return [];
    try {
      const response = await mk.api.music("/v1/catalog/{{storefrontId}}/search", {
        term,
        types: "playlists",
        limit: 10,
      });
      const playlists = (response.data as any)?.results?.playlists?.data ?? [];
      return playlists.map((p: any) => ({
        id: p.id,
        name: p.attributes.name,
        artwork: p.attributes.artwork?.url?.replace("{w}x{h}", "200x200") ?? "",
      }));
    } catch (e) {
      console.error("Search playlists error:", e);
      return [];
    }
  }, []);

  const getPlaylistSongs = useCallback(async (playlistId: string): Promise<Song[]> => {
    const mk = musicRef.current;
    if (!mk) return [];
    try {
      const allTracks: any[] = [];
      let url: string | null = `/v1/catalog/{{storefrontId}}/playlists/${playlistId}/tracks`;
      let params: Record<string, any> | undefined = { limit: 100 };
      while (url) {
        const response = await mk.api.music(url, params);
        const data = response.data as any;
        allTracks.push(...(data?.data ?? []));
        url = data?.next ?? null;
        params = undefined; // next URL includes all params
      }
      return allTracks.map((t: any) => ({
        id: t.id,
        title: t.attributes.name,
        artist: t.attributes.artistName,
        artworkUrl: t.attributes.artwork?.url?.replace("{w}x{h}", "200x200") ?? "",
        previewUrl: t.attributes.previews?.[0]?.url ?? "",
      }));
    } catch (e) {
      console.error("Get playlist songs error:", e);
      return [];
    }
  }, []);

  const getLibraryPlaylists = useCallback(async () => {
    const mk = musicRef.current;
    if (!mk) return [];
    try {
      const allPlaylists: any[] = [];
      let url: string | null = "/v1/me/library/playlists";
      let params: Record<string, any> | undefined = { limit: 100 };
      while (url) {
        const response = await mk.api.music(url, params);
        const data = response.data as any;
        allPlaylists.push(...(data?.data ?? []));
        url = data?.next ?? null;
        params = undefined;
      }
      return allPlaylists.map((p: any) => ({
        id: p.id,
        name: p.attributes.name,
        artwork: p.attributes.artwork?.url?.replace("{w}x{h}", "200x200") ?? "",
      }));
    } catch (e) {
      console.error("Get library playlists error:", e);
      return [];
    }
  }, []);

  const getLibraryPlaylistSongs = useCallback(async (playlistId: string): Promise<Song[]> => {
    const mk = musicRef.current;
    if (!mk) return [];
    try {
      const allTracks: any[] = [];
      let url: string | null = `/v1/me/library/playlists/${playlistId}/tracks`;
      let params: Record<string, any> | undefined = { limit: 100, include: "catalog" };
      while (url) {
        const response = await mk.api.music(url, params);
        const data = response.data as any;
        allTracks.push(...(data?.data ?? []));
        url = data?.next ?? null;
        params = undefined;
      }
      return allTracks.map((t: any) => {
        const catalogEntry = t.relationships?.catalog?.data?.[0];
        return {
          id: catalogEntry?.id ?? t.id,
          title: t.attributes.name,
          artist: t.attributes.artistName,
          artworkUrl: (catalogEntry?.attributes?.artwork?.url ?? t.attributes.artwork?.url ?? "").replace("{w}x{h}", "200x200"),
          previewUrl: catalogEntry?.attributes?.previews?.[0]?.url ?? "",
        };
      });
    } catch (e) {
      console.error("Get library playlist songs error:", e);
      return [];
    }
  }, []);

  // Prepare the queue with all songs at game start (host only)
  const prepareQueue = useCallback(async (songs: Song[]) => {
    const mk = musicRef.current;
    if (!mk || songs.length === 0) return;

    setPreparing(true);
    const promise = (async () => {
      try {
        mk.shuffleMode = MusicKit.PlayerShuffleMode.off;
        await mk.setQueue({ songs: songs.map((s) => s.id), startPlaying: false });
        mk.repeatMode = MusicKit.PlayerRepeatMode.one; // setQueue resets mode, so set after
        console.log("MusicKit queue prepared with", songs.length, "songs");
      } finally {
        setPreparing(false);
      }
    })();
    preparePromiseRef.current = promise;
    await promise;
  }, []);

  // Load a specific song by index (called on round change, before play)
  const loadSong = useCallback((songIndex: number) => {
    const mk = musicRef.current;
    if (!mk) return;

    setLoading(true);
    const promise = (async () => {
      try {
        await preparePromiseRef.current;
        if (mk.nowPlayingItemIndex === songIndex) return;
        // changeToMediaAtIndex starts playback, so pause + seek immediately
        await mk.changeToMediaAtIndex(songIndex);
        mk.pause();
        await mk.seekToTime(0);
        console.log("MusicKit loaded song at index", songIndex);
      } finally {
        setLoading(false);
      }
    })();
    loadPromiseRef.current = promise;
  }, []);

  // Play current song for a given duration (Play button)
  const playSong = useCallback((durationSec: number) => {
    const mk = musicRef.current;
    if (!mk) return;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (mk.isPlaying) mk.pause();
    mk.play();
    setPlaying(true);

    stopTimerRef.current = setTimeout(() => {
      // Ensure clean stopped state regardless of MusicKit's actual state
      if (mk.isPlaying) mk.pause();
      mk.seekToTime(0);
      setPlaying(false);
    }, durationSec * 1000);
  }, []);

  // Play full song on reveal (repeatMode=one loops it)
  const playFullSong = useCallback(async () => {
    const mk = musicRef.current;
    if (!mk) return;

    await loadPromiseRef.current;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (!mk.isPlaying) mk.play();
    setPlaying(true);
  }, []);

  const stop = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const mk = musicRef.current;
    // Always restore to consistent stopped state
    if (mk?.isPlaying) mk.pause();
    mk?.seekToTime(0);
    setPlaying(false);
  }, []);

  const cleanup = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    try { musicRef.current?.stop(); } catch {}
    setPlaying(false);
  }, []);

  return {
    configured,
    authorized,
    error,
    configure,
    authorize,
    unauthorize,
    searchPlaylists,
    getPlaylistSongs,
    getLibraryPlaylists,
    getLibraryPlaylistSongs,
    playSong,
    playFullSong,
    stop,
    playing,
    preparing,
    loading,
    prepareQueue,
    loadSong,
    cleanup,
  };
}
