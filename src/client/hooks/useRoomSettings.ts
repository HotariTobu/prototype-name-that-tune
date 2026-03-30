import { useState } from "react";
import { useDebouncedCallback } from "./useDebouncedCallback.ts";

interface InitialSettings {
  durationSteps: number[];
  scoringScheme: number[];
  totalRounds: number;
  penaltyLockoutSeconds: number;
  penaltyMaxAttempts: number;
}

function parseDurationSteps(input: string): number[] {
  const parsed = input.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
  return parsed.length > 0 ? parsed : [1, 2, 4, 8, 16];
}

function parseScoringScheme(input: string): number[] {
  const parsed = input.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
  return parsed.length > 0 ? parsed : [4, 2, 1];
}

export function useRoomSettings(
  initial: InitialSettings,
  songCount: number,
  onSync: (patch: Record<string, unknown>) => void,
) {
  const [durationStepsInput, setDurationStepsInputRaw] = useState(initial.durationSteps.join(", "));
  const [scoringInput, setScoringInputRaw] = useState(initial.scoringScheme.join(", "));
  const [rounds, setRoundsRaw] = useState(initial.totalRounds || songCount);
  const [penaltyLockout, setPenaltyLockoutRaw] = useState(initial.penaltyLockoutSeconds ?? 5);
  const [penaltyMaxAttempts, setPenaltyMaxAttemptsRaw] = useState(initial.penaltyMaxAttempts ?? 3);

  const debouncedSync = useDebouncedCallback(onSync, 300);

  const setDurationStepsInput = (value: string) => {
    setDurationStepsInputRaw(value);
    debouncedSync({ durationSteps: parseDurationSteps(value) });
  };

  const setScoringInput = (value: string) => {
    setScoringInputRaw(value);
    debouncedSync({ scoringScheme: parseScoringScheme(value) });
  };

  const setRounds = (value: number) => {
    setRoundsRaw(value);
    debouncedSync({ totalRounds: value });
  };

  const setPenaltyLockout = (value: number) => {
    setPenaltyLockoutRaw(value);
    debouncedSync({ penaltyLockoutSeconds: value });
  };

  const setPenaltyMaxAttempts = (value: number) => {
    setPenaltyMaxAttemptsRaw(value);
    debouncedSync({ penaltyMaxAttempts: value });
  };

  return {
    durationStepsInput,
    setDurationStepsInput,
    scoringInput,
    setScoringInput,
    rounds: Math.min(rounds, songCount),
    setRounds,
    penaltyLockout,
    setPenaltyLockout,
    penaltyMaxAttempts,
    setPenaltyMaxAttempts,
  };
}
