import { PackType } from "./types";

export interface Pack {
  id: PackType;
  name: string;
  description: string;
  icon: string;
  color: string;
  questions: string[];
}

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  lastSeen: number;
}
export interface Question {
  id: string;
  text: string;
}
export interface Room {
  code: string;
  players: Player[];
  selectedPack?: string;
  customQuestions: Question[];
  isStarted: boolean;
  isFlipped: boolean;
  isTransitioning: boolean;
  currentPlayerIndex: number;
  currentQuestion?: string | null;
  answeredQuestions: string[];
  totalQuestions: number;
}
