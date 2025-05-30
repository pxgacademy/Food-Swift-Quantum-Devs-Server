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
    // const skillCollection = db.collection("skills");
    const restaurantCollection = db.collection("restaurants");
    const orderCollection = db.collection('orders')
    const locationCollection = db.collection('locations')
    const messageCollection = db.collection('messages')


    // const changeStream = skillCollection.watch();
    // changeStream.on("change", (stream) => {
    //   console.log("change event", stream);
    //   io.emit("change", stream);
    // });

    // socket.io authentic middleware
    io.use(async(socket, next) => {
      try{
        const token = socket.handshake.auth.token
        if(!token){
          return next(new Error('Authentication error: No token provided'))
        }
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
        socket.user = decoded
        next()
      }
      catch(error){
        next(new Error('Authentication error: Invalid token'))
      }
    })





    // socket.io connection handling
    io.on('connection', (socket) => {
      console.log(`Socket.io connected: ${socket.id}, User: ${socket.user.email}`)




      // socket.io room
      socket.on('joinOrderRoom', (orderId) => {
        if(!orderId || typeof orderId !== 'string'){
          return socket.emit('error', {message: 'Invalid or missing orderId'})
        }
        socket.join(orderId)
        console.log(`${socket.user.email} joined order room: ${orderId}`)
      })
      // socket.io delivery agent location
      socket.on('updateLocation', async({orderId, latitude, longitude}) => {
        try {
          // input validation
          if(!orderId || typeof orderId !== 'string'){
            return socket.emit('error', {message: 'Invalid or missing orderId'})
          }
          if(typeof latitude !== 'number' || typeof longitude !== 'number'){
            return socket.emit('error', {message: 'Invalid latitude or longitude'})
          }
          if(latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180){
            return socket.emit('error', {message: 'Latitude or longitude out of range'})
          }
          const user = await userCollection.findOne({email: socket.user.email})
          if (!user) {
            return socket.emit("error", { message: "User not found" });
          }
          if(user.role !== 'deliveryAgent'){
            return socket.emit('error', {message: 'unauthorized: Only delivery agents can update location'})
          }
          // location data create
          const locationData = {
            orderId,
            deliveryAgentEmail: socket.user.email,
            latitude,
            longitude,
            timestamp: new Date(),
          }
          await locationCollection.insertOne(locationData)
          // realtime location broadcast
          io.to(orderId).emit('locationUpdate', locationData)
          console.log(`location update for order ${orderId}: ${latitude}, ${longitude}`)
        } catch (error) {
          socket.emit('error', {message: 'Failed to update location', error: error.message})
        }
      })

      // chat room join event
      socket.on('joinChatRoom', ({senderEmail, receiverEmail}) => {
        const roomId = [senderEmail, receiverEmail].sort().join('_')
        socket.join(roomId)
        console.log(`${senderEmail} joined chat room with ${receiverEmail}`)
      })

      // send message
      socket.on('sendMessage', async({senderEmail, receiverEmail, message}) => {

        // validation
        if(!senderEmail || !receiverEmail || !message){
          return socket.emit('error', {message: 'Missing fields in message'})
        }
        const roomId = [senderEmail, receiverEmail].sort().join('_')

        const msgData = {
          senderEmail,
          receiverEmail,
          message,
          timestamp: new Date()
        }

        await messageCollection.insertOne(msgData)

        // Emit the message to both users
        io.to(roomId).emit("receiveMessage", msgData)
        console.log(`Message from ${senderEmail} to ${receiverEmail}: ${message}`)

      })



      // socket.io disconnect
      socket.on('disconnect', () => {
        console.log(`Socket.io disconnected: ${socket.id}`)
      })
    })

    app.post('/orders', verifyToken, async(req, res, next) => {
      try {
        const order = req.body
        order.createdAt = new Date()
        order.status = "pending"
        const result = await orderCollection.insertOne(order)
        res.status(201).send(result)
      } catch (error) {
        next(error)
      }
    })

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