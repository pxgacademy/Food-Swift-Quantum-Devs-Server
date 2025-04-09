import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import { Server } from "socket.io";
import http from "http";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://food-delivery-app-quantum-devs.web.app",
    ],
    credentials: true,
  },
});

// Middlewares
app.use(cookieParser());
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://food-delivery-app-quantum-devs.web.app",
    ],
    credentials: true,
  })
);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uioun.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// const uri = "mongodb://localhost:27017";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).send({ message: "Unauthorized access" });

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
      if (err) return res.status(401).send({ message: "Unauthorized access" });
      req.user = decoded;
      next();
    });
  } catch (error) {
    next(error);
  }
};

// immediately invoked function
(async () => {
  try {
    const db = client.db("Food_Swift");
    // create your collection here
    const userCollection = db.collection("users");
    const skillCollection = db.collection("skills");
    const restaurantCollection = db.collection("restaurants");

    // mongodb realtime stream setup
    const changeStream = skillCollection.watch();
    changeStream.on("change", (stream) => {
      console.log("change event", stream);
      io.emit("change", stream);
    });

    // socket.io
    io.on("connection", (socket) => {
      console.log("socket.io connected", socket.id);

      socket.on("message", (data) => {
        console.log("message received", data);
        io.emit("message", data);
      });

      socket.on("disconnect", () => {
        console.log("socket.io disconnected", socket.id);
      });
    });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    };

    // Authentication Routes
    app.post("/jwt", (req, res, next) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "23h",
        });
        res.cookie("token", token, cookieOptions).send({ success: true });
      } catch (error) {
        next(error);
      }
    });

    app.delete("/logout", (req, res, next) => {
      try {
        res.clearCookie("token", cookieOptions).send({ success: true });
      } catch (error) {
        next(error);
      }
    });

    // create a new user and check if it already exists or not by email
    app.post("/users", async (req, res, next) => {
      try {
        const user = req.body;
        const existingUser = await userCollection.findOne({
          email: user?.email,
        });
        if (existingUser)
          return res.status(400).send({ message: "Email already exists" });

        const result = await userCollection.insertOne(user);
        res.status(201).send(result);
      } catch (error) {
        next(error);
      }
    });

    // create a get request to get isBlock from user collection filtered by email
    app.get("/users/isBlocked/:email", async (req, res, next) => {
      try {
        const { email } = req?.params;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.send({ isBlock: user?.isBlock });
      } catch (error) {
        next(error);
      }
    });

    // create a patch request for user collection filtered by email, change isBlock: true
    app.patch("/users/block-req-one/:email", async (req, res, next) => {
      try {
        const { email } = req?.params;
        const result = await userCollection.updateOne(
          { email },
          { $set: { isBlock: true } }
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        res.send(result);
      } catch (error) {
        next(error);
      }
    });

    // insert a restaurant
    app.post("/restaurants", async (req, res, next) => {
      try {
        const value = req.body;
        value.createdAt = Date.now();
        console.log(value);
        const result = await restaurantCollection.insertOne(value);
        res.status(201).send(result);
      } catch (error) {
        next(error);
      }
    });

    await client.connect();
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.log("MongoDB Connection Error:", error);
  }
})();

app.get("/", (req, res) => {
  res.status(200).send("Food Swift Server is running");
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  res
    .status(500)
    .send({ message: "Internal Server Error", error: err.message });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
