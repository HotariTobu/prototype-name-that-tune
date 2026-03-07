/**
 * Browser-based E2E test for お手つき (wrong answer penalty) rule using Playwright.
 *
 * Prerequisites: Server running on PORT 3456
 * Usage: bunx playwright test test-penalty-e2e.ts
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const BASE_URL = "http://localhost:3456";

async function waitForSocket(page: Page) {
  await expect(page.getByText("Connecting...")).toBeHidden({ timeout: 10000 });
}

async function createRoomAsHost(page: Page): Promise<string> {
  await page.goto(BASE_URL);
  await waitForSocket(page);
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page.getByText(/Room: \d{4}/)).toBeVisible({ timeout: 5000 });
  const roomHeading = await page.getByText(/Room: \d{4}/).textContent();
  return roomHeading!.match(/\d{4}/)![0];
}

async function joinRoom(page: Page, roomCode: string) {
  await page.goto(BASE_URL);
  await waitForSocket(page);
  await page.getByPlaceholder("Room code").fill(roomCode);
  await expect(page.getByText(/Room: \d{4}/)).toBeVisible({ timeout: 5000 });
}

async function setNickname(page: Page, name: string) {
  await page.getByPlaceholder("Enter nickname").fill(name);
  await page.getByRole("button", { name: "Set" }).first().click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 3000 });
}

/** Find the socket.io client instance via React fiber traversal and expose it on window */
async function exposeSocket(page: Page) {
  await page.evaluate(() => {
    const rootEl = document.getElementById("root");
    if (!rootEl) return;
    const internalKey = Object.keys(rootEl).find(
      (k) => k.startsWith("__reactContainer") || k.startsWith("__reactFiber")
    );
    if (!internalKey) return;

    const walk = (node: any, depth = 0): any => {
      if (!node || depth > 50) return null;
      if (node.memoizedState) {
        let hook = node.memoizedState;
        while (hook) {
          const val = hook.memoizedState;
          if (val && typeof val === "object" && "current" in val && val.current) {
            const ref = val.current;
            if (ref && typeof ref.emit === "function" && typeof ref.on === "function") {
              (window as any).__testSocket = ref;
              return ref;
            }
          }
          hook = hook.next;
        }
      }
      return walk(node.child, depth + 1) || walk(node.sibling, depth + 1);
    };

    walk((rootEl as any)[internalKey]);
  });
}

/**
 * Submit an answer via the player's socket directly.
 * This ensures we can send a specific songId that is guaranteed wrong.
 */
async function submitAnswerViaSocket(page: Page, songId: string, songTitle: string) {
  await exposeSocket(page);
  await page.evaluate(
    ({ songId, songTitle }) => {
      (window as any).__testSocket.emit("game:answer", { songId, songTitle });
    },
    { songId, songTitle }
  );
}

test.describe("お手つき (Wrong Answer Penalty)", () => {
  let hostContext: BrowserContext;
  let playerContext: BrowserContext;
  let hostPage: Page;
  let playerPage: Page;

  test.beforeAll(async ({ browser }) => {
    hostContext = await browser.newContext();
    playerContext = await browser.newContext();
    hostPage = await hostContext.newPage();
    playerPage = await playerContext.newPage();
  });

  test.afterAll(async () => {
    await hostContext?.close();
    await playerContext?.close();
  });

  test("penalty lockout and attempts work correctly through the UI", async () => {
    // 1. Host creates room
    const roomCode = await createRoomAsHost(hostPage);
    console.log(`Room created: ${roomCode}`);

    // 2. Player joins and sets nickname
    await joinRoom(playerPage, roomCode);
    await setNickname(playerPage, "TestPlayer");

    // 3. Expose socket on host page and configure game
    await exposeSocket(hostPage);
    expect(await hostPage.evaluate(() => !!(window as any).__testSocket)).toBe(true);
    console.log("Socket found");

    // 4. Inject songs and settings, then start game
    await hostPage.evaluate(() => {
      const socket = (window as any).__testSocket;
      socket.emit("lobby:songs", {
        songs: [
          { id: "song-1", title: "Correct Song", artist: "Artist", artworkUrl: "", previewUrl: "" },
          { id: "song-2", title: "Another Song", artist: "Artist", artworkUrl: "", previewUrl: "" },
          { id: "song-3", title: "Third Song", artist: "Artist", artworkUrl: "", previewUrl: "" },
        ],
      });
      socket.emit("room:settings", {
        penaltyLockoutSeconds: 2,
        penaltyMaxAttempts: 2,
        totalRounds: 3,
      });
    });

    await expect(hostPage.getByText("Songs (3)")).toBeVisible({ timeout: 3000 });

    // Start game
    await hostPage.evaluate(() => (window as any).__testSocket.emit("game:start"));
    await expect(playerPage.getByText(/Round 1/)).toBeVisible({ timeout: 5000 });
    console.log("Game started - Round 1");

    // --- Test 1: Wrong answer (via socket with guaranteed-wrong ID) triggers lockout ---
    await submitAnswerViaSocket(playerPage, "definitely-wrong-id", "Wrong Answer");

    await expect(playerPage.getByText(/Locked out for/)).toBeVisible({ timeout: 3000 });
    console.log("PASS: Wrong answer triggers lockout");

    await expect(playerPage.getByText(/1 attempt.* left/)).toBeVisible({ timeout: 3000 });
    console.log("PASS: Shows 1 attempt left");

    // --- Test 2: Input disabled during lockout ---
    await expect(playerPage.getByPlaceholder("Locked out...")).toBeDisabled({ timeout: 3000 });
    console.log("PASS: Input disabled during lockout");

    // --- Test 3: After lockout expires, second wrong answer exhausts attempts ---
    await expect(playerPage.getByText(/Locked out for/)).toBeHidden({ timeout: 5000 });
    await expect(playerPage.getByPlaceholder("Type the song title...")).toBeEnabled({ timeout: 1000 });

    await submitAnswerViaSocket(playerPage, "another-wrong-id", "Wrong Again");

    await expect(playerPage.getByText("No attempts remaining this round")).toBeVisible({ timeout: 5000 });
    console.log("PASS: No attempts remaining after max attempts");

    // --- Test 4: Input disabled with no attempts ---
    await expect(playerPage.getByPlaceholder("Locked out...")).toBeDisabled({ timeout: 3000 });
    console.log("PASS: Input disabled when no attempts left");

    // --- Test 5: Penalties reset on next round ---
    await hostPage.getByRole("button", { name: "Close Answers" }).click();
    await expect(hostPage.getByRole("button", { name: "Next Round" })).toBeVisible({ timeout: 3000 });
    await hostPage.getByRole("button", { name: "Next Round" }).click();

    await expect(playerPage.getByText(/Round 2/)).toBeVisible({ timeout: 5000 });
    console.log("Round 2 started");

    await expect(playerPage.getByPlaceholder("Type the song title...")).toBeEnabled({ timeout: 3000 });
    console.log("PASS: Input re-enabled in new round (penalties reset)");

    // --- Test 6: Wrong answer in round 2 triggers lockout (proves reset) ---
    await submitAnswerViaSocket(playerPage, "wrong-round2", "Bad Guess");

    await expect(playerPage.getByText(/Locked out for/)).toBeVisible({ timeout: 3000 });
    await expect(playerPage.getByText(/1 attempt.* left/)).toBeVisible({ timeout: 3000 });
    console.log("PASS: Wrong answer in round 2 triggers lockout with fresh attempts");

    // --- Test 7: After lockout, player can answer correctly via UI ---
    await expect(playerPage.getByText(/Locked out for/)).toBeHidden({ timeout: 5000 });
    await expect(playerPage.getByPlaceholder("Type the song title...")).toBeEnabled({ timeout: 1000 });
    console.log("PASS: Can answer again after lockout expires in round 2");

    console.log("\n=== All browser-based E2E tests passed! ===");
  });
});
