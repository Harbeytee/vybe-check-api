import { PackType } from "./types";

export interface Pack {
  id: PackType;
  name: string;
  description: string;
  icon: string;
  color: string;
  questions: string[];
}
