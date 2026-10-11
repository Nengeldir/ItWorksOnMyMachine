import type { GhostData, GhostRun } from "./game/ghost";

export interface User {
  id: string;
  name: string;
  verified: boolean; // logged in through the VIScon portal
  has_played?: boolean; // ever finished a race or time trial (this login, or this browser for guests)
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  time_ms: number;
  is_me: boolean;
}

export interface RunResult {
  rank: number;
  personal_best_ms: number;
  /** XP the finish earned (one per gate) */
  xp?: number;
  leaderboard: LeaderboardEntry[];
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  racing: boolean;
  finish_ms: number | null;
}

export interface RaceResult {
  id: string;
  name: string;
  color: string;
  time_ms: number;
}

export type RoomPhase = "lobby" | "countdown" | "racing";

export interface RoomInfo {
  type: "room";
  code: string;
  seed: number;
  phase: RoomPhase;
  start_at: number | null;
  race_id: number;
  /** The pilot who can restart a running race: the first one in, passed on when they leave */
  host: string | null;
  players: RoomPlayer[];
  results: RaceResult[];
  server_time: number;
}

/** Positions of everyone in the room: [id, x, y, z, qx, qy, qz, qw, speed, checkpoints, t, boost, brake, dodge] */
export interface Snapshot {
  type: "snap";
  t: number;
  players: [string, number, number, number, number, number, number, number, number, number, number, number?, number?, number?][];
}

export interface Joined {
  id: string;
  token: string;
  room: RoomInfo;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request<T>(endpoint: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: { "X-Flight-Rules": "speed-control-v3", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const detail = (await response.json()).detail;
      if (typeof detail === "string") message = detail;
    } catch {
      // Not JSON
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function getMe(clientId: string): Promise<User> {
  return request(`/api/me?client_id=${encodeURIComponent(clientId)}`);
}

export function getLeaderboard(seed: number, clientId: string): Promise<LeaderboardEntry[]> {
  return request(`/api/leaderboard?seed=${seed}&client_id=${encodeURIComponent(clientId)}`);
}

export function getGhosts(seed: number, limit = 3): Promise<GhostRun[]> {
  return request(`/api/ghosts?seed=${seed}&limit=${limit}`);
}

export function startRun(seed: number): Promise<{ run_token: string }> {
  return request("/api/runs/start", "POST", { seed });
}

export function finishRun(body: {
  run_token: string;
  time_ms: number;
  client_id: string;
  nickname: string;
  ghost: GhostData;
  gates?: number;
}): Promise<RunResult> {
  return request("/api/runs/finish", "POST", body);
}
