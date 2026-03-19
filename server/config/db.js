const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://collabBoard:collabBoard123@ac-m1finsp-shard-00-00.neqnjpl.mongodb.net:27017,ac-m1finsp-shard-00-01.neqnjpl.mongodb.net:27017,ac-m1finsp-shard-00-02.neqnjpl.mongodb.net:27017/whiteboardDB?ssl=true&replicaSet=atlas-f8kuxr-shard-0&authSource=admin&appName=Cluster0");
    console.log("MongoDB Connected");
  } catch (error) {
    console.error("Database connection error:", error);
    process.exit(1);
  }
};
module.exports = connectDB;