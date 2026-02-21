import { useMemo } from "react";
import { useRouter } from "./client/hooks/useRouter.ts";
import { useSocket } from "./client/hooks/useSocket.ts";
import { useMusicKit } from "./client/hooks/useMusicKit.ts";
import { HomeScreen } from "./client/screens/HomeScreen.tsx";
import { RoomScreen } from "./client/screens/RoomScreen.tsx";

export function App() {
  const { route, navigate } = useRouter();
  const musicKit = useMusicKit();
  const socket = useSocket({
    onGameSongs: (songs) => {
      musicKit.prepareQueue(songs);
    },
    onGameRound: (round) => {
      musicKit.stop();
      musicKit.loadSong(round.roundNumber - 1);
      if (round.revealedSong) {
        musicKit.playFullSong();
      }
    },
    onReveal: () => {
      musicKit.playFullSong();
    },
  });
  const isHost = useMemo(() => {
    if (!socket.roomState || !socket.socket?.id) return false;
    return socket.roomState.players.some((p) => p.id === socket.socket?.id && p.isHost);
  }, [socket.roomState, socket.socket?.id]);

  if (!socket.connected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Connecting...</p>
      </div>
    );
  }

  switch (route.path) {
    case "/room/:code":
      return (
        <RoomScreen
          roomCode={route.params.code}
          navigate={navigate}
          socket={socket}
          isHost={isHost}
          musicKit={musicKit}
        />
      );

    default:
      return (
        <HomeScreen
          navigate={navigate}
          createRoom={socket.createRoom}
          checkRoom={socket.checkRoom}
        />
      );
  }
}
