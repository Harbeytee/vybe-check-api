import { model, Schema } from "mongoose";

const QuestionPackSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  questions: [{ id: String, text: String }],
});

const QuestionPack = model("QuestionPack", QuestionPackSchema);
export default QuestionPack;
