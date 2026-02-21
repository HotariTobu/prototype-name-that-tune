import { useState, useCallback, useRef, useEffect } from "react";
import type { Song } from "../../shared/types.ts";

async function fetchToken(): Promise<{ token: string; expiresAt: Date }> {
  const res = await fetch("/api/token", { cache: "no-store" });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { token: data.token, expiresAt: new Date(data.expiresAt) };
}

function whenMusicKitLoaded(): Promise<typeof MusicKit> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  return new Promise((resolve) => {
    document.addEventListener("musickitloaded", () => resolve(window.MusicKit), { once: true });
  });
}

const mkReady: Promise<MusicKit.MusicKitInstance> = whenMusicKitLoaded().then(async (MusicKit) => {
  const { token } = await fetchToken();
  return MusicKit.configure({
    developerToken: token,
    app: { name: "Name That Tune", build: "0.1.0" },
  });
});

export function useMusicKit() {
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loading, setLoading] = useState(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const loadPromiseRef = useRef<Promise<void>>(Promise.resolve());

  const authorize = useCallback(async () => {
    const mk = await mkReady;
    await mk.authorize();
  }, []);

  const unauthorize = useCallback(async () => {
    const mk = await mkReady;
    await mk.unauthorize();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    mkReady.then(async (mk) => {
      try {
        await mk.api.music("/v1/me/storefront");
        setAuthorized(true);
      } catch {
        setAuthorized(false);
      }
      const handler = () => setAuthorized(mk.isAuthorized);
      mk.addEventListener("authorizationStatusDidChange", handler);
      cleanup = () => mk.removeEventListener("authorizationStatusDidChange", handler);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "MusicKit configuration failed");
    });
    return () => cleanup?.();
  }, []);

  const searchPlaylists = useCallback(async (term: string) => {
    const mk = await mkReady;
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
  }, []);

  const getPlaylistSongs = useCallback(async (playlistId: string): Promise<Song[]> => {
    const mk = await mkReady;
    const allTracks: any[] = [];
    let url: string | null = `/v1/catalog/{{storefrontId}}/playlists/${playlistId}/tracks`;
    let params: Record<string, any> | undefined = { limit: 100 };
    while (url) {
      const response = await mk.api.music(url, params);
      const data = response.data as any;
      allTracks.push(...(data?.data ?? []));
      url = data?.next ?? null;
      params = undefined;
    }
    return allTracks.map((t: any) => ({
      id: t.id,
      title: t.attributes.name,
      artist: t.attributes.artistName,
      artworkUrl: t.attributes.artwork?.url?.replace("{w}x{h}", "200x200") ?? "",
      previewUrl: t.attributes.previews?.[0]?.url ?? "",
    }));
  }, []);

  const getLibraryPlaylists = useCallback(async () => {
    const mk = await mkReady;
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
  }, []);

  const getLibraryPlaylistSongs = useCallback(async (playlistId: string): Promise<Song[]> => {
    const mk = await mkReady;
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
  }, []);

  const prepareQueue = useCallback(async (songs: Song[]) => {
    if (songs.length === 0) return;
    const mk = await mkReady;

    setPreparing(true);
    const promise = (async () => {
      try {
        mk.shuffleMode = MusicKit.PlayerShuffleMode.off;
        await mk.setQueue({ songs: songs.map((s) => s.id), startPlaying: false });
        mk.repeatMode = MusicKit.PlayerRepeatMode.one;
        console.log("MusicKit queue prepared with", songs.length, "songs");
      } finally {
        setPreparing(false);
      }
    })();
    preparePromiseRef.current = promise;
    await promise;
  }, []);

  const loadSong = useCallback((songIndex: number) => {
    setLoading(true);
    const promise = (async () => {
      try {
        await preparePromiseRef.current;
        const mk = await mkReady;
        if (mk.nowPlayingItemIndex === songIndex) return;
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

  const playSong = useCallback(async (durationSec: number) => {
    const mk = await mkReady;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (mk.isPlaying) mk.pause();
    mk.play();
    setPlaying(true);

    stopTimerRef.current = setTimeout(() => {
      if (mk.isPlaying) mk.pause();
      mk.seekToTime(0);
      setPlaying(false);
    }, durationSec * 1000);
  }, []);

  const playFullSong = useCallback(async () => {
    const mk = await mkReady;

    await loadPromiseRef.current;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (!mk.isPlaying) mk.play();
    setPlaying(true);
  }, []);

  const stop = useCallback(async () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const mk = await mkReady;
    if (mk.isPlaying) mk.pause();
    mk.seekToTime(0);
    setPlaying(false);
  }, []);

  const cleanup = useCallback(async () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const mk = await mkReady;
    mk.stop();
    setPlaying(false);
  }, []);

  return {
    authorized,
    error,
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
