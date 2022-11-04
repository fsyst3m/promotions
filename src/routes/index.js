const express = require("express");
const app = express();

const mdcoRoutes = require("./mdco");
const cartRoutes = require("./cart");

app.use("/mdco", mdcoRoutes);
app.use("/cart", cartRoutes);
module.exports = app;
