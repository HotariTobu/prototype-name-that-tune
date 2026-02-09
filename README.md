# Name That Tune (Prototype)

> **This is a prototype.** Expect rough edges, incomplete features, and breaking changes.

A multiplayer intro quiz game. Players listen to the intro of a song and compete to guess the title first.

## How It Works

1. The host creates a room (identified by a 4-digit code) and selects an Apple Music playlist
2. Other players join by entering the room code and a nickname
3. Each player can set a handicap delay (in seconds) in the lobby — when they submit an answer, the server waits that many seconds before accepting it, leveling the playing field between experienced and casual players
4. The host optionally sets the number of rounds, then starts the game
5. Each round:
   - The host presses play — the song plays for the current duration (default steps: 1s, 2s, 4s, 8s, 16s, configurable at room creation)
   - Players type the song title — matching candidates are suggested with fuzzy matching
   - The first player to select the correct song scores a point
   - If no one gets it, the host can replay at the same duration or extend to the next step
   - Full playback requires the host to have an Apple Music subscription, otherwise a 30-second preview is used
6. The game ends after the set number of rounds, or when the host ends it manually

## Tech Stack

- [Bun](https://bun.sh/) server with [@socket.io/bun-engine](https://socket.io/docs/v4/bun-engine/) for real-time communication
- [Tailwind CSS](https://tailwindcss.com/) 4
- [Apple MusicKit JS](https://developer.apple.com/musickit/) for song playback and search
- In-memory state (no database)
