const { addToCart } = require("../api/cart");

const handlers = {
  "cart@addItem": (req, res, next) => {
    const cartId = req.params.cartId;
    const { body } = req;
    addToCart(cartId, body);
  },
};

module.exports = handlers;
