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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MUSIC_API_INTERVAL_MS = 100;
const QUEUE_CHUNK_SIZE = 50;
let nextMusicApiCall = Promise.resolve();

async function throttledMusicApi(mk: MusicKit.MusicKitInstance, url: string, params?: Record<string, any>) {
  const call = nextMusicApiCall.then(async () => {
    console.log("MusicKit API throttled call", url);
    const response = await mk.api.music(url, params);
    await sleep(MUSIC_API_INTERVAL_MS);
    return response;
  });
  nextMusicApiCall = call.then(() => undefined, () => undefined);
  return call;
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
  const songsRef = useRef<Song[]>([]);
  const queuedChunkStartRef = useRef<number | null>(null);

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
      const response = await throttledMusicApi(mk, url, params);
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
      const response = await throttledMusicApi(mk, url, params);
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
      const response = await throttledMusicApi(mk, url, params);
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
    songsRef.current = songs;
    queuedChunkStartRef.current = null;

    setPreparing(true);
    const promise = (async () => {
      try {
        mk.shuffleMode = MusicKit.PlayerShuffleMode.off;
        const queueSongs = songs.slice(0, QUEUE_CHUNK_SIZE);
        console.log("MusicKit queue preparing chunk", 0, "with", queueSongs.length, "of", songs.length, "songs");
        await mk.setQueue({ songs: queueSongs.map((s) => s.id), startPlaying: false });
        queuedChunkStartRef.current = 0;
        mk.repeatMode = MusicKit.PlayerRepeatMode.one;
        console.log("MusicKit queue prepared chunk", 0, "with", queueSongs.length, "songs");
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
        const songs = songsRef.current;
        const chunkStart = Math.floor(songIndex / QUEUE_CHUNK_SIZE) * QUEUE_CHUNK_SIZE;
        const queueIndex = songIndex - chunkStart;
        if (queuedChunkStartRef.current !== chunkStart) {
          const queueSongs = songs.slice(chunkStart, chunkStart + QUEUE_CHUNK_SIZE);
          console.log("MusicKit queue preparing chunk", chunkStart, "with", queueSongs.length, "of", songs.length, "songs");
          await mk.setQueue({ songs: queueSongs.map((s) => s.id), startPlaying: false });
          queuedChunkStartRef.current = chunkStart;
          mk.repeatMode = MusicKit.PlayerRepeatMode.one;
          console.log("MusicKit queue prepared chunk", chunkStart, "with", queueSongs.length, "songs");
        }
        if (mk.nowPlayingItemIndex === queueIndex) return;
        await mk.changeToMediaAtIndex(queueIndex);
        mk.pause();
        await mk.seekToTime(0);
        console.log("MusicKit loaded song at index", songIndex, "queue index", queueIndex);
      } finally {
        setLoading(false);
      }
    })();
    loadPromiseRef.current = promise;
  }, []);

  const playSong = useCallback(async (durationSec: number) => {
    const mk = await mkReady;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    await loadPromiseRef.current;
    if (mk.isPlaying) mk.pause();
    await mk.play();
    setPlaying(true);

    stopTimerRef.current = setTimeout(() => {
      if (mk.isPlaying) mk.pause();
      void mk.seekToTime(0);
      setPlaying(false);
    }, durationSec * 1000);
  }, []);

  const playFullSong = useCallback(async () => {
    const mk = await mkReady;

    await loadPromiseRef.current;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (!mk.isPlaying) await mk.play();
    setPlaying(true);
  }, []);

  const stop = useCallback(async () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const mk = await mkReady;
    if (mk.isPlaying) mk.pause();
    await mk.seekToTime(0);
    setPlaying(false);
  }, []);

  const cleanup = useCallback(async () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const mk = await mkReady;
    await mk.stop();
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
