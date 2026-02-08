import { useState, useEffect } from "react";

interface Props {
  navigate: (path: string) => void;
  createRoom: () => Promise<{ ok: true; code: string } | { ok: false; error: string }>;
  checkRoom: (code: string) => Promise<{ exists: boolean }>;
  musicKit: {
    credentialsConfigured: boolean;
    checkCredentials: () => Promise<boolean>;
  };
}

export function HomeScreen({ navigate, createRoom, checkRoom, musicKit }: Props) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    musicKit.checkCredentials();
  }, []);

  const handleCreate = async () => {
    setLoading(true);
    setError("");
    const res = await createRoom();
    setLoading(false);
    if (res.ok) {
      navigate(`/room/${res.code}`);
    } else {
      setError(res.error);
    }
  };

  const handleCodeChange = (value: string) => {
    const v = value.replace(/\D/g, "").slice(0, 4);
    setCode(v);
    setError("");
    if (v.length === 4) {
      setChecking(true);
      checkRoom(v).then((res) => {
        setChecking(false);
        if (res.exists) {
          navigate(`/room/${v}`);
        } else {
          setError("Room not found");
        }
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
      <h1 className="text-4xl font-bold">Name That Tune</h1>
      <p className="text-gray-500">Multiplayer intro quiz game</p>
      {error && <p className="text-red-500">{error}</p>}
      <input
        type="text"
        inputMode="numeric"
        placeholder="Room code"
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        maxLength={4}
        className="border-2 border-gray-300 p-2 rounded w-48 text-center text-2xl tracking-widest"
      />
      {checking && <p className="text-gray-400 text-sm">Checking...</p>}
      <button
        onClick={handleCreate}
        disabled={loading}
        className="bg-blue-600 text-white px-8 py-3 rounded text-lg disabled:opacity-50"
      >
        {loading ? "Creating..." : "Create Room"}
      </button>
      <button
        onClick={() => navigate("/setup")}
        className="text-sm text-gray-400 underline"
      >
        {musicKit.credentialsConfigured ? "Apple Music configured" : "Configure Apple Music"}
      </button>
    </div>
  );
}
