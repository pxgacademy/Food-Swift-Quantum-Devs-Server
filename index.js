require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://food-delivery-app-quantum-devs.web.app/",
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
      "https://food-delivery-app-quantum-devs.web.app/",
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

async function run() {
  try {
    const db = client.db("Personal_Portfolio");
    // create your collection here
    // const skillCollection = db.collection("skills");

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

    // your routes will be here

    await client.connect();
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.log("MongoDB Connection Error:", error);
  }
}

run();

app.get("/", (req, res) => {
  res.status(200).send("Portfolio Server is running");
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
