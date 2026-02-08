import { useState, useEffect } from "react";

interface Props {
  navigate: (path: string) => void;
  musicKit: {
    credentialsConfigured: boolean;
    error: string | null;
    checkCredentials: () => Promise<boolean>;
    saveCredentials: (teamId: string, keyId: string, privateKey: string) => Promise<boolean>;
  };
}

export function SetupScreen({ navigate, musicKit }: Props) {
  const [teamId, setTeamId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    musicKit.checkCredentials();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const ok = await musicKit.saveCredentials(teamId.trim(), keyId.trim(), privateKey.trim());
    setSaving(false);
    if (ok) {
      navigate("/");
    } else if (musicKit.error) {
      setError(musicKit.error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
      <h1 className="text-3xl font-bold">Apple Music Setup</h1>
      <p className="text-gray-500 text-sm">Enter your Apple Music developer credentials</p>
      <div className="w-full max-w-sm space-y-2">
        <input
          type="text"
          placeholder="Team ID"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="border p-2 rounded w-full text-sm"
        />
        <input
          type="text"
          placeholder="Key ID"
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          className="border p-2 rounded w-full text-sm"
        />
        <textarea
          placeholder="Private Key (.p8 contents)"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          rows={4}
          className="border p-2 rounded w-full text-sm font-mono"
        />
      </div>
      {error && <p className="text-red-500">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving || !teamId || !keyId || !privateKey}
        className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <button onClick={() => navigate("/")} className="text-gray-500 underline">
        Back
      </button>
    </div>
  );
}
