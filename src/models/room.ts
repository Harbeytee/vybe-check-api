import { model, Schema } from "mongoose";

interface IRoom extends Document {
  code: string;
  players: {
    id: string;
    name: string;
    isHost: boolean;
  }[];
  selectedPack: string;
  currentQuestion: string;
  currentPlayerIndex: number;
  answeredQuestions: string[];
  customQuestions: { id: string; text: string }[];
  totalQuestions: number;
  isFlipped: boolean;
  isTransitioning: boolean;
  isStarted: boolean;
}

//Stores the live state of a game session
const RoomSchema = new Schema<IRoom>({
  code: { type: String, uppercase: true },
  players: [{ id: String, name: String, isHost: Boolean }],
  selectedPack: String,
  currentQuestion: String,
  currentPlayerIndex: { type: Number, default: 0 },
  answeredQuestions: [String], // Array of IDs already used
  customQuestions: [{ id: String, text: String }],
  totalQuestions: { type: Number, default: 0 }, // RoomSchema.ts
  isFlipped: { type: Boolean, default: false },
  isTransitioning: { type: Boolean, default: false },
  isStarted: { type: Boolean, default: false },
});

const Room = model("Room", RoomSchema);
export default Room;
