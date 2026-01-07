import { pubClient } from "../socket/redis/client";
import { Player, Room } from "../types/interfaces";

export async function getFullRoom(roomCode: string): Promise<Room | null> {
  const metaKey = `room:${roomCode}:meta`;
  const playerKey = `room:${roomCode}:players`;

  const [meta, playersRaw] = await Promise.all([
    pubClient.hGetAll(metaKey),
    pubClient.hGetAll(playerKey),
  ]);

  if (!meta || Object.keys(meta).length === 0) return null;

  const players: Player[] = Object.values(playersRaw)
    .map((p) => JSON.parse(p))
    .sort((a, b) => (a.isHost === b.isHost ? 0 : a.isHost ? -1 : 1));

  return {
    code: roomCode,
    players,
    selectedPack: meta.selectedPack || null,
    isStarted: meta.isStarted === "true",
    isFlipped: meta.isFlipped === "true",
    isTransitioning: meta.isTransitioning === "true",
    currentPlayerIndex: parseInt(meta.currentPlayerIndex || "0"),
    currentQuestion: meta.currentQuestion || null,
    answeredQuestions: meta.answeredQuestions
      ? JSON.parse(meta.answeredQuestions)
      : [],
    customQuestions: meta.customQuestions
      ? JSON.parse(meta.customQuestions)
      : [],
    totalQuestions: parseInt(meta.totalQuestions || "0"),
  } as Room;
}
