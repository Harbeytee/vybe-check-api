import { nanoid } from "nanoid";
import QuestionPack from "../models/question-pack";
import connectDB from "./db/connect";
import "dotenv/config";
import { gamePacks } from "../utils.ts/data";

async function seed() {
  await connectDB();

  // TRANSFORMING QUESTION STRINGS TO OBJECTS
  const dataToSave = gamePacks.map((pack) => ({
    ...pack,
    questions: pack.questions.map((qText) => ({
      id: nanoid(),
      text: qText,
    })),
  }));

  //PUSHING TO MONGODB
  await QuestionPack.deleteMany({}); // Clear old data to avoid duplicates
  await QuestionPack.insertMany(dataToSave);

  console.log("✅ Database Seeded with Question Objects!");
  process.exit();
}

seed();
