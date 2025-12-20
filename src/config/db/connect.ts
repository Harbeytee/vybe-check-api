import { connect } from "mongoose";
import config from "../config";

const connectDB = () => {
  const url = config.mongoUri!;
  return connect(url);
};

export default connectDB;
