const express = require("express");
const router = express.Router();
const cartHandler = require("../handlers/cart-handler");

router.post("/:cartId/item", cartHandler["cart@addItem"]);

module.exports = router;
