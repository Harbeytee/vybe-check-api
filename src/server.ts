import connectDB from "./config/db/connect";
import http from "http";
import "dotenv/config";
import app from "./app";
import { initSocket } from "./socket";
import config from "./config/config";

const port = config.port;
const server = http.createServer(app);

const start = async () => {
  try {
    await connectDB();
    await initSocket(server);
    server.listen(port, () =>
      console.log(`Server is listening on port ${port}...`)
    );
  } catch (error) {
    console.log(error);
  }
};

start();
