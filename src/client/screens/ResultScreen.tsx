import type { Player } from "../../shared/types.ts";

interface Props {
  players: Player[];
  mySocketId: string | undefined;
  isHost: boolean;
  onBackToLobby: () => void;
  onLeave: () => void;
}

export function ResultScreen({ players, mySocketId, isHost, onBackToLobby, onLeave }: Props) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const getRank = (i: number): number => i === 0 || sorted[i]!.score !== sorted[i - 1]!.score ? i + 1 : getRank(i - 1);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 gap-6">
      <h1 className="text-3xl font-bold">Game Over!</h1>
      <div className="w-full max-w-md space-y-2">
        {sorted.map((p, i) => (
          <div
            key={p.id}
            className={`flex justify-between items-center p-3 rounded ${
              getRank(i) === 1 ? "bg-yellow-100 border-2 border-yellow-400" : "bg-gray-100"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-lg w-6">{getRank(i)}.</span>
              <span className="font-bold">
                {p.nickname}
                {p.id === mySocketId ? " (you)" : ""}
              </span>
            </span>
            <span className="font-mono text-xl">{p.score}</span>
          </div>
        ))}
      </div>
      {isHost && (
        <button
          onClick={onBackToLobby}
          className="bg-blue-600 text-white px-6 py-3 rounded text-lg"
        >
          Back to Lobby
        </button>
      )}
      {!isHost && (
        <p className="text-gray-500 text-sm">Waiting for host to return to lobby...</p>
      )}
      <button onClick={onLeave} className="text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Home
      </button>
    </div>
  );
}
