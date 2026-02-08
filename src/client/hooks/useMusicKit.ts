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
  const musicRef = useRef<MusicKit.MusicKitInstance | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const searchSongs = useCallback(async (term: string): Promise<Song[]> => {
    const mk = musicRef.current;
    if (!mk) return [];
    try {
      const response = await mk.api.music("/v1/catalog/{{storefrontId}}/search", {
        term,
        types: "songs",
        limit: 10,
      });
      const songs = (response.data as any)?.results?.songs?.data ?? [];
      return songs.map((t: any) => ({
        id: t.id,
        title: t.attributes.name,
        artist: t.attributes.artistName,
        artworkUrl: t.attributes.artwork?.url?.replace("{w}x{h}", "100x100") ?? "",
        previewUrl: t.attributes.previews?.[0]?.url ?? "",
      }));
    } catch (e) {
      console.error("Search songs error:", e);
      return [];
    }
  }, []);

  const playSong = useCallback(async (song: Song, durationSec: number) => {
    const mk = musicRef.current;
    if (!mk) return;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

    try {
      if (mk.playbackState === MusicKit.PlaybackStates.playing) {
        await mk.stop();
      }
      await mk.setQueue({ songs: [song.id], startPlaying: true });

      stopTimerRef.current = setTimeout(async () => {
        try {
          await mk.stop();
        } catch {}
      }, durationSec * 1000);
    } catch (e) {
      console.error("Play error:", e);
    }
  }, []);

  const playFullSong = useCallback(async (song: Song) => {
    const mk = musicRef.current;
    if (!mk) return;

    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

    try {
      if (mk.playbackState === MusicKit.PlaybackStates.playing) {
        await mk.stop();
      }
      mk.repeatMode = MusicKit.PlayerRepeatMode.one;
      await mk.setQueue({ songs: [song.id], startPlaying: true });
    } catch (e) {
      console.error("PlayFullSong error:", e);
    }
  }, []);

  const stop = useCallback(async () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    try {
      const mk = musicRef.current;
      if (mk) {
        mk.repeatMode = MusicKit.PlayerRepeatMode.none;
        await mk.stop();
      }
    } catch {}
  }, []);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
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
    searchSongs,
    playSong,
    playFullSong,
    stop,
  };
}
