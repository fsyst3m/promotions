const express = require("express");
const router = express.Router();

const handlers = require("../handlers/mdco-handler");

router.get("/products/by-sku/:partNumber", handlers["get@by-sku"]);

module.exports = router;
